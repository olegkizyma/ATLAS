import subprocess
import threading
import queue
import time
from datetime import datetime
import requests
import os

class LiveLogStreamer:
    """Клас для стрімінгу живих логів системи (виділений у сервіс)."""

    def __init__(self):
        self.log_queue = queue.Queue()
        self.is_running = False
        self.atlas_core_url = os.getenv("ATLAS_CORE_URL", "http://localhost:3000")
        self.system_status = {
            "processes": {},
            "services": {},
            "network": {},
            "resources": {},
            "timestamp": None,
        }

    def start_streaming(self):
        self.is_running = True
        threading.Thread(target=self._system_monitor, daemon=True).start()
        threading.Thread(target=self._atlas_monitor, daemon=True).start()

    def stop_streaming(self):
        self.is_running = False

    def get_logs(self):
        logs = []
        while not self.log_queue.empty():
            try:
                logs.append(self.log_queue.get_nowait())
            except queue.Empty:
                break
        return logs

    def get_system_status(self):
        return self.system_status.copy()

    def update_system_status(self, category, key, value):
        self.system_status[category][key] = value
        self.system_status["timestamp"] = datetime.now().isoformat()

    def _add_log(self, message, level="info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        if self.log_queue.qsize() < 200:
            self.log_queue.put({
                "message": log_entry,
                "level": level,
                "timestamp": timestamp,
            })

    def _system_monitor(self):
        while self.is_running:
            try:
                result = subprocess.run(["ps", "aux"], capture_output=True, text=True)
                if result.returncode == 0:
                    lines = result.stdout.split("\n")
                    atlas_processes, goose_processes, mcp_processes, python_processes = [], [], [], []
                    for line in lines:
                        if line.strip() and "grep" not in line:
                            if "atlas" in line.lower():
                                atlas_processes.append(self._parse_process_line(line))
                            elif "goose" in line.lower():
                                goose_processes.append(self._parse_process_line(line))
                            elif "mcp" in line.lower():
                                mcp_processes.append(self._parse_process_line(line))
                            elif "python" in line and ("atlas" in line or "mcp" in line):
                                python_processes.append(self._parse_process_line(line))
                    self.update_system_status("processes", "atlas", {"count": len(atlas_processes), "details": atlas_processes})
                    self.update_system_status("processes", "goose", {"count": len(goose_processes), "details": goose_processes})
                    self.update_system_status("processes", "mcp", {"count": len(mcp_processes), "details": mcp_processes})
                    self.update_system_status("processes", "python", {"count": len(python_processes), "details": python_processes})
                    total_processes = len(atlas_processes) + len(goose_processes) + len(mcp_processes)
                    if total_processes > 0:
                        self._add_log(f"[SYSTEM] {total_processes} Atlas-related processes active")
                try:
                    result = subprocess.run(["lsof", "-i", ":3000", "-i", ":8080"], capture_output=True, text=True)
                    if result.returncode == 0:
                        lines = result.stdout.split("\n")[1:]
                        active_connections = []
                        for line in lines:
                            if line.strip():
                                active_connections.append(self._parse_network_line(line))
                        self.update_system_status("network", "connections", {"count": len(active_connections), "details": active_connections})
                        if active_connections:
                            self._add_log(f"[NET] {len(active_connections)} active connections on Atlas ports")
                except Exception as e:
                    self._add_log(f"[NET] Network check failed: {str(e)[:30]}...", "warning")
                try:
                    result = subprocess.run(["top", "-l", "1", "-n", "0"], capture_output=True, text=True)
                    if result.returncode == 0:
                        cpu_info = self._parse_cpu_info(result.stdout)
                        self.update_system_status("resources", "cpu", cpu_info)
                        result = subprocess.run(["df", "-h", "/"], capture_output=True, text=True)
                        if result.returncode == 0:
                            disk_info = self._parse_disk_info(result.stdout)
                            self.update_system_status("resources", "disk", disk_info)
                except Exception as e:
                    self._add_log(f"[RESOURCES] Resource check failed: {str(e)[:30]}...", "warning")
                time.sleep(3)
            except Exception as e:
                self._add_log(f"[ERROR] System monitor: {str(e)[:30]}...", "error")
                time.sleep(5)

    def _atlas_monitor(self):
        while self.is_running:
            try:
                response = requests.get(f"{self.atlas_core_url}/", timeout=3)
                if response.status_code == 200:
                    self._add_log("[ATLAS] Core online")
                    self.update_system_status("services", "atlas_core", {"status": "online", "status_code": 200, "last_check": datetime.now().isoformat()})
                else:
                    self._add_log(f"[ATLAS] Core status: {response.status_code}", "warning")
                    self.update_system_status("services", "atlas_core", {"status": "warning", "status_code": response.status_code, "last_check": datetime.now().isoformat()})
            except requests.exceptions.ConnectionError:
                self._add_log("[ATLAS] Core offline", "warning")
                self.update_system_status("services", "atlas_core", {"status": "offline", "error": "Connection refused", "last_check": datetime.now().isoformat()})
            except Exception as e:
                self._add_log(f"[ATLAS] Error: {str(e)[:40]}...", "error")
                self.update_system_status("services", "atlas_core", {"status": "error", "error": str(e)[:100], "last_check": datetime.now().isoformat()})
            time.sleep(6)

    def _parse_process_line(self, line):
        try:
            parts = line.split()
            if len(parts) >= 11:
                cmd = " ".join(parts[10:])
                return {"user": parts[0], "pid": parts[1], "cpu": parts[2], "mem": parts[3], "command": (cmd[:50] + "...") if len(cmd) > 50 else cmd}
        except Exception:
            return {"raw": line[:50] + "..." if len(line) > 50 else line}
        return {}

    def _parse_network_line(self, line):
        try:
            parts = line.split()
            if len(parts) >= 9:
                return {"command": parts[0], "pid": parts[1], "user": parts[2], "type": parts[4], "node": parts[7], "name": parts[8] if len(parts) > 8 else ""}
        except Exception:
            return {"raw": line[:50] + "..." if len(line) > 50 else line}
        return {}

    def _parse_cpu_info(self, top_output):
        try:
            for line in top_output.split("\n"):
                if "CPU usage" in line:
                    parts = line.split(":")[1] if ":" in line else line
                    return {"usage_line": parts.strip()[:100]}
            return {"usage_line": "CPU info not found"}
        except Exception:
            return {"usage_line": "CPU parsing failed"}

    def _parse_disk_info(self, df_output):
        try:
            lines = df_output.split("\n")
            if len(lines) > 1:
                parts = lines[1].split()
                if len(parts) >= 5:
                    return {"filesystem": parts[0], "size": parts[1], "used": parts[2], "available": parts[3], "usage_percent": parts[4]}
            return {"info": "Disk parsing failed"}
        except Exception:
            return {"info": "Disk info unavailable"}
