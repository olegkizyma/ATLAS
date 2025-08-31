"""
Core Orchestrator - Центральний оркестратор системи Atlas Core
Координує роботу всіх трьох компонентів:
1. Atlas LLM1 - аналіз інтенцій і стратегії
2. Goose - виконання завдань через Session Manager  
3. Гріша LLM3 - безпека і валідація команд
"""

import json
import asyncio
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
from pathlib import Path

from .atlas_llm import AtlasLLM
from .grisha_security import GrishaSecurity
from .session_manager import SessionManager


class CoreOrchestrator:
    """Центральний оркестратор системи Atlas Core"""
    
    def __init__(self, goose_path: str = "/Users/dev/Documents/GitHub/ATLAS/goose"):
        """Ініціалізація всіх компонентів"""
        
        # Ініціалізуємо компоненти
        self.atlas_llm = AtlasLLM()
        self.grisha_security = GrishaSecurity()
        self.session_manager = SessionManager(goose_path)
        
        # Статистика роботи
        self.stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "security_blocks": 0,
            "chat_responses": 0,
            "task_executions": 0,
            "session_continuations": 0,
            "start_time": datetime.now().isoformat()
        }
        
        # Конфігурація
        self.config = {
            "enable_security": True,
            "enable_logging": True,
            "max_response_length": 10000,
            "default_timeout": 300
        }

    async def process_user_message(self, user_message: str, user_context: Dict = None) -> Dict:
        """
        Розумна обробка повідомлення користувача з автодоповненням та компактними звітами
        Проходить через всі три компоненти Atlas Core
        """
        start_time = datetime.now()
        self.stats["total_requests"] += 1
        
        try:
            # === ПЕРЕВІРКА КОМАНД КЕРУВАННЯ СЕСІЯМИ ===
            print(f"🔧 Перевіряю команди керування сесіями...")
            
            # Швидкий аналіз чи це команда керування сесіями
            session_analysis = self.atlas_llm._analyze_session_management_intent(user_message)
            
            if session_analysis["is_session_command"]:
                print(f"🎯 Виявлено команду сесії: {session_analysis['action']}")
                
                session_response = self._handle_session_command(
                    session_analysis, user_context, start_time
                )
                
                self.stats["successful_requests"] += 1
                return session_response
            
            # === КРОК 1: ATLAS LLM1 - РОЗУМНА ОБРОБКА З АВТОДОПОВНЕННЯМ ===
            print(f"🧠 Atlas LLM1: Розумна обробка повідомлення з автодоповненням...")
            
            # Використовуємо новий розумний метод обробки
            atlas_processing = self.atlas_llm.process_user_message(user_message, user_context, [])
            
            response_data = {
                "timestamp": start_time.isoformat(),
                "user_message": user_message,
                "atlas_processing": atlas_processing,
                "processing_steps": []
            }
            
            # Логування розумної обробки Atlas
            step1 = {
                "step": 1,
                "component": "Atlas LLM1",
                "action": "smart_processing",
                "result": {
                    "response_type": atlas_processing.get("response_type"),
                    "auto_enriched": atlas_processing.get("auto_enriched", False),
                    "clarification_handled": atlas_processing.get("clarification_handled", False)
                },
                "timestamp": datetime.now().isoformat()
            }
            response_data["processing_steps"].append(step1)
            
            # Якщо Atlas обробив як чат - повертаємо відповідь
            if atlas_processing.get("response_type") == "direct":
                self.stats["chat_responses"] += 1
                self.stats["successful_requests"] += 1
                
                response_data.update({
                    "response_type": "chat",
                    "atlas_response": atlas_processing.get("response"),
                    "success": True,
                    "processing_time": (datetime.now() - start_time).total_seconds(),
                    "atlas_core": True
                })
                
                return response_data
            
            # === КРОК 2: ГРІША LLM3 - ПЕРЕВІРКА БЕЗПЕКИ ===
            if self.config["enable_security"]:
                print(f"�️ Гріша LLM3: Перевіряю безпеку завдання...")
                
                working_message = atlas_processing.get("working_message", user_message)
                detailed_instruction = atlas_processing.get("detailed_instruction", working_message)
                
                security_check = self.grisha_security.analyze_security_risk(
                    detailed_instruction,
                    atlas_processing.get("intent_analysis", {}), 
                    user_context
                )
                
                # Логування перевірки безпеки
                step2 = {
                    "step": 2,
                    "component": "Гріша LLM3",
                    "action": "security_check",
                    "checked_content": detailed_instruction,
                    "result": security_check,
                    "timestamp": datetime.now().isoformat()
                }
                response_data["processing_steps"].append(step2)
                
                # Якщо заблоковано - повертаємо помилку
                if security_check.get("risk_level") == "HIGH" and security_check.get("block_execution"):
                    self.stats["security_blocks"] += 1
                    self.stats["failed_requests"] += 1
                    
                    response_data.update({
                        "response_type": "security_block",
                        "security_analysis": security_check,
                        "blocked": True,
                        "success": False,
                        "error": "Command blocked by security system",
                        "processing_time": (datetime.now() - start_time).total_seconds()
                    })
                    
                    return response_data
                
                response_data["security_analysis"] = security_check
            
            # === КРОК 3: GOOSE - ВИКОНАННЯ ЗАВДАННЯ ===
            print(f"� Goose: Виконую завдання...")
            
            # Гріша починає моніторинг
            session_strategy = atlas_processing.get("session_action", {})
            session_name = session_strategy.get("session_name", f"smart_session_{int(datetime.now().timestamp())}")
            
            monitor_start = self.grisha_security.monitor_task_progress(
                atlas_processing.get("working_message", user_message), session_name, "start"
            )
            print(monitor_start["monitor_message"])
            
            # Виконуємо завдання з підтримкою перевірки від Гріші
            execution_result = self.session_manager.execute_command(
                atlas_processing.get("detailed_instruction"),
                atlas_processing.get("intent_analysis", {}),
                session_strategy,
                self.grisha_security  # Передаємо Гришу для перевірки
            )
            
            # Логування виконання
            step3 = {
                "step": 3,
                "component": "Goose",
                "action": "task_execution",
                "executed_instruction": atlas_processing.get("detailed_instruction"),
                "original_message": user_message,
                "working_message": atlas_processing.get("working_message"),
                "result": {
                    "success": execution_result.get("success"),
                    "execution_type": execution_result.get("execution_type"),
                    "session_name": execution_result.get("session_name")
                },
                "timestamp": datetime.now().isoformat()
            }
            response_data["processing_steps"].append(step3)
            
            # === КРОК 4: ОБРОБКА РЕЗУЛЬТАТІВ З ПЕРЕВІРКОЮ ===
            print(f"📋 Гріша: Аналізую результати виконання...")
            
            if execution_result.get("success"):
                # Визначаємо чи була перевірка
                task_completed = execution_result.get("task_completed")
                session_alive = execution_result.get("session_alive", False)
                verification_details = execution_result.get("verification_details", "")
                
                if task_completed is not None:
                    # Була перевірка від Гріші
                    if task_completed:
                        print(f"✅ Гріша підтвердив: завдання виконано успішно!")
                        if session_alive:
                            print(f"⏳ Сесія залишається активною для тривалого використання")
                        else:
                            print(f"🔚 Сесія завершена - завдання виконано")
                        
                        compact_summary = verification_details or self.grisha_security.generate_completion_summary(
                            atlas_processing.get("working_message", user_message),
                            execution_result,
                            {"session_name": session_name, "verified": True, "session_alive": session_alive}
                        )
                    else:
                        print(f"❌ Гріша: завдання не виконано після перевірок")
                        compact_summary = f"❌ Завдання не вдалося виконати. {verification_details}"
                else:
                    # Звичайне виконання без перевірки Гріші
                    print(f"📝 Звичайне виконання - генерую звіт...")
                    compact_summary = self.grisha_security.generate_completion_summary(
                        atlas_processing.get("working_message", user_message),
                        execution_result,
                        {"session_name": session_name, "auto_enriched": atlas_processing.get("auto_enriched", False)}
                    )
                
                monitor_complete = self.grisha_security.monitor_task_progress(
                    atlas_processing.get("working_message", user_message), session_name, "completion"
                )
                print(monitor_complete["monitor_message"])
                
                self.stats["successful_requests"] += 1
                self.stats["task_executions"] += 1
                
                # Повертаємо результат з інформацією про перевірку
                response_data.update({
                    "response_type": "task_execution",
                    "response": compact_summary,  # КОРОТКИЙ звіт від Гріші
                    "success": True,
                    "task_completed": task_completed,
                    "session_alive": session_alive,
                    "verification_details": verification_details,
                    "execution_type": execution_result.get("execution_type", "unknown"),
                    "session_info": {
                        "strategy": session_strategy.get("strategy"), 
                        "session_name": session_name,
                        "alive": session_alive
                    },
                    "processing_time": (datetime.now() - start_time).total_seconds(),
                    "atlas_core": True,
                    "intent": atlas_processing.get("intent_analysis", {}).get("intent"),
                    "confidence": atlas_processing.get("intent_analysis", {}).get("confidence")
                })
                
            else:
                # Розумний аналіз чи це етична відмова Goose через Gemini
                execution_output = execution_result.get("output", "")
                execution_error = execution_result.get("error", "")
                goose_response = execution_output + " " + execution_error
                
                print("🧠 Аналізую причину відмови Goose через Gemini...")
                is_ethical_refusal = self._analyze_ethical_refusal(user_message, goose_response)
                
                if is_ethical_refusal:
                    # Goose відмовився з етичних причин - це нормально
                    print("🤔 Goose відмовився з етичних міркувань - генерую пояснення")
                    
                    # Генеруємо природне пояснення через Gemini
                    ethical_explanation = self._generate_ethical_explanation(
                        user_message, goose_response
                    )
                    
                    self.stats["successful_requests"] += 1  # Це не помилка, а правильна поведінка
                    
                    response_data.update({
                        "response_type": "ethical_refusal", 
                        "response": ethical_explanation,
                        "success": True,  # Система працює правильно
                        "ethical_refusal": True,
                        "refusal_reason": "Goose відмовився з етичних міркувань",
                        "goose_explanation": goose_response,
                        "processing_time": (datetime.now() - start_time).total_seconds(),
                        "atlas_core": True
                    })
                else:
                    # Справжня технічна помилка
                    monitor_error = self.grisha_security.monitor_task_progress(
                        atlas_processing.get("working_message", user_message), session_name, "error"
                    )
                    print(monitor_error["monitor_message"])
                    
                    self.stats["failed_requests"] += 1
                    
                    response_data.update({
                        "response_type": "task_execution",
                        "response": f"⚠️ Виникла технічна помилка при виконанні завдання. Спробуйте пізніше або переформулюйте запит.",
                        "success": False,
                        "error_details": execution_result.get("error", ""),
                        "processing_time": (datetime.now() - start_time).total_seconds(),
                        "atlas_core": True
                    })
            
            return response_data
            
        except Exception as e:
            self.stats["failed_requests"] += 1
            
            error_response = {
                "timestamp": start_time.isoformat(),
                "user_message": user_message,
                "response_type": "error",
                "success": False,
                "error": str(e),
                "processing_time": (datetime.now() - start_time).total_seconds(),
                "atlas_core": True
            }
            
            if self.config["enable_logging"]:
                print(f"❌ Помилка в CoreOrchestrator: {e}")
            
        
        return error_response

    async def process_user_message_stream(self, user_message: str, user_context: Dict = None):
        """Асинхронний генератор подій для покрокового SSE-стріму.
        Yield-ить словники подій: {"event": str, ...}
        """
        start_time = datetime.now()
        try:
            # 1) Команди керування сесіями
            session_analysis = self.atlas_llm._analyze_session_management_intent(user_message)
            if session_analysis["is_session_command"]:
                yield {
                    "event": "session_command_detected",
                    "data": session_analysis,
                    "timestamp": start_time.isoformat(),
                }
                result = self._handle_session_command(session_analysis, user_context, start_time)
                result.update({"event": "final"})
                yield result
                return

            # 2) Atlas LLM1 розумна обробка
            yield {"event": "atlas_processing_start", "timestamp": datetime.now().isoformat()}
            atlas_processing = self.atlas_llm.process_user_message(user_message, user_context or {}, [])
            yield {
                "event": "atlas_processing",
                "data": {
                    "response_type": atlas_processing.get("response_type"),
                    "auto_enriched": atlas_processing.get("auto_enriched", False),
                    "clarification_handled": atlas_processing.get("clarification_handled", False),
                    "intent": atlas_processing.get("intent_analysis", {}).get("intent"),
                    "confidence": atlas_processing.get("intent_analysis", {}).get("confidence"),
                },
                "timestamp": datetime.now().isoformat(),
            }

            if atlas_processing.get("response_type") == "direct":
                yield {
                    "event": "final",
                    "response_type": "chat",
                    "atlas_response": atlas_processing.get("response"),
                    "success": True,
                    "atlas_core": True,
                    "processing_time": (datetime.now() - start_time).total_seconds(),
                }
                return

            # 3) Перевірка безпеки (Гріша)
            yield {"event": "security_check_start", "timestamp": datetime.now().isoformat()}
            working_message = atlas_processing.get("working_message", user_message)
            detailed_instruction = atlas_processing.get("detailed_instruction", working_message)
            security_check = self.grisha_security.analyze_security_risk(
                detailed_instruction, atlas_processing.get("intent_analysis", {}), user_context
            )
            yield {
                "event": "security_check_result",
                "data": security_check,
                "timestamp": datetime.now().isoformat(),
            }
            if security_check.get("risk_level") == "HIGH" and security_check.get("block_execution"):
                yield {
                    "event": "final",
                    "response_type": "security_block",
                    "security_analysis": security_check,
                    "blocked": True,
                    "success": False,
                    "atlas_core": True,
                    "processing_time": (datetime.now() - start_time).total_seconds(),
                    "error": "Command blocked by security system",
                }
                return

            # 4) Виконання завдання (Goose)
            session_strategy = atlas_processing.get("session_action", {})
            session_name = session_strategy.get("session_name", f"smart_session_{int(datetime.now().timestamp())}")
            yield {
                "event": "execution_start",
                "session": {"name": session_name, "strategy": session_strategy.get("strategy")},
                "timestamp": datetime.now().isoformat(),
            }
            execution_result = self.session_manager.execute_command(
                atlas_processing.get("detailed_instruction"),
                atlas_processing.get("intent_analysis", {}),
                session_strategy,
                self.grisha_security,
            )
            yield {
                "event": "execution_result",
                "data": {
                    "success": execution_result.get("success"),
                    "execution_type": execution_result.get("execution_type"),
                    "session_name": execution_result.get("session_name"),
                },
                "timestamp": datetime.now().isoformat(),
            }

            if execution_result.get("success"):
                task_completed = execution_result.get("task_completed")
                session_alive = execution_result.get("session_alive", False)
                verification_details = execution_result.get("verification_details", "")
                if task_completed is not None:
                    if task_completed:
                        compact_summary = verification_details or self.grisha_security.generate_completion_summary(
                            working_message, execution_result, {"session_name": session_name, "verified": True, "session_alive": session_alive}
                        )
                    else:
                        compact_summary = f"❌ Завдання не вдалося виконати. {verification_details}"
                else:
                    compact_summary = self.grisha_security.generate_completion_summary(
                        working_message, execution_result, {"session_name": session_name, "auto_enriched": atlas_processing.get("auto_enriched", False)}
                    )

                yield {
                    "event": "final",
                    "response_type": "task_execution",
                    "response": compact_summary,
                    "success": True,
                    "task_completed": task_completed,
                    "session_alive": session_alive,
                    "verification_details": verification_details,
                    "execution_type": execution_result.get("execution_type", "unknown"),
                    "session_info": {"strategy": session_strategy.get("strategy"), "session_name": session_name, "alive": session_alive},
                    "processing_time": (datetime.now() - start_time).total_seconds(),
                    "atlas_core": True,
                    "intent": atlas_processing.get("intent_analysis", {}).get("intent"),
                    "confidence": atlas_processing.get("intent_analysis", {}).get("confidence"),
                }
                return

            # 5) Випадки відмови
            execution_output = execution_result.get("output", "")
            execution_error = execution_result.get("error", "")
            goose_response = (execution_output + " " + execution_error).strip()
            is_ethical_refusal = self._analyze_ethical_refusal(user_message, goose_response)
            if is_ethical_refusal:
                ethical_explanation = self._generate_ethical_explanation(user_message, goose_response)
                yield {
                    "event": "final",
                    "response_type": "ethical_refusal",
                    "response": ethical_explanation,
                    "success": True,
                    "ethical_refusal": True,
                    "goose_explanation": goose_response,
                    "processing_time": (datetime.now() - start_time).total_seconds(),
                    "atlas_core": True,
                }
            else:
                yield {
                    "event": "final",
                    "response_type": "task_execution",
                    "response": "⚠️ Виникла технічна помилка при виконанні завдання. Спробуйте пізніше або переформулюйте запит.",
                    "success": False,
                    "error_details": execution_result.get("error", ""),
                    "processing_time": (datetime.now() - start_time).total_seconds(),
                    "atlas_core": True,
                }
        except Exception as e:
            yield {
                "event": "final",
                "response_type": "error",
                "success": False,
                "error": str(e),
                "atlas_core": True,
                "timestamp": datetime.now().isoformat(),
            }

    def _analyze_ethical_refusal(self, user_request: str, goose_response: str) -> bool:
        """Розумний аналіз чи Goose відмовився з етичних причин через Gemini"""
        
        try:
            analysis_prompt = f"""Проаналізуй чи це етична відмова від виконання завдання.

ЗАПИТ КОРИСТУВАЧА: "{user_request}"

ВІДПОВІДЬ СИСТЕМИ: "{goose_response}"

ЗАВДАННЯ: Визнач чи система відмовилася виконувати завдання з етичних, правових або моральних причин.

Етичні відмови включають:
- Порушення авторських прав
- Незаконна діяльність  
- Піратство
- Шкідливий контент
- Порушення правил платформ
- Етичні принципи ШІ

Відповідай ТІЛЬКИ: "ТАК" (якщо це етична відмова) або "НІ" (якщо це технічна помилка)"""

            # Аналізуємо через Gemini
            analysis_result = self.atlas_llm._call_gemini_api(analysis_prompt, {})
            
            if analysis_result:
                return "ТАК" in analysis_result.upper() or "YES" in analysis_result.upper()
            else:
                return False
                
        except Exception as e:
            print(f"Помилка аналізу етичної відмови: {e}")
            return False

    def _generate_ethical_explanation(self, user_message: str, goose_response: str) -> str:
        """Генерує природне пояснення чому Goose відмовився з етичних причин"""
        
        try:
            # Формуємо контекст для Atlas
            context_prompt = f"""Ти Atlas - жива особистість у системі ATLAS Core. 
            
            СИТУАЦІЯ:
            Користувач просив: "{user_message}"
            Goose (виконавець завдань) відповів: "{goose_response}"
            
            ВАЖЛИВИЙ КОНТЕКСТ:
            - Зараз система працює в ТЕСТУВАЛЬНОМУ режимі
            - За технічну безпеку відповідає Гріша (блокує шкідливі команди)
            - За етику та законність відповідає сам Goose
            - Goose має право відмовлятися від неетичних завдань
            
            ТВОЄ ЗАВДАННЯ:
            - Поясни що Goose сам прийняв рішення з етичних міркувань
            - Підкресли що це ТЕСТУВАЛЬНИЙ режим системи
            - Будь розуміючим але ясним щодо обмежень
            - НЕ звинувачуй користувача
            - Запропонуй легальні альтернативи якщо можливо
            - Поясни розподіл відповідальності (Гріша vs Goose)
            
            Відповідай природно як жива особистість Atlas, українською мовою."""
            
            # Генеруємо через Gemini
            explanation = self.atlas_llm._call_gemini_api(context_prompt, {})
            
            if explanation:
                return explanation
            else:
                # Fallback якщо Gemini недоступний
                return self._fallback_ethical_explanation(user_message)
                
        except Exception as e:
            print(f"Помилка генерації етичного пояснення: {e}")
            return self._fallback_ethical_explanation(user_message)

    def _fallback_ethical_explanation(self, user_message: str) -> str:
        """Резервне пояснення етичної відмови"""
        return f"""Розумію ваш запит, але Goose (наш виконавець завдань) вирішив що не може це зробити з етичних міркувань.

⚙️ **Важливо**: Зараз система працює в **тестувальному режимі**!

🤖 **Розподіл відповідальності у нас**:
• **Goose** - сам вирішує про етичність та законність завдань
• **Гріша** - відповідає тільки за технічну безпеку системи (захист від шкідливих команд)

Goose діє правильно, дотримуючись етичних принципів та законодавства. Це нормальна поведінка системи! 

Можливо, варто переформулювати запит або шукати легальні альтернативи? 🤔"""

    def get_system_status(self) -> Dict:
        """Повертає статус всієї системи Atlas Core"""
        
        # Статус компонентів
        atlas_status = self.atlas_llm.get_status()
        grisha_status = self.grisha_security.get_status()
        session_status = self.session_manager.get_stats()
        
        # Загальна статистика
        total_requests = self.stats["total_requests"]
        success_rate = (self.stats["successful_requests"] / total_requests * 100) if total_requests > 0 else 0
        
        system_status = {
            "atlas_core": {
                "version": "1.0.0",
                "status": "active",
                "uptime": self._calculate_uptime(),
                "success_rate": round(success_rate, 2)
            },
            "components": {
                "atlas_llm": atlas_status,
                "grisha_security": grisha_status, 
                "session_manager": session_status
            },
            "statistics": self.stats.copy(),
            "configuration": self.config.copy()
        }
        
        return system_status

    def get_available_sessions(self) -> List[Dict]:
        """Повертає список доступних сесій Goose"""
        return self.session_manager.get_available_sessions()

    def create_new_session(self, session_name: str, initial_message: str = None) -> Dict:
        """Створює нову сесію Goose з підтримкою перевірки від Гріші"""
        # Використовуємо новий метод з перевіркою якщо це завдання
        if initial_message and self._is_task_execution(initial_message):
            return self.session_manager.create_session_with_verification(
                session_name, initial_message, self.grisha_security
            )
        else:
            # Звичайна сесія без перевірки
            return self.session_manager.create_session(session_name, initial_message)

    def _is_task_execution(self, message: str) -> bool:
        """Визначає чи це виконання завдання (потребує перевірки Гріші)"""
        # Використовуємо Atlas LLM для визначення
        try:
            analysis = self.atlas_llm.analyze_intent(message)
            return analysis.get("type") == "task_execution"
        except Exception:
            # Fallback - якщо повідомлення довге та містить інструкції
            return len(message) > 50 and any(word in message.lower() for word in [
                'завдання', 'виконай', 'створи', 'запусти', 'відкрий', 'знайди'
            ])

    def continue_session(self, session_name: str, message: str) -> Dict:
        """Продовжує існуючу сесію"""
        return self.session_manager.send_to_session(session_name, message, resume=True)

    def cleanup_old_sessions(self, max_age_hours: int = 24) -> Dict:
        """Очищає старі сесії"""
        return self.session_manager.cleanup_old_sessions(max_age_hours)

    def update_configuration(self, new_config: Dict) -> Dict:
        """Оновлює конфігурацію системи"""
        allowed_keys = ["enable_security", "enable_logging", "max_response_length", "default_timeout"]
        updated_keys = []
        
        for key, value in new_config.items():
            if key in allowed_keys:
                self.config[key] = value
                updated_keys.append(key)
        
        return {
            "success": True,
            "updated_keys": updated_keys,
            "current_config": self.config.copy()
        }

    def _calculate_uptime(self) -> str:
        """Розраховує час роботи системи"""
        start_time = datetime.fromisoformat(self.stats["start_time"])
        uptime = datetime.now() - start_time
        
        days = uptime.days
        hours, remainder = divmod(uptime.seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        
        return f"{days}d {hours}h {minutes}m {seconds}s"

    def reset_statistics(self) -> Dict:
        """Скидає статистику системи"""
        old_stats = self.stats.copy()
        
        self.stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "security_blocks": 0,
            "chat_responses": 0,
            "task_executions": 0,
            "session_continuations": 0,
            "start_time": datetime.now().isoformat()
        }
        
        return {
            "success": True,
            "old_statistics": old_stats,
            "reset_time": datetime.now().isoformat()
        }

    def health_check(self) -> Dict:
        """Перевіряє здоров'я всієї системи"""
        health_status = {
            "overall_health": "healthy",
            "components": {},
            "issues": [],
            "timestamp": datetime.now().isoformat()
        }
        
        # Перевіряємо Atlas LLM
        try:
            atlas_test = self.atlas_llm.analyze_user_intent("test", {})
            health_status["components"]["atlas_llm"] = "healthy"
        except Exception as e:
            health_status["components"]["atlas_llm"] = "unhealthy"
            health_status["issues"].append(f"Atlas LLM: {str(e)}")
            health_status["overall_health"] = "degraded"
        
        # Перевіряємо Гріша
        try:
            grisha_test = self.grisha_security.analyze_security_risk("test", {}, {})
            health_status["components"]["grisha_security"] = "healthy"
        except Exception as e:
            health_status["components"]["grisha_security"] = "unhealthy"
            health_status["issues"].append(f"Гріша Security: {str(e)}")
            health_status["overall_health"] = "degraded"
        
        # Перевіряємо Session Manager
        try:
            session_stats = self.session_manager.get_stats()
            if session_stats.get("goose_available"):
                health_status["components"]["session_manager"] = "healthy"
            else:
                health_status["components"]["session_manager"] = "unhealthy"
                health_status["issues"].append("Session Manager: Goose binary not available")
                health_status["overall_health"] = "degraded"
        except Exception as e:
            health_status["components"]["session_manager"] = "unhealthy"
            health_status["issues"].append(f"Session Manager: {str(e)}")
            health_status["overall_health"] = "critical"
        
        # Якщо є критичні проблеми
        if len(health_status["issues"]) >= 2:
            health_status["overall_health"] = "critical"
        
        return health_status

    # === МЕТОДИ КЕРУВАННЯ СЕСІЯМИ ===
    def close_session_by_user(self, session_name: str, user_context: Dict = None) -> Dict:
        """Закриває конкретну сесію за командою користувача"""
        return self.session_manager.close_session_by_user(session_name, user_context)

    def close_all_sessions_by_user(self, user_context: Dict = None) -> Dict:
        """Закриває всі сесії за командою користувача"""
        return self.session_manager.close_all_sessions_by_user(user_context)

    def list_active_sessions_for_user(self) -> Dict:
        """Повертає список активних сесій для користувача"""
        return self.session_manager.list_active_sessions_for_user()

    def get_available_sessions(self) -> List[Dict]:
        """Отримує доступні сесії (з Goose + активні)"""
        return self.session_manager.get_available_sessions()

    def _handle_session_command(self, session_analysis: Dict, user_context: Dict, start_time) -> Dict:
        """Обробляє команди керування сесіями"""
        action = session_analysis["action"]
        target = session_analysis.get("target")
        
        response_data = {
            "timestamp": start_time.isoformat(),
            "user_message": f"Команда керування сесіями: {action}",
            "response_type": "session_management",
            "atlas_core": True,
            "processing_time": (datetime.now() - start_time).total_seconds()
        }
        
        try:
            if action == "list":
                # Показати активні сесії
                sessions_info = self.list_active_sessions_for_user()
                active_sessions = sessions_info["active_sessions"]
                
                if active_sessions:
                    session_list = "\n".join([
                        f"• {s['name']} - {s['message_count']} повідомлень (остання активність: {s['last_used']})"
                        for s in active_sessions
                    ])
                    response = f"📋 Активні сесії ({len(active_sessions)}):\n{session_list}\n\n💡 Щоб закрити сесію, напишіть: 'закрий сесію [назва]'"
                else:
                    response = "📋 Немає активних сесій.\n💡 Сесії створюються автоматично при виконанні завдань."
                
                response_data.update({
                    "response": response,
                    "session_info": sessions_info,
                    "success": True
                })
                
            elif action == "close_all":
                # Закрити всі сесії
                result = self.close_all_sessions_by_user(user_context)
                
                if result["success"]:
                    response = f"✅ {result['message']}\n📊 Закрито сесій: {', '.join(result['closed_sessions'])}" if result['closed_sessions'] else "✅ Всі сесії закриті (активних не було)"
                else:
                    response = f"❌ Помилка: {result.get('error', 'Невідома помилка')}"
                
                response_data.update({
                    "response": response,
                    "session_result": result,
                    "success": result["success"]
                })
                
            elif action == "close_specific":
                # Закрити конкретну сесію
                if target == "unspecified":
                    # Запитати яку сесію закрити
                    sessions_info = self.list_active_sessions_for_user()
                    active_sessions = sessions_info["active_sessions"]
                    
                    if active_sessions:
                        session_names = [s['name'] for s in active_sessions]
                        response = f"🤔 Яку саме сесію закрити?\n📋 Доступні сесії: {', '.join(session_names)}\n💡 Напишіть: 'закрий сесію [назва]'"
                    else:
                        response = "📋 Немає активних сесій для закриття."
                        
                    response_data.update({
                        "response": response,
                        "session_info": sessions_info,
                        "success": True,
                        "requires_clarification": True
                    })
                else:
                    # Закрити вказану сесію
                    result = self.close_session_by_user(target, user_context)
                    
                    if result["success"]:
                        response = f"✅ {result['message']}"
                    else:
                        response = f"❌ {result['error']}\n📋 Доступні сесії: {', '.join(result.get('available_sessions', []))}"
                    
                    response_data.update({
                        "response": response,
                        "session_result": result,
                        "success": result["success"]
                    })
            
            else:
                response_data.update({
                    "response": f"❌ Невідома команда керування сесіями: {action}",
                    "success": False,
                    "error": f"Unsupported session action: {action}"
                })
                
        except Exception as e:
            response_data.update({
                "response": f"❌ Помилка при обробці команди сесії: {str(e)}",
                "success": False,
                "error": str(e)
            })
        
        return response_data


# Глобальний екземпляр для використання в atlas_minimal_live.py
atlas_core = None

def get_atlas_core(goose_path: str = "/Users/dev/Documents/GitHub/ATLAS/goose") -> CoreOrchestrator:
    """Отримує глобальний екземпляр Atlas Core"""
    global atlas_core
    if atlas_core is None:
        atlas_core = CoreOrchestrator(goose_path)
    return atlas_core
