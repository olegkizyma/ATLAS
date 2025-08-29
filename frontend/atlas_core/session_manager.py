"""
Session Manager - Система управління сесіями Goose
Завдання:
1. Визначати тип сесії (нова/продовження)
2. Керувати активними сесіями
3. Зберігати контекст сесій
4. Інтегруватися з Goose CLI
"""

import json
import subprocess
import os
import re
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
from pathlib import Path

# Налаштування логування
logger = logging.getLogger(__name__)


class SessionManager:
    """Менеджер сесій для роботи з Goose"""
    
    def __init__(self, goose_path: str = "/Users/dev/Documents/GitHub/ATLAS/goose"):
        self.goose_path = goose_path
        self.goose_binary = f"{goose_path}/target/release/goose"
        self.active_sessions = {}
        self.session_contexts = {}
        
        # Перевіряємо наявність Goose
        if not Path(self.goose_binary).exists():
            raise FileNotFoundError(f"Goose binary not found at {self.goose_binary}")

    def get_available_sessions(self) -> List[Dict]:
        """Отримує список доступних сесій з Goose"""
        try:
            result = subprocess.run(
                [self.goose_binary, "session", "list"],
                capture_output=True,
                text=True,
                cwd=self.goose_path,
                env=self._get_goose_env(),
                timeout=30
            )
            
            if result.returncode != 0:
                return []
            
            # Парсимо вивід команди session list
            sessions = []
            for line in result.stdout.split('\n'):
                if ' - ' in line and not line.startswith('Available sessions:'):
                    parts = line.strip().split(' - ', 2)
                    if len(parts) >= 2:
                        session_name = parts[0].strip()
                        description = parts[1].strip() if len(parts) > 1 else "No description"
                        timestamp_str = parts[2].strip() if len(parts) > 2 else ""
                        
                        sessions.append({
                            "name": session_name,
                            "description": description,
                            "timestamp": timestamp_str,
                            "active": session_name in self.active_sessions
                        })
            
            return sessions
            
        except Exception as e:
            print(f"Error getting sessions: {e}")
            return []

    def create_session(self, session_name: str, initial_message: str = None) -> Dict:
        """Створює нову сесію Goose"""
        try:
            logger.info(f"🆕 SessionManager: Створюю нову сесію '{session_name}'")
            
            if initial_message:
                logger.info(f"📝 Початкове повідомлення: {initial_message}")
                
                # Створюємо сесію з початковим повідомленням
                cmd = [self.goose_binary, "session", "--name", session_name]
                
                logger.info(f"🚀 Виконую команду: {' '.join(cmd)}")
                
                # Запускаємо в інтерактивному режимі
                process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    cwd=self.goose_path,
                    env=self._get_goose_env()
                )
                
                # Відправляємо повідомлення і закриваємо
                input_text = f"{initial_message}\nexit\n"
                logger.info(f"📤 Відправляю вхідні дані: {repr(input_text)}")
                
                stdout, stderr = process.communicate(input=input_text, timeout=60)
                
                logger.info(f"📥 Отримано відповідь (return_code: {process.returncode})")
                logger.info(f"📤 STDOUT: {stdout[:500]}..." if len(stdout) > 500 else f"📤 STDOUT: {stdout}")
                if stderr:
                    logger.warning(f"⚠️ STDERR: {stderr}")
                
                # Перевіряємо код завершення
                if process.returncode != 0:
                    logger.error(f"❌ Команда завершилася з кодом помилки: {process.returncode}")
                    return {
                        "success": False,
                        "error": f"Команда завершилася з кодом {process.returncode}. STDERR: {stderr}",
                        "session_name": session_name,
                        "stdout": stdout
                    }
                
                self.active_sessions[session_name] = {
                    "created": datetime.now().isoformat(),
                    "last_used": datetime.now().isoformat(),
                    "message_count": 1
                }
                
                return {
                    "success": True,
                    "session_name": session_name,
                    "created": True,
                    "response": stdout
                }
            else:
                # Просто реєструємо сесію
                self.active_sessions[session_name] = {
                    "created": datetime.now().isoformat(),
                    "last_used": datetime.now().isoformat(),
                    "message_count": 0
                }
                
                return {
                    "success": True,
                    "session_name": session_name,
                    "created": True,
                    "response": "Session registered"
                }
                
        except subprocess.TimeoutExpired:
            logger.error(f"⏰ Операція перевищила ліміт часу 60с")
            process.kill()
            return {
                "success": False,
                "error": "Операція перевищила ліміт часу 60с",
                "session_name": session_name
            }
        except Exception as e:
            logger.error(f"💥 Виняток при створенні сесії: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def send_to_session(self, session_name: str, message: str, resume: bool = True) -> Dict:
        """Відправляє повідомлення в існуючу сесію"""
        try:
            logger.info(f"🔗 SessionManager: Відправляю команду до сесії '{session_name}'")
            logger.info(f"📝 Команда: {message}")
            
            if resume:
                # Відновлюємо сесію і відправляємо повідомлення
                cmd = [self.goose_binary, "session", "--name", session_name, "--resume"]
            else:
                # Нова сесія з іменем
                cmd = [self.goose_binary, "session", "--name", session_name]
            
            logger.info(f"🚀 Виконую команду: {' '.join(cmd)}")
            
            # Запускаємо процес
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=self.goose_path,
                env=self._get_goose_env()
            )
            
            # Відправляємо повідомлення
            input_text = f"{message}\nexit\n"
            logger.info(f"📤 Відправляю вхідні дані: {repr(input_text)}")
            
            stdout, stderr = process.communicate(input=input_text, timeout=300)  # 5 хвилин
            
            logger.info(f"📥 Отримано відповідь (return_code: {process.returncode})")
            logger.info(f"📤 STDOUT: {stdout[:500]}..." if len(stdout) > 500 else f"📤 STDOUT: {stdout}")
            if stderr:
                logger.warning(f"⚠️ STDERR: {stderr}")
            
            # Оновлюємо статистику сесії
            if session_name in self.active_sessions:
                self.active_sessions[session_name]["last_used"] = datetime.now().isoformat()
                self.active_sessions[session_name]["message_count"] += 1
            
            return {
                "success": True,
                "session_name": session_name,
                "response": stdout,
                "stderr": stderr,
                "return_code": process.returncode
            }
            
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "Timeout: Session took too long to respond",
                "session_name": session_name
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def determine_session_strategy(self, intent_analysis: Dict, session_strategy: Dict) -> Dict:
        """Визначає як саме виконати команду - створити нову сесію або продовжити існуючу"""
        strategy = session_strategy.get("strategy", "new")
        session_name = session_strategy.get("session_name")
        
        if strategy == "continue" and session_name:
            # Продовжити існуючу сесію
            return {
                "action": "resume_session",
                "session_name": session_name,
                "resume": True
            }
        else:
            # За замовчуванням - створювати нову сесію
            # Якщо ім'я сесії не вказано, використовуємо поточну дату/час
            if not session_name:
                session_name = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                
            return {
                "action": "create_session", 
                "session_name": session_name,
                "resume": False
            }

    def execute_command(self, message: str, intent_analysis: Dict, session_strategy: Dict) -> Dict:
        """Основний метод виконання команди - використовує тільки сесії"""
        execution_plan = self.determine_session_strategy(intent_analysis, session_strategy)
        
        if execution_plan["action"] == "resume_session":
            # Продовжити сесію
            result = self.send_to_session(
                execution_plan["session_name"], 
                message, 
                resume=True
            )
            result["execution_type"] = "session_resume"
            
        else:
            # Створити нову сесію
            session_name = execution_plan["session_name"]
            result = self.create_session(session_name, message)
            result["execution_type"] = "session_create"
        
        # Додаємо метадані
        result["timestamp"] = datetime.now().isoformat()
        result["intent"] = intent_analysis.get("intent", "unknown")
        result["confidence"] = intent_analysis.get("confidence", 0.0)
        
        return result

    def get_session_status(self, session_name: str) -> Optional[Dict]:
        """Отримує статус конкретної сесії"""
        if session_name in self.active_sessions:
            return self.active_sessions[session_name]
        return None

    def cleanup_old_sessions(self, max_age_hours: int = 24):
        """Очищає старі неактивні сесії"""
        current_time = datetime.now()
        to_remove = []
        
        for session_name, session_data in self.active_sessions.items():
            last_used = datetime.fromisoformat(session_data["last_used"])
            age_hours = (current_time - last_used).total_seconds() / 3600
            
            if age_hours > max_age_hours:
                to_remove.append(session_name)
        
        for session_name in to_remove:
            del self.active_sessions[session_name]
        
        return {"removed_sessions": to_remove, "remaining": len(self.active_sessions)}

    def _get_goose_env(self) -> Dict[str, str]:
        """Отримує середовище для запуску Goose"""
        env = os.environ.copy()
        env["PATH"] = f"{self.goose_path}/bin:" + env.get("PATH", "")
        env["RUST_LOG"] = "info"
        return env

    def get_stats(self) -> Dict:
        """Повертає статистику роботи менеджера сесій"""
        total_sessions = len(self.active_sessions)
        total_messages = sum(session.get("message_count", 0) for session in self.active_sessions.values())
        
        return {
            "total_active_sessions": total_sessions,
            "total_messages_sent": total_messages,
            "active_session_names": list(self.active_sessions.keys()),
            "goose_path": self.goose_path,
            "goose_available": Path(self.goose_binary).exists()
        }
