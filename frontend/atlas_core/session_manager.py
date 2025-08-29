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

    def create_session_with_verification(self, session_name: str, initial_message: str, grisha_instance = None) -> Dict:
        """
        Створює сесію з підтримкою перевірки виконання від Гріші
        Якщо завдання не виконано - Atlas циклічно дає нові завдання
        """
        try:
            logger.info(f"🆕 SessionManager: Створюю сесію з перевіркою '{session_name}'")
            logger.info(f"📝 Початкове повідомлення: {initial_message}")
            
            # Запускаємо першу спробу виконання
            execution_result = self._execute_task_attempt(session_name, initial_message)
            
            if not execution_result["success"]:
                return execution_result
            
            # Якщо Гріша доступний - перевіряємо виконання
            if grisha_instance:
                verification_cycle_result = self._run_verification_cycle(
                    session_name, initial_message, execution_result, grisha_instance
                )
                return verification_cycle_result
            else:
                # Без Гріші - повертаємо звичайний результат
                return execution_result
                
        except Exception as e:
            logger.error(f"💥 Виняток при створенні сесії з перевіркою: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def _execute_task_attempt(self, session_name: str, task_message: str) -> Dict:
        """Виконує спробу завдання через Goose"""
        try:
            cmd = [self.goose_binary, "session", "--name", session_name]
            logger.info(f"🚀 Виконую команду: {' '.join(cmd)}")
            
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=self.goose_path,
                env=self._get_goose_env()
            )
            
            input_text = f"{task_message}\nexit\n"
            logger.info(f"📤 Відправляю вхідні дані: {repr(input_text)}")
            
            stdout, stderr = process.communicate(input=input_text)
            
            logger.info(f"📥 Отримано відповідь (return_code: {process.returncode})")
            logger.info(f"📤 STDOUT: {stdout[:500]}..." if len(stdout) > 500 else f"📤 STDOUT: {stdout}")
            
            if process.returncode != 0:
                logger.error(f"❌ Команда завершилася з кодом помилки: {process.returncode}")
                return {
                    "success": False,
                    "error": f"Команда завершилася з кодом {process.returncode}. STDERR: {stderr}",
                    "session_name": session_name,
                    "stdout": stdout
                }
            
            # Оновлюємо інформацію про сесію
            self.active_sessions[session_name] = {
                "created": datetime.now().isoformat(),
                "last_used": datetime.now().isoformat(),
                "message_count": 1,
                "task_description": task_message
            }
            
            return {
                "success": True,
                "session_name": session_name,
                "response": stdout,
                "stderr": stderr,
                "return_code": process.returncode
            }
            
        except Exception as e:
            logger.error(f"💥 Помилка виконання завдання: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def _run_verification_cycle(self, session_name: str, original_task: str, execution_result: Dict, grisha_instance) -> Dict:
        """
        Запускає цикл перевірки з Гришею:
        1. Гріша перевіряє виконання через власну сесію
        2. Якщо не виконано - Atlas дає нове завдання  
        3. Повторюється до успіху або максимальних спроб
        """
        max_attempts = 3
        attempt = 1
        
        logger.info(f"🔄 SessionManager: Початок циклу перевірки для сесії '{session_name}'")
        
        while attempt <= max_attempts:
            logger.info(f"🕵️ SessionManager: Спроба перевірки {attempt}/{max_attempts}")
            
            try:
                # Гріша перевіряє виконання завдання
                verification_result = grisha_instance.verify_task_completion(
                    original_task, 
                    session_info={"name": session_name, "attempt": attempt}
                )
                
                logger.info(f"📊 Результат перевірки Гріші: {verification_result}")
                
                # Якщо завдання виконано успішно
                if verification_result.get("task_completed", False):
                    logger.info(f"✅ Гріша підтвердив успішне виконання завдання!")
                    
                    # Перевіряємо чи треба залишити сесію активною
                    should_keep_alive = verification_result.get("should_continue_session", False)
                    
                    if should_keep_alive:
                        logger.info(f"⏳ Сесія '{session_name}' залишається активною")
                        return {
                            "success": True,
                            "session_name": session_name,
                            "response": execution_result.get("response", ""),
                            "task_completed": True,
                            "session_alive": True,
                            "verification_details": verification_result.get("verification_details", "")
                        }
                    else:
                        logger.info(f"🔚 Сесія '{session_name}' може бути закрита")
                        return {
                            "success": True,
                            "session_name": session_name,
                            "response": execution_result.get("response", ""),
                            "task_completed": True,
                            "session_alive": False,
                            "verification_details": verification_result.get("verification_details", "")
                        }
                
                # Якщо завдання не виконано - пробуємо ще раз
                else:
                    logger.warning(f"❌ Гріша визначив що завдання не виконано: {verification_result.get('verification_details', '')}")
                    
                    next_action = verification_result.get("next_action")
                    
                    if next_action == "retry_task" and attempt < max_attempts:
                        logger.info(f"🔄 Atlas: Даю повторне завдання для сесії '{session_name}'")
                        
                        # Формуємо нове завдання на основі аналізу
                        retry_message = self._generate_retry_message(original_task, verification_result, attempt)
                        
                        # Виконуємо повторну спробу
                        retry_result = self._execute_task_retry(session_name, retry_message)
                        
                        if retry_result["success"]:
                            execution_result = retry_result
                            attempt += 1
                            continue
                        else:
                            logger.error(f"❌ Помилка при повторній спробі: {retry_result.get('error')}")
                            break
                    
                    elif next_action == "modify_approach" and attempt < max_attempts:
                        logger.info(f"🔧 Atlas: Модифікую підхід для сесії '{session_name}'")
                        
                        # Генеруємо модифіковане завдання
                        modified_message = self._generate_modified_approach(original_task, verification_result, attempt)
                        
                        # Виконуємо з новим підходом
                        modified_result = self._execute_task_retry(session_name, modified_message)
                        
                        if modified_result["success"]:
                            execution_result = modified_result
                            attempt += 1
                            continue
                        else:
                            logger.error(f"❌ Помилка при модифікованому підході: {modified_result.get('error')}")
                            break
                    
                    else:
                        logger.warning(f"⚠️ Не можу продовжити: {next_action}, спроба {attempt}/{max_attempts}")
                        break
                        
            except Exception as e:
                logger.error(f"💥 Помилка в циклі перевірки: {str(e)}")
                break
        
        # Якщо дійшли сюди - завдання не виконано після всіх спроб
        logger.error(f"❌ Завдання не виконано після {max_attempts} спроб")
        return {
            "success": False,
            "session_name": session_name,
            "response": execution_result.get("response", ""),
            "task_completed": False,
            "error": f"Завдання не виконано після {max_attempts} спроб перевірки",
            "verification_details": "Максимальна кількість спроб перевищена"
        }

    def _generate_retry_message(self, original_task: str, verification_result: Dict, attempt: int) -> str:
        """Генерує повідомлення для повторної спроби"""
        retry_details = verification_result.get("verification_details", "")
        
        return f"""Попередня спроба не повністю виконала завдання.

Оригінальне завдання: {original_task}

Деталі перевірки: {retry_details}

Спроба #{attempt + 1}: Спробуй інший підхід або метод для досягнення мети.

Директиви:
1. Проаналізуй що саме не вдалося в попередній спробі
2. Спробуй альтернативний метод або інструмент
3. Переконайся що результат дійсно досягнуто
4. Продовжуй доки не досягнеш успіху"""

    def _generate_modified_approach(self, original_task: str, verification_result: Dict, attempt: int) -> str:
        """Генерує модифікований підхід до завдання"""
        verification_details = verification_result.get("verification_details", "")
        
        return f"""Потрібен ІНШИЙ підхід до виконання завдання.

Оригінальне завдання: {original_task}

Причина зміни підходу: {verification_details}

Модифікована спроба #{attempt + 1}: Використай АЛЬТЕРНАТИВНИЙ метод або інструмент.

Директиви:
1. НЕ повторюй попередній підхід
2. Спробуй інші доступні інструменти
3. Застосуй креативний або нестандартний метод
4. Фокусуйся на ДОСЯГНЕННІ результату, не на методі
5. Адаптуйся та експериментуй до успіху"""

    def _execute_task_retry(self, session_name: str, retry_message: str) -> Dict:
        """Виконує повторну спробу завдання в існуючій сесії"""
        try:
            logger.info(f"🔄 SessionManager: Повторна спроба для сесії '{session_name}'")
            
            # Відновлюємо сесію і відправляємо нове завдання
            cmd = [self.goose_binary, "session", "--name", session_name, "--resume"]
            
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=self.goose_path,
                env=self._get_goose_env()
            )
            
            input_text = f"{retry_message}\nexit\n"
            logger.info(f"📤 Відправляю повторне завдання: {repr(input_text[:200])}...")
            
            stdout, stderr = process.communicate(input=input_text)
            
            logger.info(f"📥 Отримано відповідь повторної спроби (return_code: {process.returncode})")
            
            # Оновлюємо статистику сесії
            if session_name in self.active_sessions:
                self.active_sessions[session_name]["last_used"] = datetime.now().isoformat()
                self.active_sessions[session_name]["message_count"] += 1
            
            return {
                "success": process.returncode == 0,
                "session_name": session_name,
                "response": stdout,
                "stderr": stderr,
                "return_code": process.returncode
            }
            
        except Exception as e:
            logger.error(f"💥 Помилка повторної спроби: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

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
                
                stdout, stderr = process.communicate(input=input_text)  # Без тайм-ауту
                
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
            
            stdout, stderr = process.communicate(input=input_text)  # Без тайм-ауту - нехай Гріша моніторить
            
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

    def execute_command(self, message: str, intent_analysis: Dict, session_strategy: Dict, grisha_instance = None) -> Dict:
        """Основний метод виконання команди з підтримкою перевірки Гріші"""
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
            # Створити нову сесію з підтримкою перевірки від Гріші
            session_name = execution_plan["session_name"]
            
            # Використовуємо новий метод якщо Гріша доступний та це завдання
            if grisha_instance and self._is_task_message(message):
                result = self.create_session_with_verification(session_name, message, grisha_instance)
                result["execution_type"] = "session_create_verified"
            else:
                result = self.create_session(session_name, message)
                result["execution_type"] = "session_create"
        
        # Додаємо метадані
        result["timestamp"] = datetime.now().isoformat()
        result["intent"] = intent_analysis.get("intent", "unknown")
        result["confidence"] = intent_analysis.get("confidence", 0.0)
        
        return result

    def _is_task_message(self, message: str) -> bool:
        """Перевіряє чи повідомлення є завданням що потребує перевірки"""
        try:
            # Завдання зазвичай містять дієслова та інструкції
            task_indicators = [
                'виконай', 'створи', 'запусти', 'відкрий', 'знайди', 'установи', 
                'завантаж', 'перевір', 'перегляд', 'аналізуй', 'генеруй'
            ]
            
            message_lower = message.lower()
            has_indicators = any(indicator in message_lower for indicator in task_indicators)
            is_long_enough = len(message) > 20
            
            print(f"🔍 SessionManager: _is_task_message - довжина: {len(message)}, індикатори: {has_indicators}")
            return is_long_enough and has_indicators
        except Exception as e:
            print(f"⚠️ Помилка в _is_task_message: {e}")
            return False

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
