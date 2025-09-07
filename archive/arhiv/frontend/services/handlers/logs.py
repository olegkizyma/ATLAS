from pathlib import Path
from datetime import datetime
import json
import logging
import time
import urllib.parse
from services.config import logs_file_path, sse_heartbeat_seconds

logger = logging.getLogger(__name__)

def serve_logs_stream(h):
    """Server-Sent Events: tail логов в реальном времени с heartbeats."""
    try:
        # Headers for SSE
        h.send_response(200)
        h.send_header('Content-Type', 'text/event-stream')
        h.send_header('Cache-Control', 'no-cache')
        h.send_header('Connection', 'keep-alive')
        h.send_header('Access-Control-Allow-Origin', '*')
        h.end_headers()

        def sse(event_obj: dict):
            try:
                h.wfile.write(f"data: {json.dumps(event_obj)}\n\n".encode())
                h.wfile.flush()
            except Exception:
                raise

        # Initial status
        sse({
            "timestamp": datetime.now().isoformat(),
            "level": "INFO",
            "source": "atlas_frontend",
            "message": "Log stream connected successfully",
        })

        log_path = Path(logs_file_path())
        heartbeat = max(5, sse_heartbeat_seconds())
        last_beat = time.time()

        # Send recent lines if file exists
        if log_path.exists():
            try:
                with open(log_path, 'r') as f:
                    lines = f.readlines()
                for line in lines[-50:]:
                    line = line.strip()
                    if not line:
                        continue
                    sse({
                        "timestamp": datetime.now().isoformat(),
                        "level": "DEBUG",
                        "source": "goose",
                        "message": line,
                    })
            except Exception as e:
                logger.debug(f"Prefill logs failed: {e}")

        # Follow new lines like tail -f with basic polling
        try:
            inode = None
            fp = None
            while True:
                # Reopen if rotated/moved
                try:
                    if fp is None or not log_path.exists() or (inode is not None and log_path.stat().st_ino != inode):
                        if fp:
                            try:
                                fp.close()
                            except Exception:
                                pass
                            fp = None
                        if log_path.exists():
                            fp = open(log_path, 'r')
                            inode = log_path.stat().st_ino
                            # seek to end
                            fp.seek(0, 2)
                except Exception:
                    fp = None

                # Read new lines if open
                if fp:
                    where = fp.tell()
                    line = fp.readline()
                    if not line:
                        fp.seek(where)
                        time.sleep(0.5)
                    else:
                        msg = line.strip()
                        if msg:
                            sse({
                                "timestamp": datetime.now().isoformat(),
                                "level": "INFO",
                                "source": "goose",
                                "message": msg,
                            })
                else:
                    time.sleep(1.0)

                # Heartbeat
                now = time.time()
                if now - last_beat >= heartbeat:
                    try:
                        h.wfile.write(b": keep-alive\n\n")
                        h.wfile.flush()
                    except Exception:
                        break
                    last_beat = now
        except (BrokenPipeError, ConnectionResetError):
            return
    except Exception as e:
        logger.error(f"Log stream error: {e}")
        # Do not send error after headers; just stop.
        return

def serve_live_logs(h):
    try:
        parsed_path = urllib.parse.urlparse(h.path)
        query_params = urllib.parse.parse_qs(parsed_path.query)
        limit = int(query_params.get('limit', ['50'])[0])

        logs = []
        try:
            sessions_dir = Path.home() / ".local/share/goose/sessions"
            if sessions_dir.exists():
                jsonl_files = list(sessions_dir.glob("*.jsonl"))
                if jsonl_files:
                    latest_session = max(jsonl_files, key=lambda f: f.stat().st_mtime)
                    with open(latest_session, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                    recent_lines = lines[-min(limit, len(lines)) :]
                    for line in recent_lines:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            if "role" in data and "content" in data:
                                role = data["role"]
                                content = str(data.get("content", ""))
                                if role == "user":
                                    message = f"🔵 USER: {content[:200]}..."
                                elif role == "assistant":
                                    message = f"🤖 GOOSE: {content[:200]}..."
                                else:
                                    message = f"📊 {role.upper()}: {content[:200]}..."
                                logs.append({
                                    "message": message,
                                    "level": "info",
                                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                                    "source": "goose_session",
                                })
                            elif "description" in data:
                                message = f"📋 TASK: {data['description']}"
                                logs.append({
                                    "message": message,
                                    "level": "info",
                                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                                    "source": "goose_task",
                                })
                        except json.JSONDecodeError:
                            logs.append({
                                "message": f"📄 RAW: {line[:200]}...",
                                "level": "debug",
                                "timestamp": datetime.now().strftime("%H:%M:%S"),
                                "source": "goose_raw",
                            })
        except Exception as e:
            logs.append({
                "message": f"❌ Error reading Goose sessions: {e}",
                "level": "error",
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "source": "atlas_frontend",
            })

        # Прибрали спам "Monitoring Goose sessions" - він засмічує логи

        response = json.dumps({"logs": logs}).encode('utf-8')
        h.send_response(200)
        h.send_header('Content-type', 'application/json')
        h.send_header('Access-Control-Allow-Origin', '*')
        h.send_header('Content-Length', str(len(response)))
        h.end_headers()
        h.wfile.write(response)
    except Exception as e:
        logger.error(f"Live logs error: {e}")
        try:
            h.send_error(500, str(e))
        except Exception:
            pass
