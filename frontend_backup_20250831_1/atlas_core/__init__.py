"""
Atlas Core - Система з трьох компонентів для інтелектуальної обробки команд

🧠 Atlas LLM1 - Головний аналітик інтенцій та стратегій сесій
🚀 Goose - Виконавчий механізм через Session Manager
🛡️ Гріша LLM3 - Система безпеки та валідації команд
⚙️ Core Orchestrator - Центральний координатор всіх компонентів

Використання:
    from atlas_core import get_atlas_core
    
    # Отримуємо екземпляр системи
    core = get_atlas_core()
    
    # Обробляємо повідомлення користувача
    result = await core.process_user_message("Привіт!", user_context={})
    
    # Перевіряємо статус системи
    status = core.get_system_status()
"""

from .atlas_llm import AtlasLLM
from .grisha_security import GrishaSecurity
from .session_manager import SessionManager
from .core_orchestrator import CoreOrchestrator, get_atlas_core

__version__ = "1.0.0"
__all__ = [
    'AtlasLLM', 
    'GrishaSecurity', 
    'SessionManager', 
    'CoreOrchestrator',
    'get_atlas_core'
]

# Експортуємо головну функцію для зручності
__atlas_core_instance = None

def initialize_atlas_core(goose_path: str = "/Users/dev/Documents/GitHub/ATLAS/goose"):
    """Ініціалізує Atlas Core з заданим шляхом до Goose"""
    global __atlas_core_instance
    __atlas_core_instance = CoreOrchestrator(goose_path)
    return __atlas_core_instance

def get_core():
    """Повертає поточний екземпляр Atlas Core"""
    return __atlas_core_instance or get_atlas_core()
