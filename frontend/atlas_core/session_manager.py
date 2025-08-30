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
import requests
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
        
        # Конфігурація HTTP API
        self.api_url = os.getenv("GOOSE_API_URL", "http://localhost:3000")
        self.secret_key = os.getenv("GOOSE_SECRET_KEY", "test")
        self.use_http_api = os.getenv("USE_GOOSE_HTTP_API", "true").lower() == "true"
        
        # Перевіряємо наявність Goose (CLI або API)
        if not self.use_http_api and not Path(self.goose_binary).exists():
            raise FileNotFoundError(f"Goose binary not found at {self.goose_binary}")
        elif self.use_http_api:
            logger.info(f"🕸️ SessionManager: Використовуємо HTTP API: {self.api_url}")
        else:
            logger.info(f"💻 SessionManager: Використовуємо CLI: {self.goose_binary}")

    def _send_api_request(self, endpoint: str, method: str = "GET", data: dict = None) -> dict:
        """Відправка запиту до Goose HTTP API"""
        try:
            url = f"{self.api_url}{endpoint}"
            headers = {"X-Secret-Key": self.secret_key}
            
            if method == "POST":
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers, timeout=30)
            else:
                response = requests.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                return {"success": True, "data": response.json()}
            else:
                return {"success": False, "error": f"HTTP {response.status_code}", "response": response.text}
                
        except requests.exceptions.RequestException as e:
            return {"success": False, "error": str(e)}

    def get_available_sessions(self) -> List[Dict]:
        """Отримує список доступних сесій з Goose"""
        try:
            if self.use_http_api:
                # Використовуємо HTTP API
                result = self._send_api_request("/sessions", "GET")
                if result["success"]:
                    sessions_data = result["data"]
                    sessions = []
                    for session in sessions_data.get("sessions", []):
                        sessions.append({
                            "name": session.get("name", ""),
                            "description": session.get("description", "No description"),
                            "timestamp": session.get("timestamp", ""),
                            "active": session.get("name", "") in self.active_sessions
                        })
                    return sessions
                else:
                    logger.warning(f"⚠️ HTTP API недоступний для sessions: {result['error']}")
                    # Fallback до CLI
                    return self._get_sessions_cli()
            else:
                # Використовуємо CLI
                return self._get_sessions_cli()
            
        except Exception as e:
            logger.error(f"Error getting sessions: {e}")
            return []

    def _get_sessions_cli(self) -> List[Dict]:
        """Отримує список сесій через CLI (fallback метод)"""
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
            logger.error(f"CLI Error getting sessions: {e}")
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
        """Виконує спробу завдання через Goose з підтримкою HTTP API"""
        try:
            cmd = [self.goose_binary, "session", "--name", session_name]
            logger.info(f"🚀 Виконую команду: {' '.join(cmd)}")
            
            if self.use_http_api:
                # Використовуємо HTTP API
                result = self._send_api_request("/sessions", "POST", {
                    "name": session_name,
                    "message": task_message
                })
                
                if result["success"]:
                    session_data = result["data"]
                    
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
                        "response": session_data.get("response", ""),
                        "stderr": session_data.get("stderr", ""),
                        "return_code": session_data.get("return_code", 0)
                    }
                else:
                    logger.warning(f"⚠️ HTTP API недоступний для виконання завдання: {result['error']}")
                    # Fallback до CLI
                    return self._execute_task_attempt_cli(session_name, task_message)
            else:
                # Використовуємо CLI
                return self._execute_task_attempt_cli(session_name, task_message)
            
        except Exception as e:
            logger.error(f"💥 Помилка виконання завдання: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def _execute_task_attempt_cli(self, session_name: str, task_message: str) -> Dict:
        """Виконує спробу завдання через CLI (fallback метод)"""
        try:
            cmd = [self.goose_binary, "session", "--name", session_name]
            logger.info(f"🚀 Виконую команду CLI: {' '.join(cmd)}")
            
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
            logger.error(f"💥 Помилка виконання завдання CLI: {str(e)}")
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
                    
                    # 🆕 НОВА ФУНКЦІОНАЛЬНІСТЬ: Atlas автоматично створює детальне завдання на основі аналізу Гріші
                    detailed_task = self._create_detailed_correction_task(original_task, verification_result, attempt)
                    logger.info(f"📋 Atlas створив детальне завдання для виправлення: {detailed_task[:200]}...")
                    
                    # Зберігаємо детальне завдання в контекст сесії
                    if session_name not in self.session_contexts:
                        self.session_contexts[session_name] = {}
                    self.session_contexts[session_name][f"correction_attempt_{attempt}"] = {
                        "detailed_task": detailed_task,
                        "grisha_feedback": verification_result.get("verification_details", ""),
                        "timestamp": datetime.now().isoformat()
                    }
                    
                    next_action = verification_result.get("next_action")
                    
                    if next_action == "retry_task" and attempt < max_attempts:
                        logger.info(f"🔄 Atlas: Даю детальне завдання для сесії '{session_name}'")
                        
                        # Використовуємо детальне завдання замість загального retry
                        retry_message = detailed_task
                        
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
                        
                        # Використовуємо детальне завдання з модифікованим підходом
                        modified_message = detailed_task
                        
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

    def _create_detailed_correction_task(self, original_task: str, verification_result: Dict, attempt: int) -> str:
        """
        🆕 НОВА ФУНКЦІЯ: Створює детальне завдання на основі аналізу Гріші
        
        Коли Гриша виявляє, що завдання не виконано, Atlas автоматично створює
        детальне завдання з конкретними кроками для виправлення проблеми.
        """
        verification_details = verification_result.get("verification_details", "")
        next_action = verification_result.get("next_action_needed", "retry_task")
        
        # Аналізуємо проблему з деталей Гріші
        problem_analysis = self._analyze_grisha_feedback(verification_details)
        
        # Створюємо детальний план виправлення
        correction_steps = self._generate_correction_steps(original_task, problem_analysis, attempt)
        
        detailed_task = f"""🔧 ДЕТАЛЬНЕ ЗАВДАННЯ ДЛЯ ВИПРАВЛЕННЯ (Спроба #{attempt + 1})

📋 ОРИГІНАЛЬНЕ ЗАВДАННЯ: {original_task}

❌ ПРОБЛЕМА ВИЯВЛЕНА ГРИШЕЮ:
{verification_details}

🔍 АНАЛІЗ ПРОБЛЕМИ:
{problem_analysis}

📝 ДЕТАЛЬНИЙ ПЛАН ВИПРАВЛЕННЯ:
{correction_steps}

⚠️ КРИТИЧНІ ВИМОГИ:
1. Обов'язково виконай ВСІ кроки по порядку
2. Перевір результат кожного кроку перед переходом до наступного
3. Якщо крок не спрацював - спробуй альтернативний метод
4. НЕ завершуй роботу поки не досягнеш повного результату
5. У разі помилки - докладно опиши що сталося і спробуй інший підхід

🎯 ОЧІКУВАНИЙ РЕЗУЛЬТАТ: {self._define_expected_result(original_task)}

🔄 Почни виконання ЗАРАЗ і звітуй про кожен крок!"""

        steps_count = len(correction_steps.split('\n'))
        logger.info(f"📋 Atlas створив детальне завдання з {steps_count} кроків")
        return detailed_task

    def _analyze_grisha_feedback(self, verification_details: str) -> str:
        """🧠 ІНТЕЛЕКТУАЛЬНИЙ аналіз фідбеку від Гріші"""
        analysis = []
        
        # Використовуємо AI для аналізу замість хардкоду
        try:
            # Інтелектуальний аналіз через Gemini/GPT
            ai_analysis = self._ai_analyze_failure(verification_details)
            if ai_analysis:
                return ai_analysis
        except Exception as e:
            logger.warning(f"⚠️ AI аналіз недоступний: {e}")
        
        # Fallback: базовий семантичний аналіз
        return self._semantic_failure_analysis(verification_details)

    def _ai_analyze_failure(self, verification_details: str) -> str:
        """🤖 AI-аналіз причин невдачі через LLM"""
        try:
            # Спроба використати Gemini через існуючу інфраструктуру
            if hasattr(self, '_call_gemini_analysis'):
                prompt = f"""Проаналізуй чому завдання не було виконано успішно:

ДЕТАЛІ ПЕРЕВІРКИ: {verification_details}

Надай конкретний аналіз проблеми у форматі:
• Основна причина: ...
• Технічні деталі: ...
• Рекомендації: ..."""
                
                analysis = self._call_gemini_analysis(prompt)
                if analysis:
                    return analysis
                    
            # Поки що повертаємо None для fallback
            return None
            
        except Exception as e:
            logger.warning(f"⚠️ AI аналіз недоступний: {e}")
            return None

    def _ai_generate_solution_steps(self, original_task: str, problem_analysis: str, attempt: int) -> str:
        """🤖 AI генерація кроків рішення через LLM"""
        try:
            if hasattr(self, '_call_gemini_solution'):
                prompt = f"""Створи детальні кроки для виправлення завдання:

ОРИГІНАЛЬНЕ ЗАВДАННЯ: {original_task}
АНАЛІЗ ПРОБЛЕМИ: {problem_analysis}  
НОМЕР СПРОБИ: {attempt + 1}

Згенеруй 4-6 конкретних кроків у форматі:
КРОК 1: [назва]
   - [деталь 1]
   - [деталь 2]
КРОК 2: [назва]
   - [деталь 1]
   - [деталь 2]
..."""
                
                steps = self._call_gemini_solution(prompt)
                if steps:
                    return steps
                    
            return None
            
        except Exception as e:
            logger.warning(f"⚠️ AI генерація кроків недоступна: {e}")
            return None

    def _ai_define_expected_outcome(self, original_task: str) -> str:
        """🤖 AI визначення очікуваного результату через LLM"""
        try:
            if hasattr(self, '_call_gemini_outcome'):
                prompt = f"""Визначи точний очікуваний результат для завдання:

ЗАВДАННЯ: {original_task}

Надай короткий опис успішного результату у форматі:
"[Конкретний результат що має бути досягнутий]"

Приклад: "Програма Calculator запущена і показує результат обчислення 2×333=666" """
                
                outcome = self._call_gemini_outcome(prompt)
                if outcome:
                    return outcome.strip('"')
                    
            return None
            
        except Exception as e:
            logger.warning(f"⚠️ AI визначення результату недоступне: {e}")
            return None

    def _semantic_failure_analysis(self, verification_details: str) -> str:
        """🔍 Семантичний аналіз помилок без хардкоду"""
        text_lower = verification_details.lower()
        analysis_points = []
        
        # Категорії проблем (без прив'язки до конкретних програм)
        if any(term in text_lower for term in ['failed', 'error', 'помилка', 'не вдалося']):
            analysis_points.append("• Виявлено технічні помилки під час виконання")
        
        if any(term in text_lower for term in ['not running', 'not found', 'не запущено', 'відсутній']):
            analysis_points.append("• Цільова програма або процес не активні")
        
        if any(term in text_lower for term in ['display', 'показ', 'відображ', 'result', 'результат']):
            analysis_points.append("• Проблема з відображенням або отриманням результату")
        
        if any(term in text_lower for term in ['timeout', 'time out', 'час', 'таймаут']):
            analysis_points.append("• Перевищено час очікування операції")
        
        # Якщо нічого не знайдено - загальний аналіз
        if not analysis_points:
            analysis_points.append(f"• Загальна проблема: {verification_details[:150]}...")
        
        return "\n".join(analysis_points)

    def _generate_correction_steps(self, original_task: str, problem_analysis: str, attempt: int) -> str:
        """🧠 ІНТЕЛЕКТУАЛЬНА генерація кроків виправлення"""
        
        try:
            # Спробуємо інтелектуальну генерацію через AI
            ai_steps = self._ai_generate_solution_steps(original_task, problem_analysis, attempt)
            if ai_steps:
                return ai_steps
        except Exception as e:
            logger.warning(f"⚠️ AI генерація кроків недоступна: {e}")
        
        # Fallback: адаптивна генерація на основі аналізу
        return self._adaptive_solution_generation(original_task, problem_analysis, attempt)

    def _ai_generate_solution_steps(self, original_task: str, problem_analysis: str, attempt: int) -> str:
        """🤖 AI генерація кроків рішення через LLM"""
        # TODO: Інтеграція з Gemini/GPT для розумної генерації кроків
        # Поки що повертаємо None для використання adaptive fallback
        return None

    def _adaptive_solution_generation(self, original_task: str, problem_analysis: str, attempt: int) -> str:
        """🔄 Адаптивна генерація рішень на основе аналізу"""
        
        # Базова структура кроків
        steps = []
        
        # КРОК 1: Аналіз ситуації (завжди)
        steps.append(f"КРОК 1: Інтелектуальний аналіз ситуації")
        steps.append(f"   - Оригінальне завдання: {original_task}")
        clean_analysis = problem_analysis.replace('• ', '').replace('\n', '; ')
        steps.append(f"   - Виявлені проблеми: {clean_analysis}")
        steps.append(f"   - Визначи ТОЧНУ причину невдачі")
        
        # КРОК 2: Динамічне планування (на основі аналізу)
        if "технічні помилки" in problem_analysis.lower():
            steps.append("КРОК 2: Діагностика технічних проблем")
            steps.append("   - Перевір доступність необхідних інструментів")
            steps.append("   - Визначи альтернативні методи виконання")
        elif "не активні" in problem_analysis.lower():
            steps.append("КРОК 2: Активація необхідних компонентів")
            steps.append("   - Визначи що саме потрібно запустити")
            steps.append("   - Спробуй різні способи активації")
        else:
            steps.append("КРОК 2: Адаптивне планування")
            steps.append("   - Розбий завдання на менші частини")
            steps.append("   - Визначи найнадійніший підхід")
        
        # КРОК 3: Виконання з адаптацією
        steps.append(f"КРОК 3: Виконання з адаптацією (спроба #{attempt + 1})")
        steps.append("   - Виконуй кожну частину окремо")
        steps.append("   - Перевіряй результат після кожного кроку")
        steps.append("   - Якщо щось не працює - негайно адаптуйся")
        
        # КРОК 4: Верифікація та коригування  
        steps.append("КРОК 4: Постійна верифікація")
        steps.append("   - Перевіряй чи досягається мета")
        steps.append("   - Документуй що працює, що ні")
        steps.append("   - Продовжуй до повного успіху")
        
        return "\n".join(steps)

    def _define_expected_result(self, original_task: str) -> str:
        """🎯 ІНТЕЛЕКТУАЛЬНЕ визначення очікуваного результату"""
        
        try:
            # Спробуємо AI визначення результату
            ai_result = self._ai_define_expected_outcome(original_task)
            if ai_result:
                return ai_result
        except Exception as e:
            logger.warning(f"⚠️ AI визначення результату недоступне: {e}")
        
        # Fallback: семантичне визначення мети
        return self._semantic_goal_extraction(original_task)

    def _ai_define_expected_outcome(self, original_task: str) -> str:
        """🤖 AI визначення очікуваного результату через LLM"""
        # TODO: Інтеграція з LLM для розумного визначення мети
        return None

    def _semantic_goal_extraction(self, original_task: str) -> str:
        """🔍 Семантичне визначення мети завдання"""
        task_lower = original_task.lower()
        
        # Пошук дієслів дії для визначення мети
        if any(verb in task_lower for verb in ['відкрий', 'запусти', 'open', 'launch', 'start']):
            # Завдання на запуск
            program = self._extract_program_name(original_task)
            return f"Програма {program} успішно запущена і доступна для роботи"
        
        elif any(verb in task_lower for verb in ['обчисли', 'посчитай', 'calculate', 'compute']):
            # Завдання на обчислення  
            calculation = self._extract_calculation(original_task)
            return f"Виконано обчислення: {calculation} з коректним результатом"
        
        elif any(verb in task_lower for verb in ['створи', 'зроби', 'create', 'make']):
            # Завдання на створення
            target = self._extract_target_object(original_task)
            return f"Успішно створено: {target}"
        
        elif any(verb in task_lower for verb in ['знайди', 'шукай', 'find', 'search']):
            # Завдання на пошук
            search_target = self._extract_search_target(original_task)
            return f"Знайдено та надано: {search_target}"
        
        else:
            # Загальна мета
            return f"Повністю виконано завдання: {original_task.strip()}"

    def _extract_program_name(self, task: str) -> str:
        """Витягує назву програми з завдання"""
        # Простий regex для знаходження назв програм
        import re
        programs = re.findall(r'\b([A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)?)\b', task)
        if programs:
            return programs[0] if isinstance(programs[0], str) else programs[0][0]
        return "цільову програму"

    def _extract_calculation(self, task: str) -> str:
        """Витягує математичний вираз з завдання"""
        import re
        # Шукаємо числа та математичні операції
        numbers = re.findall(r'\b\d+\b', task)
        operations = re.findall(r'[+\-*/×÷]', task)
        
        if len(numbers) >= 2:
            return f"{numbers[0]} {operations[0] if operations else '×'} {numbers[1]}"
        return "обчислення"

    def _extract_target_object(self, task: str) -> str:
        """Витягує об'єкт для створення"""
        # Шукаємо іменники після дієслів створення
        task_words = task.lower().split()
        create_verbs = ['створи', 'зроби', 'create', 'make']
        
        for i, word in enumerate(task_words):
            if word in create_verbs and i + 1 < len(task_words):
                return ' '.join(task_words[i+1:i+3])  # наступні 1-2 слова
        return "цільовий об'єкт"

    def _extract_search_target(self, task: str) -> str:
        """Витягує об'єкт пошуку"""
        task_words = task.lower().split()
        search_verbs = ['знайди', 'шукай', 'find', 'search']
        
        for i, word in enumerate(task_words):
            if word in search_verbs and i + 1 < len(task_words):
                return ' '.join(task_words[i+1:i+3])  # наступні 1-2 слова
        return "результат пошуку"

    def _execute_task_retry(self, session_name: str, retry_message: str) -> Dict:
        """Виконує повторну спробу завдання в існуючій сесії з підтримкою HTTP API"""
        try:
            logger.info(f"🔄 SessionManager: Повторна спроба для сесії '{session_name}'")
            
            if self.use_http_api:
                # Використовуємо HTTP API
                result = self._send_api_request(f"/sessions/{session_name}/message", "POST", {
                    "message": retry_message,
                    "resume": True
                })
                
                if result["success"]:
                    session_data = result["data"]
                    
                    # Оновлюємо статистику сесії
                    if session_name in self.active_sessions:
                        self.active_sessions[session_name]["last_used"] = datetime.now().isoformat()
                        self.active_sessions[session_name]["message_count"] += 1
                    
                    return {
                        "success": True,
                        "session_name": session_name,
                        "response": session_data.get("response", ""),
                        "stderr": session_data.get("stderr", ""),
                        "return_code": session_data.get("return_code", 0)
                    }
                else:
                    logger.warning(f"⚠️ HTTP API недоступний для повторної спроби: {result['error']}")
                    # Fallback до CLI
                    return self._execute_task_retry_cli(session_name, retry_message)
            else:
                # Використовуємо CLI
                return self._execute_task_retry_cli(session_name, retry_message)
            
        except Exception as e:
            logger.error(f"💥 Помилка повторної спроби: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def _execute_task_retry_cli(self, session_name: str, retry_message: str) -> Dict:
        """Виконує повторну спробу завдання через CLI (fallback метод)"""
        try:
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
            logger.error(f"💥 Помилка повторної спроби CLI: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def create_session(self, session_name: str, initial_message: str = None) -> Dict:
        """Створює нову сесію Goose з підтримкою HTTP API"""
        try:
            logger.info(f"🆕 SessionManager: Створюю нову сесію '{session_name}'")
            
            if self.use_http_api:
                # Використовуємо HTTP API
                result = self._send_api_request("/sessions", "POST", {
                    "name": session_name,
                    "message": initial_message or ""
                })
                
                if result["success"]:
                    session_data = result["data"]
                    self.active_sessions[session_name] = {
                        "created": datetime.now().isoformat(),
                        "last_used": datetime.now().isoformat(),
                        "message_count": 1 if initial_message else 0
                    }
                    
                    return {
                        "success": True,
                        "session_name": session_name,
                        "created": True,
                        "response": session_data.get("response", "")
                    }
                else:
                    logger.warning(f"⚠️ HTTP API недоступний для створення сесії: {result['error']}")
                    # Fallback до CLI
                    return self._create_session_cli(session_name, initial_message)
            else:
                # Використовуємо CLI
                return self._create_session_cli(session_name, initial_message)
                
        except Exception as e:
            logger.error(f"� Виняток при створенні сесії: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def _create_session_cli(self, session_name: str, initial_message: str = None) -> Dict:
        """Створює сесію через CLI (fallback метод)"""
        try:
            if initial_message:
                logger.info(f"�📝 Початкове повідомлення: {initial_message}")
                
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
            logger.error(f"💥 Виняток при створенні сесії CLI: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def send_to_session(self, session_name: str, message: str, resume: bool = True) -> Dict:
        """Відправляє повідомлення в існуючу сесію з підтримкою HTTP API"""
        try:
            logger.info(f"🔗 SessionManager: Відправляю команду до сесії '{session_name}'")
            logger.info(f"📝 Команда: {message}")
            
            if self.use_http_api:
                # Використовуємо HTTP API
                result = self._send_api_request(f"/sessions/{session_name}/message", "POST", {
                    "message": message,
                    "resume": resume
                })
                
                if result["success"]:
                    session_data = result["data"]
                    
                    # Оновлюємо статистику сесії
                    if session_name in self.active_sessions:
                        self.active_sessions[session_name]["last_used"] = datetime.now().isoformat()
                        self.active_sessions[session_name]["message_count"] += 1
                    
                    return {
                        "success": True,
                        "session_name": session_name,
                        "response": session_data.get("response", ""),
                        "stderr": session_data.get("stderr", ""),
                        "return_code": session_data.get("return_code", 0)
                    }
                else:
                    logger.warning(f"⚠️ HTTP API недоступний для відправки повідомлення: {result['error']}")
                    # Fallback до CLI
                    return self._send_to_session_cli(session_name, message, resume)
            else:
                # Використовуємо CLI
                return self._send_to_session_cli(session_name, message, resume)
            
        except Exception as e:
            logger.error(f"💥 Виняток при відправці до сесії: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def _send_to_session_cli(self, session_name: str, message: str, resume: bool = True) -> Dict:
        """Відправляє повідомлення в сесію через CLI (fallback метод)"""
        try:
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
            logger.error(f"💥 Виняток при відправці до сесії CLI: {str(e)}")
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
        """Отримує статус конкретної сесії з підтримкою HTTP API"""
        try:
            if self.use_http_api:
                # Використовуємо HTTP API
                result = self._send_api_request(f"/sessions/{session_name}/status", "GET")
                if result["success"]:
                    session_data = result["data"]
                    return {
                        "name": session_name,
                        "status": session_data.get("status", "unknown"),
                        "created": session_data.get("created"),
                        "last_used": session_data.get("last_used"),
                        "message_count": session_data.get("message_count", 0),
                        "active": session_data.get("active", False)
                    }
                else:
                    logger.warning(f"⚠️ HTTP API недоступний для статусу сесії: {result['error']}")
                    # Fallback до локального статусу
                    return self._get_session_status_local(session_name)
            else:
                # Використовуємо локальний статус
                return self._get_session_status_local(session_name)
            
        except Exception as e:
            logger.error(f"Error getting session status: {e}")
            return None

    def _get_session_status_local(self, session_name: str) -> Optional[Dict]:
        """Отримує локальний статус сесії (fallback метод)"""
        if session_name in self.active_sessions:
            session_data = self.active_sessions[session_name]
            return {
                "name": session_name,
                "status": "active",
                "created": session_data.get("created"),
                "last_used": session_data.get("last_used"),
                "message_count": session_data.get("message_count", 0),
                "active": True
            }
        return None

    def cleanup_old_sessions(self, max_age_hours: int = 24):
        """Очищає старі неактивні сесії (ВІДКЛЮЧЕНО - сесії закриваються тільки користувачем)"""
        # ЗМІНА: Відключаємо автоматичне очищення сесій
        # Сесії тепер закриваються тільки за явною командою користувача
        logger.info("⚠️ Автоматичне очищення сесій відключено. Сесії закриваються тільки користувачем.")
        return {"removed_sessions": [], "remaining": len(self.active_sessions), "auto_cleanup_disabled": True}

    def close_session_by_user(self, session_name: str, user_context: Dict = None) -> Dict:
        """Закриває конкретну сесію за командою користувача з підтримкою HTTP API"""
        try:
            if self.use_http_api:
                # Використовуємо HTTP API
                result = self._send_api_request(f"/sessions/{session_name}", "DELETE")
                if result["success"]:
                    # Також видаляємо з локального контексту
                    if session_name in self.active_sessions:
                        session_data = self.active_sessions[session_name]
                        del self.active_sessions[session_name]
                    
                    if session_name in self.session_contexts:
                        del self.session_contexts[session_name]
                    
                    logger.info(f"✅ Користувач закрив сесію '{session_name}' через API")
                    return {
                        "success": True,
                        "message": f"Сесія '{session_name}' успішно закрита",
                        "closed_session": session_data if 'session_data' in locals() else {},
                        "remaining_sessions": len(self.active_sessions)
                    }
                else:
                    logger.warning(f"⚠️ HTTP API недоступний для закриття сесії: {result['error']}")
                    # Fallback до локального закриття
                    return self._close_session_local(session_name, user_context)
            else:
                # Використовуємо локальне закриття
                return self._close_session_local(session_name, user_context)
            
        except Exception as e:
            logger.error(f"💥 Помилка при закритті сесії: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "session_name": session_name
            }

    def _close_session_local(self, session_name: str, user_context: Dict = None) -> Dict:
        """Закриває сесію локально (fallback метод)"""
        if session_name in self.active_sessions:
            session_data = self.active_sessions[session_name]
            del self.active_sessions[session_name]
            
            # Також видаляємо з контексту
            if session_name in self.session_contexts:
                del self.session_contexts[session_name]
            
            logger.info(f"✅ Користувач закрив сесію '{session_name}' локально")
            return {
                "success": True,
                "message": f"Сесія '{session_name}' успішно закрита",
                "closed_session": session_data,
                "remaining_sessions": len(self.active_sessions)
            }
        else:
            logger.warning(f"⚠️ Спроба закрити неіснуючу сесію '{session_name}'")
            return {
                "success": False,
                "error": f"Сесія '{session_name}' не знайдена",
                "available_sessions": list(self.active_sessions.keys())
            }

    def close_all_sessions_by_user(self, user_context: Dict = None) -> Dict:
        """Закриває всі сесії за командою користувача"""
        closed_sessions = list(self.active_sessions.keys())
        session_count = len(closed_sessions)
        
        self.active_sessions.clear()
        self.session_contexts.clear()
        
        logger.info(f"✅ Користувач закрив всі сесії ({session_count} сесій)")
        return {
            "success": True,
            "message": f"Всі сесії успішно закриті ({session_count} сесій)",
            "closed_sessions": closed_sessions,
            "remaining_sessions": 0
        }

    def list_active_sessions_for_user(self) -> Dict:
        """Повертає список активних сесій для користувача"""
        sessions_info = []
        for session_name, session_data in self.active_sessions.items():
            sessions_info.append({
                "name": session_name,
                "created": session_data.get("created"),
                "last_used": session_data.get("last_used"),
                "message_count": session_data.get("message_count", 0),
                "status": "active"
            })
        
        return {
            "active_sessions": sessions_info,
            "total_count": len(sessions_info),
            "auto_cleanup_disabled": True
        }

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

    def get_session_correction_history(self, session_name: str) -> Dict:
        """
        🆕 НОВА ФУНКЦІЯ: Отримує історію виправлень для сесії
        Показує всі спроби Atlas виправити завдання на основі фідбеку Гріші
        """
        if session_name not in self.session_contexts:
            return {
                "session_name": session_name,
                "correction_history": [],
                "total_attempts": 0
            }
        
        context = self.session_contexts[session_name]
        corrections = []
        
        for key, data in context.items():
            if key.startswith("correction_attempt_"):
                attempt_num = key.replace("correction_attempt_", "")
                corrections.append({
                    "attempt": int(attempt_num),
                    "detailed_task": data.get("detailed_task", ""),
                    "grisha_feedback": data.get("grisha_feedback", ""),
                    "timestamp": data.get("timestamp", ""),
                    "task_length": len(data.get("detailed_task", "")),
                    "feedback_summary": data.get("grisha_feedback", "")[:100] + "..." if len(data.get("grisha_feedback", "")) > 100 else data.get("grisha_feedback", "")
                })
        
        # Сортуємо за номером спроби
        corrections.sort(key=lambda x: x["attempt"])
        
        return {
            "session_name": session_name,
            "correction_history": corrections,
            "total_attempts": len(corrections),
            "last_correction": corrections[-1] if corrections else None
        }

    def get_all_correction_statistics(self) -> Dict:
        """
        🆕 НОВА ФУНКЦІЯ: Статистика всіх виправлень Atlas
        Показує загальну ефективність системи автоматичного виправлення
        """
        total_corrections = 0
        sessions_with_corrections = 0
        correction_details = {}
        
        for session_name, context in self.session_contexts.items():
            session_corrections = 0
            for key in context.keys():
                if key.startswith("correction_attempt_"):
                    session_corrections += 1
                    total_corrections += 1
            
            if session_corrections > 0:
                sessions_with_corrections += 1
                correction_details[session_name] = {
                    "attempts": session_corrections,
                    "last_feedback": context.get(f"correction_attempt_{session_corrections}", {}).get("grisha_feedback", "")[:50]
                }
        
        return {
            "total_correction_attempts": total_corrections,
            "sessions_with_corrections": sessions_with_corrections,
            "sessions_without_corrections": len(self.active_sessions) - sessions_with_corrections,
            "average_corrections_per_session": total_corrections / max(1, sessions_with_corrections),
            "correction_details": correction_details,
            "system_effectiveness": "Active" if total_corrections > 0 else "Standby"
        }
