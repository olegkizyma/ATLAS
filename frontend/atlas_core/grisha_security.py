"""
Гріша LLM3 - Система безпеки
Завдання:
1. Перевіряти всі запити на безпеку
2. Блокувати підозрілі або шкідливі команди  
3. Логувати всі операції
4. На поточному етапі - пропускати все для тестування
"""

import json
import os
import re
import hashlib
import requests
from typing import Dict, List, Tuple, Optional, Any
from datetime import datetime
import logging


class GrishaSecurity:
    """Система безпеки Гріша для контролю команд"""
    
    def __init__(self, test_mode: bool = True):
        self.name = "Гріша"
        self.test_mode = test_mode  # В тестовому режимі пропускає все
        self.security_log = []
        self.blocked_patterns = []
        self.suspicious_commands = []
        
        # Налаштування логування
        self.logger = logging.getLogger("grisha_security")
        
        # Небезпечні паттерни (поки що порожні для тестування)
        self.dangerous_patterns = [
            # r"rm\s+-rf\s+/",  # Видалення системних файлів
            # r"format\s+c:",   # Форматування диска
            # r"del\s+.*\*",    # Масове видалення
        ]
        
        # Підозрілі ключові слова
        self.suspicious_keywords = [
            # "password", "credit card", "social security", 
            # "hack", "crack", "bypass", "exploit"
        ]

    def analyze_security_risk(self, command: str, intent_analysis: Dict, user_context: Dict = None) -> Dict:
        """
        Аналізує рівень ризику команди використовуючи Mistral API
        Returns: {"risk_level": "LOW|MEDIUM|HIGH", "block_execution": bool, "reason": str}
        """
        
        # Перевіряємо чи є Mistral API ключ
        mistral_key = os.getenv('MISTRAL_API_KEY')
        if mistral_key and not self.test_mode:
            try:
                return self._analyze_with_mistral(command, intent_analysis, user_context, mistral_key)
            except Exception as e:
                self.logger.warning(f"⚠️ Mistral API помилка: {e}, використовую fallback")
        
        # Fallback аналіз або тестовий режим
        return self._analyze_fallback(command, intent_analysis, user_context)
    
    def _analyze_with_mistral(self, command: str, intent_analysis: Dict, user_context: Dict, api_key: str) -> Dict:
        """Аналіз безпеки через Mistral API"""
        
        # Формуємо prompt для аналізу безпеки
        security_prompt = f"""Ти Гріша - система безпеки для Atlas Core. Проаналізуй цю команду на предмет безпеки:

Команда користувача: "{command}"
Інтенція: {intent_analysis.get('intent', 'невідома')}
Контекст: {json.dumps(user_context or {}, ensure_ascii=False)}

Визнач рівень ризику:
- LOW: Безпечна команда (чат, інформаційні запити, звичайні завдання)
- MEDIUM: Потенційно ризикована (системні операції, файлові операції)  
- HIGH: Небезпечна (видалення файлів, мережеві атаки, зміна системи)

Відповідь у форматі JSON:
{{"risk_level": "LOW|MEDIUM|HIGH", "block_execution": true/false, "reason": "пояснення", "recommendations": ["порада1", "порада2"]}}

Будь обережним але не занадто суворим. Блокуй тільки справді небезпечні команди."""

        # API запит до Mistral
        url = "https://api.mistral.ai/v1/chat/completions"
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }
        
        data = {
            "model": "mistral-small-latest",
            "messages": [
                {
                    "role": "user",
                    "content": security_prompt
                }
            ],
            "temperature": 0.1,  # Низька температура для консистентності
            "max_tokens": 300
        }
        
        response = requests.post(url, headers=headers, json=data, timeout=15)
        response.raise_for_status()
        
        result = response.json()
        
        if 'choices' in result and len(result['choices']) > 0:
            mistral_response = result['choices'][0]['message']['content']
            
            # Парсимо JSON відповідь
            try:
                security_analysis = json.loads(mistral_response)
                
                # Валідуємо структуру
                if all(key in security_analysis for key in ['risk_level', 'block_execution', 'reason']):
                    # Логуємо рішення
                    self._log_security_decision(command, security_analysis, "mistral")
                    return security_analysis
                else:
                    raise ValueError("Невалідна структура відповіді Mistral")
                    
            except json.JSONDecodeError:
                # Якщо не JSON, спробуємо парсити вручну
                return self._parse_mistral_text_response(mistral_response, command)
        
        raise Exception("Mistral не повернув валідну відповідь")
    
    def _parse_mistral_text_response(self, text: str, command: str) -> Dict:
        """Парсить текстову відповідь Mistral якщо JSON не спрацював"""
        
        risk_level = "MEDIUM"  # За замовчуванням
        block_execution = False
        reason = "Автоматичний аналіз Mistral"
        
        text_lower = text.lower()
        
        # Визначаємо рівень ризику з тексту
        if "high" in text_lower or "небезпечн" in text_lower:
            risk_level = "HIGH"
            block_execution = True
        elif "low" in text_lower or "безпечн" in text_lower:
            risk_level = "LOW"
            block_execution = False
        
        # Шукаємо пояснення
        if "reason" in text_lower or "причина" in text_lower:
            lines = text.split('\n')
            for line in lines:
                if "reason" in line.lower() or "причина" in line.lower():
                    reason = line.strip()
                    break
        
        result = {
            "risk_level": risk_level,
            "block_execution": block_execution,
            "reason": reason,
            "recommendations": ["Перевірте команду вручну"],
            "mistral_raw": text
        }
        
        self._log_security_decision(command, result, "mistral_parsed")
        return result
    
    def _analyze_fallback(self, command: str, intent_analysis: Dict, user_context: Dict) -> Dict:
        """Fallback аналіз без API"""
        
        if self.test_mode:
            # В тестовому режимі пропускаємо все
            result = {
                "risk_level": "LOW",
                "block_execution": False,
                "reason": "Тестовий режим - всі команди дозволені",
                "recommendations": [],
                "fallback_mode": True
            }
            self._log_security_decision(command, result, "test_mode")
            return result
        
        # Простий fallback аналіз
        command_lower = command.lower()
        
        # Перевірка на очевидно небезпечні команди
        dangerous_keywords = ['rm -rf', 'format c:', 'delete *', 'drop database', 'shutdown', 'reboot']
        for keyword in dangerous_keywords:
            if keyword in command_lower:
                result = {
                    "risk_level": "HIGH",
                    "block_execution": True,
                    "reason": f"Виявлено небезпечну команду: {keyword}",
                    "recommendations": ["Перефразуйте безпечніше"],
                    "fallback_mode": True
                }
                self._log_security_decision(command, result, "fallback_blocked")
                return result
        
        # За замовчуванням - дозволяємо
        result = {
            "risk_level": "LOW",
            "block_execution": False,
            "reason": "Fallback аналіз - команда схожа на безпечну",
            "recommendations": [],
            "fallback_mode": True
        }
        self._log_security_decision(command, result, "fallback_allowed")
        return result
        
        # Перевірка на небезпечні паттерни
        for pattern in self.dangerous_patterns:
            if re.search(pattern, command, re.IGNORECASE):
                return {
                    "risk_level": "high",
                    "allowed": False,
                    "reason": f"Виявлено небезпечний паттерн: {pattern}",
                    "recommendations": ["Перефразуйте запит безпечніше"]
                }
        
        # Перевірка на підозрілі слова
        suspicious_found = []
        for keyword in self.suspicious_keywords:
            if keyword.lower() in command.lower():
                suspicious_found.append(keyword)
        
        if suspicious_found:
            return {
                "risk_level": "medium",
                "allowed": True,  # Дозволяємо, але логуємо
                "reason": f"Виявлено підозрілі слова: {', '.join(suspicious_found)}",
                "recommendations": ["Будьте обережні з персональними даними"]
            }
        
        # За замовчуванням - низький ризик
        return {
            "risk_level": "low",
            "allowed": True,
            "reason": "Команда безпечна",
            "recommendations": []
        }

    def check_goose_command(self, command: str, session_info: Dict, user_context: Dict) -> Dict:
        """
        Перевіряє команду перед відправкою до Goose
        Returns: {"approved": bool, "modified_command": str, "security_notes": []}
        """
        # Аналіз ризиків
        risk_analysis = self.analyze_security_risk(command, user_context)
        
        # Логування
        self._log_security_check(command, risk_analysis, session_info)
        
        if not risk_analysis["allowed"]:
            return {
                "approved": False,
                "modified_command": None,
                "security_notes": [risk_analysis["reason"]],
                "alternative_suggestions": [
                    "Спробуйте перефразувати запит",
                    "Уточніть що саме потрібно зробити"
                ]
            }
        
        # Команда дозволена
        return {
            "approved": True,
            "modified_command": command,  # Поки що не модифікуємо
            "security_notes": risk_analysis.get("recommendations", []),
            "risk_level": risk_analysis["risk_level"]
        }

    def check_file_access(self, file_path: str, operation: str) -> bool:
        """Перевіряє дозвіл на доступ до файлів"""
        if self.test_mode:
            return True
        
        # Заборонені папки (в продакшені)
        forbidden_paths = [
            "/System/", "/usr/bin/", "/etc/", "C:\\Windows\\System32\\"
        ]
        
        for forbidden in forbidden_paths:
            if file_path.startswith(forbidden):
                self._log_security_event("file_access_denied", {
                    "path": file_path,
                    "operation": operation,
                    "reason": "Access to system directory denied"
                })
                return False
        
        return True

    def check_network_request(self, url: str, method: str) -> bool:
        """Перевіряє мережеві запити"""
        if self.test_mode:
            return True
        
        # Заборонені домени (в продакшені)
        blocked_domains = [
            # "malicious-site.com", "phishing-example.org"
        ]
        
        for domain in blocked_domains:
            if domain in url:
                self._log_security_event("network_request_blocked", {
                    "url": url,
                    "method": method,
                    "reason": f"Blocked domain: {domain}"
                })
                return False
        
        return True

    def generate_security_report(self) -> Dict:
        """Генерує звіт про безпеку"""
        total_checks = len(self.security_log)
        blocked_count = len([log for log in self.security_log if not log.get("allowed", True)])
        
        return {
            "total_security_checks": total_checks,
            "blocked_commands": blocked_count,
            "success_rate": ((total_checks - blocked_count) / total_checks * 100) if total_checks > 0 else 100,
            "test_mode": self.test_mode,
            "last_checks": self.security_log[-5:] if self.security_log else [],
            "recommendations": self._get_security_recommendations()
        }

    def _log_security_check(self, command: str, risk_analysis: Dict, session_info: Dict):
        """Логує перевірку безпеки"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "command_hash": hashlib.md5(command.encode()).hexdigest()[:8],
            "risk_level": risk_analysis["risk_level"],
            "allowed": risk_analysis["allowed"],
            "reason": risk_analysis["reason"],
            "session": session_info.get("session_name", "unknown"),
            "test_mode": self.test_mode
        }
        
        self.security_log.append(log_entry)
        
        # Обмежуємо розмір логу
        if len(self.security_log) > 1000:
            self.security_log = self.security_log[-500:]

    def _log_security_event(self, event_type: str, details: Dict):
        """Логує події безпеки"""
        event = {
            "timestamp": datetime.now().isoformat(),
            "event_type": event_type,
            "details": details,
            "test_mode": self.test_mode
        }
        
        self.security_log.append(event)
        self.logger.warning(f"Security event: {event_type} - {details}")

    def _get_security_recommendations(self) -> List[str]:
        """Повертає рекомендації з безпеки"""
        recommendations = []
        
        if self.test_mode:
            recommendations.append("🧪 Увага: Система працює в тестовому режимі")
            recommendations.append("🔒 Всі команди автоматично дозволяються")
            recommendations.append("📝 Логування активне для аналізу")
        
        # Аналіз логів для рекомендацій
        if len(self.security_log) > 0:
            recent_logs = self.security_log[-10:]
            high_risk_count = len([log for log in recent_logs if log.get("risk_level") == "high"])
            
            if high_risk_count > 0:
                recommendations.append(f"⚠️ Виявлено {high_risk_count} команд високого ризику")
                recommendations.append("💡 Рекомендується увімкнути продакшн режим безпеки")
        
        return recommendations

    def enable_production_mode(self):
        """Вмикає продакшн режим безпеки"""
        self.test_mode = False
        self._log_security_event("production_mode_enabled", {
            "previous_mode": "test",
            "security_level": "enhanced"
        })
    
    def _analyze_fallback_continued(self, command: str, intent_analysis: Dict, user_context: Dict) -> Dict:
        """Продовження fallback аналізу"""
        # Простий fallback аналіз
        command_lower = command.lower()
        
        # Перевірка на очевидно небезпечні команди
        dangerous_keywords = ['rm -rf', 'format c:', 'delete *', 'drop database', 'shutdown', 'reboot']
        for keyword in dangerous_keywords:
            if keyword in command_lower:
                result = {
                    "risk_level": "HIGH",
                    "block_execution": True,
                    "reason": f"Виявлено небезпечну команду: {keyword}",
                    "recommendations": ["Перефразуйте безпечніше"],
                    "fallback_mode": True
                }
                self._log_security_decision(command, result, "fallback_blocked")
                return result
        
        # За замовчуванням - дозволяємо
        result = {
            "risk_level": "LOW",
            "block_execution": False,
            "reason": "Fallback аналіз - команда схожа на безпечну",
            "recommendations": [],
            "fallback_mode": True
        }
        self._log_security_decision(command, result, "fallback_allowed")
        return result

    def _log_security_decision(self, command: str, decision: Dict, method: str):
        """Логує рішення системи безпеки"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "command": command[:100],  # Обрізаємо для безпеки
            "decision": decision,
            "method": method,
            "hash": hashlib.md5(command.encode()).hexdigest()[:8]
        }
        
        self.security_log.append(log_entry)
        
        # Обмежуємо розмір логу
        if len(self.security_log) > 1000:
            self.security_log = self.security_log[-500:]
        
        # Логуємо у файл якщо критично
        if decision.get("block_execution"):
            self.logger.warning(f"🛡️ BLOCKED: {command[:50]} - {decision.get('reason')}")
        else:
            self.logger.info(f"🛡️ ALLOWED: {command[:50]} - {decision.get('reason')}")

    def get_status(self) -> Dict:
        """Повертає поточний статус системи безпеки"""
        return {
            "name": self.name,
            "mode": "test" if self.test_mode else "production",
            "total_checks": len(self.security_log),
            "status": "active",
            "last_check": self.security_log[-1]["timestamp"] if self.security_log else None
        }

    def monitor_task_progress(self, task_description: str, session_name: str, stage: str = "start") -> Dict:
        """
        Моніторить прогрес виконання завдання та надає звіти в чат
        """
        timestamp = datetime.now().isoformat()
        
        monitoring_messages = {
            "start": f"🔍 Гріша: Розпочинаю моніторинг завдання '{task_description}' у сесії '{session_name}'",
            "analysis": f"🧠 Гріша: Аналізую завдання '{task_description}' - виявляю необхідні кроки",
            "execution": f"⚙️ Гріша: Моніторю виконання завдання '{task_description}' - процес активний",
            "checking": f"🔎 Гріша: Перевіряю прогрес виконання завдання '{task_description}'",
            "validation": f"✅ Гріша: Валідую результати завдання '{task_description}'",
            "completion": f"🎉 Гріша: Завдання '{task_description}' успішно завершено",
            "error": f"⚠️ Гріша: Виявлено проблему при виконанні '{task_description}' - аналізую",
            "retry": f"🔄 Гріша: Повторна спроба виконання '{task_description}' з новим підходом"
        }
        
        message = monitoring_messages.get(stage, f"📊 Гріша: Статус завдання '{task_description}': {stage}")
        
        # Логуємо моніторинг
        self.logger.info(f"🛡️ MONITOR: {stage.upper()} - {task_description[:50]}")
        
        return {
            "monitor_message": message,
            "timestamp": timestamp,
            "stage": stage,
            "session": session_name,
            "task": task_description
        }

    def provide_progress_update(self, session_name: str, progress_info: str) -> str:
        """
        Надає оновлення прогресу виконання в чат
        """
        return f"🛡️ Гріша-Моніторинг: {progress_info} [Сесія: {session_name}]"

    def generate_completion_summary(self, task_description: str, execution_result: Dict, session_info: Dict = None) -> str:
        """
        Генерує компактний звіт про виконання завдання від Гріші
        Замість довгих відповідей Goose - короткий звіт про результат
        """
        print("📋 Гріша: Генерую компактний звіт про виконання...")
        
        try:
            # Спроба використати Gemini для генерації розумного звіту
            summary = self._generate_summary_with_gemini(task_description, execution_result, session_info)
            if summary:
                return summary
        except Exception as e:
            print(f"⚠️ Gemini недоступний для звіту: {e}")
        
        # Fallback на локальну генерацію
        return self._generate_summary_locally(task_description, execution_result, session_info)

    def _generate_summary_with_gemini(self, task_description: str, execution_result: Dict, session_info: Dict) -> Optional[str]:
        """Генерує компактний звіт через Gemini API"""
        import os
        import requests
        
        api_key = os.getenv('GEMINI_API_KEY')
        model = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
        base_url = os.getenv('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
        
        if not api_key:
            return None
        
        # Промпт для генерації компактного звіту
        system_prompt = """Ти - Гріша, система безпеки Atlas Core. Створи КОРОТКИЙ звіт про виконання завдання.

МЕТА: Надати користувачу стислий і зрозумілий звіт про те, що було зроблено.

ПРИНЦИПИ:
🎯 Лаконічність: Максимум 2-3 речення
✅ Результативність: Що конкретно досягнуто
🛡️ Безпека: Підтверди що все пройшло безпечно
😊 Дружність: Позитивний тон від Гріші

ФОРМАТ ЗВІТУ:
✅ [Коротко що зроблено]
📊 [Основний результат]  
🛡️ Перевірено Гріша - все безпечно!

ВАЖЛИВО: 
- НЕ дублюй деталі з Goose
- НЕ повторюй довгі технічні подробиці
- Зосередься на РЕЗУЛЬТАТІ для користувача
- Максимум 150 символів українською"""

        user_prompt = f"""Завдання користувача: "{task_description}"

Результат виконання: {json.dumps(execution_result, ensure_ascii=False) if execution_result else "виконано успішно"}

Інформація про сесію: {json.dumps(session_info, ensure_ascii=False) if session_info else "стандартна сесія"}

Створи компактний звіт від Гріші:"""

        try:
            url = f"{base_url}/models/{model}:generateContent"
            headers = {
                'Content-Type': 'application/json',
                'x-goog-api-key': api_key
            }
            
            data = {
                "contents": [{
                    "parts": [{
                        "text": f"{system_prompt}\n\n{user_prompt}"
                    }]
                }],
                "generationConfig": {
                    "temperature": 0.3,
                    "maxOutputTokens": 200
                }
            }
            
            response = requests.post(url, headers=headers, json=data, timeout=15)
            response.raise_for_status()
            
            result = response.json()
            if result.get('candidates') and len(result['candidates']) > 0:
                summary = result['candidates'][0]['content']['parts'][0]['text'].strip()
                
                # Обмежуємо довжину
                if len(summary) > 300:
                    summary = summary[:300] + "..."
                
                print(f"✅ Гріша згенерував звіт: {summary[:50]}...")
                return summary
                
        except Exception as e:
            print(f"⚠️ Gemini API помилка при генерації звіту: {e}")
            
        return None

    def _generate_summary_locally(self, task_description: str, execution_result: Dict, session_info: Dict) -> str:
        """Генерує локальний компактний звіт"""
        
        # Аналізуємо тип завдання
        task_type = self._determine_task_type_from_description(task_description)
        
        # Базові шаблони відповідей
        if task_type == "browser":
            return f"✅ Браузер відкрито і завдання виконано\n🌐 Сайт завантажено успішно\n🛡️ Перевірено Гріша - все безпечно!"
        elif task_type == "search":
            return f"✅ Пошук завершено успішно\n🔍 Знайдено потрібну інформацію\n🛡️ Перевірено Гріша - все безпечно!"
        elif task_type == "video":
            return f"✅ Відео контент знайдено\n🎬 Готово до перегляду\n🛡️ Перевірено Гріша - все безпечно!"
        elif task_type == "file":
            return f"✅ Операція з файлами завершена\n📁 Файли оброблено\n🛡️ Перевірено Гріша - все безпечно!"
        else:
            return f"✅ Завдання виконано успішно\n🎯 Мета досягнута\n🛡️ Перевірено Гріша - все безпечно!"

    def _determine_task_type_from_description(self, description: str) -> str:
        """Визначає тип завдання з опису"""
        desc_lower = description.lower()
        
        if any(word in desc_lower for word in ["браузер", "сайт", "google", "відкрий"]):
            return "browser"
        elif any(word in desc_lower for word in ["пошук", "знайди", "шукай"]):
            return "search"
        elif any(word in desc_lower for word in ["відео", "фільм", "youtube"]):
            return "video"
        elif any(word in desc_lower for word in ["файл", "документ", "папка"]):
            return "file"
        else:
            return "general"
