#!/usr/bin/env python3
"""ATLAS Multi-log streaming utility.

Streams the last N lines (default 500) from every *.log file in the target
logs directory, then follows (like tail -F) all current and newly created
log files, prefixing each line with timestamp and a colored component tag.

Exit with Ctrl+C. Safe to run before logs exist (it will wait).

Usage:
  python scripts/stream_logs.py --dir ./logs --lines 500

Environment variables:
  ATLAS_LOG_STREAM_REFRESH (float, seconds)   – rescan interval (default 5)
  ATLAS_LOG_STREAM_IDLE_FLUSH (float, sec)    – idle flush interval (default 1)
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import deque
from typing import Dict, List, Deque, Tuple

COLOR_PALETTE = [
    "\033[38;5;39m",   # blue
    "\033[38;5;208m",  # orange
    "\033[38;5;34m",   # green
    "\033[38;5;199m",  # pink
    "\033[38;5;214m",  # gold
    "\033[38;5;69m",   # teal
    "\033[38;5;160m",  # red
    "\033[38;5;141m",  # purple
    "\033[38;5;130m",  # brown
    "\033[38;5;75m",   # cyan
]
RESET = "\033[0m"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Stream ATLAS logs with unified view")
    p.add_argument("--dir", required=True, help="Path to logs directory")
    p.add_argument("--lines", type=int, default=500, help="Last N lines to show initially per file")
    p.add_argument("--pattern", default=".log", help="Filename suffix pattern (default: .log)")
    p.add_argument("--no-color", action="store_true", help="Disable ANSI colors")
    return p.parse_args()


def list_log_files(log_dir: str, suffix: str) -> List[str]:
    try:
        return sorted(
            [os.path.join(log_dir, f) for f in os.listdir(log_dir)
             if f.endswith(suffix) and os.path.isfile(os.path.join(log_dir, f))]
        )
    except FileNotFoundError:
        return []


def read_last_n_lines(path: str, n: int) -> Deque[str]:
    dq: Deque[str] = deque(maxlen=n)
    try:
        with open(path, 'r', errors='replace') as f:
            for line in f:
                dq.append(line.rstrip('\n'))
    except FileNotFoundError:
        pass
    return dq


def color_for(name: str, disable: bool) -> str:
    if disable:
        return ""
    idx = abs(hash(name)) % len(COLOR_PALETTE)
    return COLOR_PALETTE[idx]


def format_line(component: str, line: str, disable_color: bool) -> str:
    ts = time.strftime('%H:%M:%S')
    color = color_for(component, disable_color)
    reset = RESET if not disable_color else ""
    return f"{color}[{ts}][{component}] {line}{reset}"


def stream(log_dir: str, lines: int, suffix: str, disable_color: bool):
    refresh_interval = float(os.getenv("ATLAS_LOG_STREAM_REFRESH", "5"))
    idle_flush = float(os.getenv("ATLAS_LOG_STREAM_IDLE_FLUSH", "1"))
    tracked: Dict[str, Tuple[float, int]] = {}  # path -> (last_mtime, size)
    file_objs: Dict[str, any] = {}

    printed_initial = set()

    def open_new_files():
        changed = False
        for path in list_log_files(log_dir, suffix):
            if path not in tracked:
                # initial read
                comp = os.path.basename(path).replace('.log', '')
                buf = read_last_n_lines(path, lines)
                if buf and path not in printed_initial:
                    for l in buf:
                        sys.stdout.write(format_line(comp, l, disable_color) + "\n")
                    printed_initial.add(path)
                try:
                    fo = open(path, 'r', errors='replace')
                    fo.seek(0, os.SEEK_END)
                    file_objs[path] = fo
                    st = os.stat(path)
                    tracked[path] = (st.st_mtime, st.st_size)
                    changed = True
                except FileNotFoundError:
                    continue
        return changed

    last_rescan = 0.0
    try:
        while True:
            now = time.time()
            if now - last_rescan >= refresh_interval:
                open_new_files()
                last_rescan = now

            any_output = False
            # read new lines
            for path, fo in list(file_objs.items()):
                try:
                    while True:
                        pos_before = fo.tell()
                        line = fo.readline()
                        if not line:
                            fo.seek(pos_before)
                            break
                        line = line.rstrip('\n')
                        comp = os.path.basename(path).replace('.log', '')
                        sys.stdout.write(format_line(comp, line, disable_color) + "\n")
                        any_output = True
                except Exception as e:  # noqa
                    # Attempt to reopen on error (rotation?)
                    try:
                        fo.close()
                    except Exception:
                        pass
                    try:
                        new_fo = open(path, 'r', errors='replace')
                        new_fo.seek(0, os.SEEK_END)
                        file_objs[path] = new_fo
                    except Exception:
                        file_objs.pop(path, None)
                        continue
            if any_output:
                sys.stdout.flush()
                continue
            # idle sleep
            time.sleep(idle_flush)
    except KeyboardInterrupt:
        pass
    finally:
        for fo in file_objs.values():
            try:
                fo.close()
            except Exception:
                pass


def main():
    args = parse_args()
    log_dir = os.path.abspath(args.dir)
    if not os.path.exists(log_dir):
        print(f"[stream_logs] Waiting for log directory to appear: {log_dir}")
        while not os.path.exists(log_dir):
            try:
                time.sleep(0.5)
            except KeyboardInterrupt:
                return 1
    print(f"[stream_logs] Monitoring directory: {log_dir}")
    stream(log_dir, args.lines, args.pattern, args.no_color)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
