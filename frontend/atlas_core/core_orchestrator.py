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
        Головний метод обробки повідомлення користувача
        Проходить через всі три компоненти Atlas Core
        """
        start_time = datetime.now()
        self.stats["total_requests"] += 1
        
        try:
            # === КРОК 1: ATLAS LLM1 - АНАЛІЗ ІНТЕНЦІЙ ===
            print(f"🧠 Atlas LLM1: Аналізую інтенцію користувача...")
            
            intent_analysis = self.atlas_llm.analyze_user_intent(user_message, user_context)
            session_strategy = self.atlas_llm.determine_session_strategy(intent_analysis, user_context)
            
            response_data = {
                "timestamp": start_time.isoformat(),
                "user_message": user_message,
                "intent_analysis": intent_analysis,
                "session_strategy": session_strategy,
                "processing_steps": []
            }
            
            # Логування кроку 1
            step1 = {
                "step": 1,
                "component": "Atlas LLM1",
                "action": "intent_analysis",
                "result": intent_analysis,
                "timestamp": datetime.now().isoformat()
            }
            response_data["processing_steps"].append(step1)
            
            # Якщо це чат - відповідаємо напряму
            if intent_analysis.get("intent") == "chat":
                self.stats["chat_responses"] += 1
                self.stats["successful_requests"] += 1
                
                chat_response = self.atlas_llm.generate_chat_response(user_message, user_context)
                
                response_data.update({
                    "response_type": "chat",
                    "atlas_response": chat_response,
                    "success": True,
                    "processing_time": (datetime.now() - start_time).total_seconds()
                })
                
                return response_data
            
            # === КРОК 1.5: ATLAS LLM1 - ПЕРЕФОРМУЛЮВАННЯ ЗАВДАННЯ ===
            print(f"🔄 Atlas LLM1: Переформулювання завдання в детальну інструкцію...")
            
            detailed_instruction = self.atlas_llm.reformulate_task_instruction(user_message, intent_analysis)
            
            # Логування кроку 1.5
            step1_5 = {
                "step": 1.5,
                "component": "Atlas LLM1",
                "action": "task_reformulation",
                "original_message": user_message,
                "detailed_instruction": detailed_instruction,
                "timestamp": datetime.now().isoformat()
            }
            response_data["processing_steps"].append(step1_5)
            response_data["detailed_instruction"] = detailed_instruction
            
            # === КРОК 2: ГРІША LLM3 - ПЕРЕВІРКА БЕЗПЕКИ (переформульованої інструкції) ===
            if self.config["enable_security"]:
                print(f"🛡️ Гріша LLM3: Перевіряю безпеку переформульованої інструкції...")
                
                # Передаємо детальну інструкцію для перевірки безпеки
                security_check = self.grisha_security.analyze_security_risk(
                    detailed_instruction,  # Використовуємо переформульовану інструкцію
                    intent_analysis, 
                    user_context
                )
                
                # Логування кроку 2
                step2 = {
                    "step": 2,
                    "component": "Гріша LLM3",
                    "action": "security_check",
                    "checked_content": detailed_instruction,
                    "result": security_check,
                    "timestamp": datetime.now().isoformat()
                }
                response_data["processing_steps"].append(step2)
                
                # Якщо команда заблокована - повертаємо помилку
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
            
            # === КРОК 3: GOOSE - ВИКОНАННЯ ПЕРЕФОРМУЛЬОВАНОЇ КОМАНДИ ===
            print(f"🚀 Goose: Виконую детальну інструкцію...")
            
            # Гріша починає моніторинг завдання
            session_name = session_strategy.get("session_name", f"session_{int(datetime.now().timestamp())}")
            monitor_start = self.grisha_security.monitor_task_progress(
                user_message, session_name, "start"
            )
            print(monitor_start["monitor_message"])
            
            # Виконуємо переформульовану команду через Session Manager
            execution_result = self.session_manager.execute_command(
                detailed_instruction,  # Передаємо детальну інструкцію замість оригінального повідомлення
                intent_analysis,
                session_strategy
            )
            
            # Логування кроку 3
            step3 = {
                "step": 3,
                "component": "Goose",
                "action": "detailed_instruction_execution",
                "executed_instruction": detailed_instruction,
                "original_message": user_message,
                "result": {
                    "success": execution_result.get("success"),
                    "execution_type": execution_result.get("execution_type"),
                    "session_name": execution_result.get("session_name")
                },
                "timestamp": datetime.now().isoformat()
            }
            response_data["processing_steps"].append(step3)
            
            # Гріша моніторить завершення завдання
            if execution_result.get("success"):
                monitor_complete = self.grisha_security.monitor_task_progress(
                    user_message, session_name, "completion"
                )
                print(monitor_complete["monitor_message"])
            else:
                monitor_error = self.grisha_security.monitor_task_progress(
                    user_message, session_name, "error"
                )
                print(monitor_error["monitor_message"])
            
            # Оновлюємо статистику
            if execution_result.get("success"):
                self.stats["successful_requests"] += 1
                if execution_result.get("execution_type") == "session_resume":
                    self.stats["session_continuations"] += 1
                else:
                    self.stats["task_executions"] += 1
            else:
                self.stats["failed_requests"] += 1
            
            # Формуємо фінальну відповідь
            response_data.update({
                "response_type": "task_execution",
                "goose_result": execution_result,
                "success": execution_result.get("success", False),
                "response": execution_result.get("response", ""),
                "processing_time": (datetime.now() - start_time).total_seconds()
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
                "processing_time": (datetime.now() - start_time).total_seconds()
            }
            
            if self.config["enable_logging"]:
                print(f"❌ Помилка в CoreOrchestrator: {e}")
            
            return error_response

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
        """Створює нову сесію Goose"""
        return self.session_manager.create_session(session_name, initial_message)

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


# Глобальний екземпляр для використання в atlas_minimal_live.py
atlas_core = None

def get_atlas_core(goose_path: str = "/Users/dev/Documents/GitHub/ATLAS/goose") -> CoreOrchestrator:
    """Отримує глобальний екземпляр Atlas Core"""
    global atlas_core
    if atlas_core is None:
        atlas_core = CoreOrchestrator(goose_path)
    return atlas_core
