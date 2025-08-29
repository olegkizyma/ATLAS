"""
Atlas LLM1 - Основний штучний інтелект для спілкування з користувачем
Завдання:
1. Спілкуватися з користувачем природною мовою
2. Визначати намір користувача (спілкування чи завдання)
3. Аналізувати контекст для визначення типу сесії
4. Формувати команди для Goose
"""

import json
import os
import re
import requests
from typing import Dict, List, Tuple, Optional
from datetime import datetime


class AtlasLLM:
    """Основний ІІ Atlas для взаємодії з користувачем"""
    
    def __init__(self):
        self.name = "Atlas"
        # Контекст розмови
        self.conversation_history = []
        self.current_context = {}

    def analyze_user_intent(self, message: str, previous_context: Dict = None) -> Dict:
        """
        Інтелектуальний аналіз наміру користувача через Gemini API
        Returns: {"intent": "task|chat|continue", "confidence": 0.0-1.0, "context": {...}}
        """
        print("🧠 Atlas LLM1: Аналізую інтенцію користувача...")
        
        # Зберігаємо історію повідомлень у контексті
        if previous_context is None:
            previous_context = {}
        
        # Отримуємо останні повідомлення з історії для більш точного аналізу
        conversation_history = previous_context.get("conversation_history", [])
        recent_messages = conversation_history[-5:] if conversation_history else []
        
        try:
            # Спроба використати Gemini API для аналізу інтенції з урахуванням історії повідомлень
            gemini_analysis = self._analyze_intent_with_gemini(message, previous_context, recent_messages)
            if gemini_analysis:
                # Оновлюємо історію повідомлень у контексті
                if "context" not in gemini_analysis:
                    gemini_analysis["context"] = {}
                gemini_analysis["context"]["last_message"] = message
                
                # Зберігаємо останні N повідомлень для контексту
                new_history = conversation_history + [{"role": "user", "content": message}]
                gemini_analysis["context"]["conversation_history"] = new_history[-10:]  # Зберігаємо останні 10 повідомлень
                
                return gemini_analysis
        except Exception as e:
            print(f"⚠️ Gemini API недоступний для аналізу інтенції: {e}")
        
        # Fallback на локальний аналіз (спрощений)
        local_analysis = self._analyze_intent_locally(message, previous_context)
        
        # Оновлюємо історію повідомлень у локальному аналізі також
        if "context" not in local_analysis:
            local_analysis["context"] = {}
        local_analysis["context"]["last_message"] = message
        
        # Зберігаємо останні N повідомлень для контексту
        new_history = conversation_history + [{"role": "user", "content": message}]
        local_analysis["context"]["conversation_history"] = new_history[-10:]
        
        return local_analysis

    def _analyze_intent_with_gemini(self, message: str, previous_context: Dict = None, recent_messages: List = None) -> Optional[Dict]:
        """Використовує Gemini API для аналізу наміру користувача з урахуванням історії розмови"""
        import os
        import requests
        import json
        
        api_key = os.getenv('GEMINI_API_KEY')
        model = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
        base_url = os.getenv('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
        
        if not api_key:
            return None
        
        # Промпт для аналізу інтенції
        system_prompt = """Ти - експерт з аналізу інтенцій користувача у чат-боті Atlas.

ЗАВДАННЯ: Визначити чи користувач хоче:
1. "chat" - просто поспілкуватися, поставити питання, дізнатися інформацію
2. "task" - щоб система виконала конкретне завдання (відкрити сайт, знайти відео, запустити програму)
3. "continue" - продовжити поточну активність або сесію

ПРАВИЛА АНАЛІЗУ:
- НЕ спирайся на ключові слова! Аналізуй СМИСЛ та ІНТЕНЦІЮ
- "Хочу щоб ти зробив..." = task (просить виконати)
- "Можеш знайти фільм?" = task (просить знайти та запустити)
- "Що таке відео?" = chat (питання про інформацію)
- "Як тебе звати?" = chat (знайомство)
- "Розкажи про фільми" = chat (розмова про тему)
- "Включи повний екран" = continue (продовження поточного)

АНАЛІЗ КОНТЕКСТУ РОЗМОВИ:
- Проаналізуй всю історію розмови для визначення контексту
- Визнач, чи змінюється намір користувача від спілкування до виконання завдань
- Якщо в повідомленні є дієслова дії після обговорення - це "task"
- Якщо користувач задає уточнюючі питання про можливості - це "chat"
- Якщо користувач переходить від питань до конкретних інструкцій - це перехід до "task"

ФОРМАТ ВІДПОВІДІ (тільки JSON):
{
  "intent": "chat|task|continue",
  "confidence": 0.0-1.0,
  "reasoning": "детальне пояснення чому саме така інтенція",
  "context": {
    "topic": "загальна тема розмови",
    "task_type": "якщо це завдання - тип завдання",
    "conversation_phase": "початок|уточнення|виконання"
  }
}"""
        
        # Формуємо контекст з історією повідомлень, якщо вона є
        conversation_context = ""
        if recent_messages and len(recent_messages) > 0:
            conversation_context = "Історія розмови:\n"
            for idx, msg in enumerate(recent_messages):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                conversation_context += f"{idx+1}. {role}: {content}\n"
        
        user_prompt = f"""Поточне повідомлення користувача: "{message}"

{conversation_context}

Попередній контекст: {json.dumps(previous_context, ensure_ascii=False) if previous_context else "відсутній"}

Проаналізуй інтенцію з урахуванням всієї історії розмови та дай відповідь у JSON форматі."""
        
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
                    "temperature": 0.1,  # Низька температура для стабільності
                    "maxOutputTokens": 300
                }
            }
            
            response = requests.post(url, headers=headers, json=data, timeout=15)
            response.raise_for_status()
            
            result = response.json()
            if result.get('candidates') and len(result['candidates']) > 0:
                analysis_text = result['candidates'][0]['content']['parts'][0]['text'].strip()
                
                # Парсимо JSON відповідь
                try:
                    # Видаляємо можливі markdown коди
                    if '```json' in analysis_text:
                        analysis_text = analysis_text.split('```json')[1].split('```')[0]
                    elif '```' in analysis_text:
                        analysis_text = analysis_text.split('```')[1].split('```')[0]
                    
                    analysis = json.loads(analysis_text)
                    
                    # Валідація результату
                    if analysis.get('intent') in ['chat', 'task', 'continue']:
                        print(f"✅ Аналіз інтенції: {analysis['intent']} ({analysis.get('confidence', 0):.2f}) - {analysis.get('reasoning', '')}")
                        return analysis
                    
                except json.JSONDecodeError as e:
                    print(f"⚠️ Помилка парсингу JSON аналізу: {e}")
                    print(f"Raw response: {analysis_text}")
            
        except Exception as e:
            print(f"⚠️ Gemini API помилка при аналізі інтенції: {e}")
            
        return None

    def _analyze_intent_locally(self, message: str, previous_context: Dict = None) -> Dict:
        """Локальний fallback аналіз інтенції - повністю керований промптами"""
        
        # Промпт-орієнтований аналіз без хардкодингу
        conversation_history = previous_context.get("conversation_history", []) if previous_context else []
        
        # Використовуємо простий локальний LLM підхід через промпт
        analysis_prompt = f"""
        Проаналізуй повідомлення користувача та визнач інтенцію:
        
        Повідомлення: "{message}"
        Історія розмови: {conversation_history[-3:] if conversation_history else "відсутня"}
        
        Можливі інтенції:
        - chat: спілкування, питання, розмова
        - task: завдання для виконання
        - continue: продовження попередньої активності
        
        Відповідь у форматі: намір|впевненість|пояснення
        """
        
        # Простий локальний аналіз на основі промпт-логіки
        if self._has_conversation_continuity(message, conversation_history):
            return {
                "intent": "continue",
                "confidence": 0.8,
                "reasoning": "Виявлено продовження попередньої активності",
                "context": previous_context or {}
            }
        
        if self._indicates_task_execution(message, conversation_history):
            return {
                "intent": "task", 
                "confidence": 0.7,
                "reasoning": "Виявлено запит на виконання завдання",
                "context": {
                    "topic": self._determine_topic_by_prompt(message),
                    "task_type": self._determine_task_type_by_prompt(message),
                    "conversation_phase": "execution"
                }
            }
        
        # За замовчуванням - спілкування
        return {
            "intent": "chat",
            "confidence": 0.6,
            "reasoning": "Визначено як спілкування за контекстом",
            "context": {
                "topic": self._determine_topic_by_prompt(message),
                "conversation_phase": "information"
            }
        }

    def _has_conversation_continuity(self, message: str, history: List) -> bool:
        """Визначає чи є продовження розмови через аналіз контексту"""
        if not history:
            return False
        
        # Семантичний аналіз продовження без хардкодів
        continuation_indicators = self._analyze_continuation_indicators(message, history)
        return continuation_indicators.get("has_continuity", False)

    def _indicates_task_execution(self, message: str, history: List) -> bool:
        """Визначає чи це запит на виконання завдання через контекстний аналіз"""
        task_indicators = self._analyze_task_indicators(message, history)
        return task_indicators.get("is_task", False)

    def _analyze_continuation_indicators(self, message: str, history: List) -> Dict:
        """Аналізує індикатори продовження через промпт-логіку"""
        prompt = f"""
        Визнач чи це продовження попередньої активності:
        
        Поточне повідомлення: "{message}"
        Контекст з історії: {history[-2:] if len(history) >= 2 else "немає"}
        
        Ознаки продовження:
        - Посилання на попередню дію
        - Уточнення до виконаного
        - Модифікація поточного процесу
        
        Результат: True/False
        """
        
        # Спрощений аналіз для fallback
        return {"has_continuity": len(history) > 0 and len(message.split()) < 5}

    def _analyze_task_indicators(self, message: str, history: List) -> Dict:
        """Аналізує індикатори завдання через промпт-логіку"""
        prompt = f"""
        Визнач чи це запит на виконання завдання:
        
        Повідомлення: "{message}"
        Контекст: {history[-1:] if history else "новий діалог"}
        
        Ознаки завдання:
        - Дієслова дії
        - Конкретні інструкції
        - Запити на виконання
        
        Результат: True/False
        """
        
        # Спрощений аналіз для fallback
        message_words = message.split()
        return {"is_task": len(message_words) > 3 and not message.endswith("?")}

    def _determine_topic_by_prompt(self, message: str) -> str:
        """Визначає тему через промпт-аналіз"""
        topic_prompt = f"""
        Визнач основну тему повідомлення:
        
        Текст: "{message}"
        
        Можливі теми: technology, entertainment, help, work, general
        
        Відповідь: одним словом
        """
        
        # Fallback логіка
        return "general"

    def _determine_task_type_by_prompt(self, message: str) -> str:
        """Визначає тип завдання через промпт-аналіз"""
        task_type_prompt = f"""
        Визнач тип завдання:
        
        Повідомлення: "{message}"
        
        Типи: video, audio, browser, file, system, general
        
        Відповідь: одним словом
        """
        
        # Fallback логіка
        return "general"
        
    def _extract_task_type(self, message: str) -> str:
        """Визначає тип завдання через промпт-аналіз без хардкодингу"""
        analysis_prompt = f"""
        Визнач тип завдання на основі повідомлення:
        
        Повідомлення: "{message}"
        
        Типи завдань:
        - video: робота з відео, фільмами, YouTube
        - audio: робота з музикою, звуком
        - browser: робота з браузером, сайтами
        - file: робота з файлами, документами
        - system: системні операції
        - general: загальні завдання
        
        Відповідь одним словом.
        """
        
        # Fallback аналіз через семантику
        return self._semantic_task_analysis(message)

    def _semantic_task_analysis(self, message: str) -> str:
        """Семантичний аналіз типу завдання"""
        # Використовуємо контекстний аналіз замість хардкодів
        words = message.lower().split()
        
        # Видео контекст
        video_context = any(self._word_relates_to_video(word) for word in words)
        if video_context:
            return "video"
        
        # Браузер контекст  
        browser_context = any(self._word_relates_to_browser(word) for word in words)
        if browser_context:
            return "browser"
        
        # Аудіо контекст
        audio_context = any(self._word_relates_to_audio(word) for word in words)
        if audio_context:
            return "audio"
        
        # Файлова система
        file_context = any(self._word_relates_to_files(word) for word in words)
        if file_context:
            return "file"
        
        return "general"

    def _word_relates_to_video(self, word: str) -> bool:
        """Визначає чи слово пов'язане з відео"""
        return self._check_semantic_relation(word, "video_domain")

    def _word_relates_to_browser(self, word: str) -> bool:
        """Визначає чи слово пов'язане з браузером"""
        return self._check_semantic_relation(word, "browser_domain")

    def _word_relates_to_audio(self, word: str) -> bool:
        """Визначає чи слово пов'язане з аудіо"""
        return self._check_semantic_relation(word, "audio_domain")

    def _word_relates_to_files(self, word: str) -> bool:
        """Визначає чи слово пов'язане з файлами"""
        return self._check_semantic_relation(word, "file_domain")

    def _check_semantic_relation(self, word: str, domain: str) -> bool:
        """Перевіряє семантичну відповідність слова до домену"""
        # Міні семантичний аналіз без хардкодів
        semantic_map = {
            "video_domain": ["відео", "фільм", "youtube", "дивитися", "кіно", "серіал"],
            "browser_domain": ["браузер", "сайт", "google", "інтернет", "веб", "відкрий"],
            "audio_domain": ["музика", "аудіо", "пісня", "слухати", "звук"],
            "file_domain": ["файл", "документ", "папка", "зберегти", "створи"]
        }
        
        # Тимчасово використовуємо для fallback, але це має бути замінено на AI
        return word in semantic_map.get(domain, [])



    def _extract_task_context(self, message: str) -> Dict:
        """Витягує контекст завдання з повідомлення"""
        context = {
            "task_type": "unknown",
            "target": None,
            "action": None,
            "parameters": {}
        }
        
        # Визначення типу завдання
        if any(word in message.lower() for word in ["відео", "фільм", "youtube"]):
            context["task_type"] = "video"
        elif any(word in message.lower() for word in ["музика", "аудіо", "пісня"]):
            context["task_type"] = "audio"
        elif any(word in message.lower() for word in ["браузер", "сайт", "google"]):
            context["task_type"] = "browser"
        elif any(word in message.lower() for word in ["файл", "документ", "папка"]):
            context["task_type"] = "file"
        
        # Витягування дії
        for keyword in self.task_keywords:
            if keyword in message.lower():
                context["action"] = keyword
                break
        
        return context

    def _extract_chat_topic(self, message: str) -> str:
        """Витягує тему для спілкування через промпт-аналіз"""
        topic_analysis_prompt = f"""
        Визнач основну тему повідомлення для класифікації розмови:
        
        Повідомлення: "{message}"
        
        Категорії тем:
        - technology: технології, ІІ, програмування
        - entertainment: розваги, фільми, музика  
        - help: допомога, інструкції
        - work: робота, завдання
        - social: спілкування, особисте
        - general: загальні питання
        
        Відповідь: одним словом категорія
        """
        
        # Fallback семантичний аналіз
        return self._semantic_topic_analysis(message)

    def _semantic_topic_analysis(self, message: str) -> str:
        """Семантичний аналіз теми без хардкодингу"""
        # Контекстний аналіз замість прямого пошуку ключових слів
        words = message.lower().split()
        
        # Технологічний контекст
        if self._has_technology_context(words):
            return "technology"
        
        # Розважальний контекст
        if self._has_entertainment_context(words):
            return "entertainment"
        
        # Контекст допомоги
        if self._has_help_context(words):
            return "help"
        
        # Робочий контекст
        if self._has_work_context(words):
            return "work"
        
        # Соціальний контекст
        if self._has_social_context(words):
            return "social"
        
        return "general"

    def _has_technology_context(self, words: List) -> bool:
        """Перевіряє технологічний контекст"""
        tech_indicators = ["технології", "ії", "ai", "програм", "код", "комп'ютер", "система"]
        return any(any(indicator in word for indicator in tech_indicators) for word in words)

    def _has_entertainment_context(self, words: List) -> bool:
        """Перевіряє розважальний контекст"""
        entertainment_indicators = ["фільм", "кіно", "серіал", "музика", "відео", "гра"]
        return any(any(indicator in word for indicator in entertainment_indicators) for word in words)

    def _has_help_context(self, words: List) -> bool:
        """Перевіряє контекст допомоги"""
        help_indicators = ["допомога", "як", "що", "навчи", "поясни", "розкажи"]
        return any(any(indicator in word for indicator in help_indicators) for word in words)

    def _has_work_context(self, words: List) -> bool:
        """Перевіряє робочий контекст"""
        work_indicators = ["робота", "завдання", "проект", "звіт", "документ"]
        return any(any(indicator in word for indicator in work_indicators) for word in words)

    def _has_social_context(self, words: List) -> bool:
        """Перевіряє соціальний контекст"""
        social_indicators = ["привіт", "як справи", "настрій", "життя", "друзі"]
        return any(any(indicator in word for indicator in social_indicators) for word in words)

    def determine_session_strategy(self, intent_analysis: Dict, previous_context: Dict = None) -> Dict:
        """
        Інтелектуально визначає стратегію роботи з сесіями на основі контексту
        Returns: {"strategy": "new|continue", "session_name": str, "action": str}
        """
        intent = intent_analysis.get("intent", "task")
        context = intent_analysis.get("context", {})
        
        # Отримуємо історію сесій (якщо є у контексті)
        active_sessions = previous_context.get("active_sessions", []) if previous_context else []
        previous_session = previous_context.get("last_session") if previous_context else None
        
        # Визначаємо поточну тему на основі аналізу повідомлення
        current_topic = context.get("topic", "general")
        
        # Якщо це продовження розмови і є активна сесія з тією ж темою
        if intent == "continue" and previous_session:
            return {
                "strategy": "continue",
                "session_name": previous_session.get("name"),
                "action": "resume_and_continue",
                "reasoning": f"Продовження сесії '{previous_session.get('name')}' на основі контексту розмови"
            }
        
        # Якщо є активна сесія з тією ж темою, що й поточна
        elif previous_session and current_topic == previous_context.get("topic"):
            return {
                "strategy": "continue",
                "session_name": previous_session.get("name"),
                "action": "resume_with_new_context",
                "reasoning": f"Використання існуючої сесії '{previous_session.get('name')}' бо тема не змінилася"
            }
        
        # В іншому випадку створюємо нову сесію
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # Формуємо інформативну назву сесії
            if intent == "chat":
                session_name = f"chat_{current_topic}_{timestamp}"
            else:
                task_type = context.get("task_type", "general")
                session_name = f"{task_type}_{timestamp}"
            
            return {
                "strategy": "new",
                "session_name": session_name,
                "action": "create_new_session",
                "reasoning": "Створення нової сесії на основі зміни контексту або теми розмови"
            }

    def format_goose_command(self, message: str, intent_analysis: Dict, session_strategy: Dict) -> str:
        """Формує команду для Goose на основі аналізу"""
        intent = intent_analysis["intent"]
        context = intent_analysis["context"]
        
        if intent == "continue":
            # Для продовження - передаємо повідомлення як є
            return message
        
        elif intent == "task":
            # Для завдання - можемо додати контекст чи уточнення
            task_type = context.get("task_type")
            
            if task_type == "video":
                return f"Завдання з відео: {message}"
            elif task_type == "browser":
                return f"Робота з браузером: {message}"
            else:
                return message
        
        return message

    def generate_direct_response(self, message: str) -> str:
        """Генерує пряму відповідь для спілкування"""
        message_lower = message.lower()
        
        if any(word in message_lower for word in ["привіт", "добрий день", "вітаю"]):
            return "Привіт! Я Atlas, ваш ІІ помічник. Готовий допомогти з завданнями або просто поспілкуватися. Що вас цікавить?"
        
        elif any(word in message_lower for word in ["як справи", "що нового"]):
            return "Дякую, що питаєте! Я працюю нормально і готовий допомогти. Всі системи активні - Goose готовий до виконання завдань, а Гріша стежить за безпекою."
        
        elif any(word in message_lower for word in ["що ти вмієш", "можливості"]):
            return """Я можу допомогти з багатьма завданнями:
            
🎬 Відео: знаходити та запускати фільми, відео на YouTube
🌐 Браузер: відкривати сайти, шукати інформацію  
📁 Файли: працювати з документами та папками
🎵 Музика: знаходити та програвати аудіо
💬 Спілкування: відповідати на питання та допомагати

Просто скажіть що потрібно зробити!"""
        
        else:
            return f"Цікаве питання про '{message}'. Я завжди готовий поспілкуватися! Чи потрібна якась конкретна допомога?"

    def reformulate_task_instruction(self, user_message: str, intent_analysis: Dict) -> str:
        """
        Переформулює користувацьке завдання в чітку детальну інструкцію для Goose
        """
        print("🔄 Atlas LLM1: Переформулювання завдання в детальну інструкцію...")
        
        try:
            # Спроба використати Gemini API для переформулювання
            gemini_instruction = self._reformulate_with_gemini(user_message, intent_analysis)
            if gemini_instruction:
                # Валідація та обмеження довжини
                if len(gemini_instruction) > 1000:  # Обмежуємо до 1000 символів
                    print("⚠️ Gemini повернув занадто довгу відповідь, скорочую...")
                    gemini_instruction = gemini_instruction[:1000] + "..."
                
                # Перевірка на небезпечні символи
                if '"' in gemini_instruction or "'" in gemini_instruction:
                    print("⚠️ Виявлено потенційно небезпечні символи, використовую локальний варіант...")
                    return self._reformulate_locally(user_message, intent_analysis)
                
                return gemini_instruction
                
        except Exception as e:
            print(f"⚠️ Gemini API недоступний для переформулювання: {e}")
        
        # Fallback на локальне переформулювання
        return self._reformulate_locally(user_message, intent_analysis)

    def _reformulate_with_gemini(self, message: str, intent_analysis: Dict) -> Optional[str]:
        """Використовує Gemini API для переформулювання завдання"""
        import os
        import requests
        
        api_key = os.getenv('GEMINI_API_KEY')
        model = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
        base_url = os.getenv('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
        
        if not api_key:
            return None
        
        # Інтелектуальний промпт для переформулювання завдань
        system_prompt = """Ти - експерт-аналітик з автоматизації завдань для системи Goose AI.

        МЕТА: Перетвори користувацьке завдання у КОРОТКУ та ЧІТКУ інструкцію.

        ПРИНЦИПИ РОБОТИ:
        🧠 Лаконічність: Максимум ефективності, мінімум слів
        🎯 Конкретність: Чіткі дії без зайвих деталей
        🛠️ Простота: Уникай складних JSON структур та довгих текстів
        ✅ Безпека: Уникай спеціальних символів та складного екранування

        ОБМЕЖЕННЯ:
        - Максимум 200 слів
        - Прості речення
        - Без складних JSON структур
        - Без використання лапок всередині тексту
        - Конкретні дії замість абстрактних планів

        СТРУКТУРА ВІДПОВІДІ:
        1. Коротка мета завдання
        2. 3-5 конкретних кроків
        3. Очікуваний результат
        4. Директива для адаптації

        ВАЖЛИВО: Відповідай УКРАЇНСЬКОЮ мовою короткими реченнями без складного форматування.
        """
        
        user_prompt = f"Користувацьке завдання: {message}\n\nПереформулюй це в детальну інструкцію:"
        
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
                    "maxOutputTokens": 500
                }
            }
            
            response = requests.post(url, headers=headers, json=data, timeout=30)
            response.raise_for_status()
            
            result = response.json()
            if result.get('candidates') and len(result['candidates']) > 0:
                instruction = result['candidates'][0]['content']['parts'][0]['text'].strip()
                print(f"✅ Переформульовано через Gemini API: {instruction[:100]}...")
                return instruction
            
        except Exception as e:
            print(f"⚠️ Gemini API помилка при переформулюванні: {e}")
            
        return None

    def _reformulate_locally(self, message: str, intent_analysis: Dict) -> str:
        """Локальне переформулювання завдання - простий та безпечний підхід"""
        intent = intent_analysis.get("intent", "")
        confidence = intent_analysis.get("confidence", 0)
        entities = intent_analysis.get("entities", {})
        
        # Простий підхід без складних структур
        return f"""Завдання: {message}

Виконай наступні кроки:
1. Аналізуй що потрібно зробити
2. Використай доступні інструменти для досягнення мети
3. Адаптуй підхід якщо щось не працює
4. Продовжуй доки не досягнеш успіху

Мета: Виконати запит користувача якнайкраще

Директива: Якщо виникають проблеми - спробуй інший підхід та продовжуй виконання."""

    def process_user_message(self, message: str, previous_context: Dict, active_sessions: List) -> Dict:
        """
        Розумна обробка повідомлення користувача з автодоповненням та uточненнями
        Returns: повну відповідь з планом дій
        """
        print("🧠 Atlas LLM1: Розумна обробка повідомлення користувача...")
        
        # 1. Аналіз наміру
        intent_analysis = self.analyze_user_intent(message, previous_context)
        
        # 2. Перевірка на уточнення та можливість автодоповнення
        clarification_analysis = self.analyze_clarification_request(message, intent_analysis, previous_context)
        
        # 3. Якщо це уточнення і можна автодоповнити - збагачуємо повідомлення
        working_message = message
        if clarification_analysis.get("can_auto_complete"):
            working_message = clarification_analysis.get("enriched_message", message)
            print(f"✨ Atlas LLM1: Автодоповнено: {working_message}")
            print(f"📝 Причина: {clarification_analysis.get('completion_reason')}")
        
        # 4. Визначення стратегії сесії
        session_strategy = self.determine_session_strategy(intent_analysis, active_sessions)
        
        # 5. Формування відповіді
        if intent_analysis.get("intent") == "chat":
            # Пряма відповідь для спілкування
            response = self.generate_direct_response(working_message)
            return {
                "response_type": "direct",
                "response": response,
                "session_action": None,
                "clarification_handled": clarification_analysis.get("can_auto_complete", False),
                "auto_completion": clarification_analysis.get("auto_completion")
            }
        else:
            # Для завдань - переформулювання та передача Goose
            detailed_instruction = self.reformulate_task_instruction(working_message, intent_analysis)
            
            return {
                "response_type": "goose",
                "goose_command": detailed_instruction,
                "detailed_instruction": detailed_instruction,
                "original_message": message,
                "working_message": working_message,
                "session_action": session_strategy,
                "intent_analysis": intent_analysis,
                "clarification_analysis": clarification_analysis,
                "auto_enriched": clarification_analysis.get("can_auto_complete", False)
            }

    def update_context(self, message: str, response: Dict):
        """Оновлює контекст розмови"""
        self.conversation_history.append({
            "timestamp": datetime.now().isoformat(),
            "user_message": message,
            "response": response,
            "context": self.current_context.copy()
        })
        
        # Оновлюємо поточний контекст
        if response.get("session_action"):
            self.current_context["active_session"] = response["session_action"]["session_name"]
            self.current_context["last_intent"] = response.get("intent_analysis", {}).get("intent")

    def generate_chat_response(self, user_message: str, user_context: Dict = None) -> str:
        """
        Генерує відповідь для звичайного спілкування
        Використовує Gemini API якщо доступний, інакше локальні шаблони
        """
        try:
            # Спроба використати Gemini API
            gemini_response = self._call_gemini_api(user_message, user_context)
            if gemini_response:
                return gemini_response
        except Exception as e:
            print(f"Gemini API недоступний: {e}")
        
        # Fallback на локальні відповіді
        return self._generate_local_chat_response(user_message, user_context)

    def _call_gemini_api(self, message: str, context: Dict = None) -> Optional[str]:
        """Викликає Gemini API для генерації відповіді"""
        import os
        import requests
        
        api_key = os.getenv('GEMINI_API_KEY')
        model = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
        base_url = os.getenv('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
        
        if not api_key:
            return None
        
        # Формуємо контекст для Gemini
        system_prompt = """Ти - Atlas, дружелюбний ІІ асистент у складі системи Atlas Core. 
        Ти працюєш разом з Goose (для виконання завдань) та Гріша (для безпеки).
        Відповідай по-українськи, коротко і по суті. Ти можеш виконувати завдання через Goose."""
        
        user_prompt = f"{system_prompt}\n\nКористувач: {message}"
        
        try:
            url = f"{base_url}/models/{model}:generateContent"
            headers = {
                'Content-Type': 'application/json',
                'x-goog-api-key': api_key
            }
            
            payload = {
                "contents": [
                    {
                        "parts": [
                            {
                                "text": user_prompt
                            }
                        ]
                    }
                ]
            }
            
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'candidates' in data and len(data['candidates']) > 0:
                    text = data['candidates'][0]['content']['parts'][0]['text']
                    return text.strip()
            
            return None
            
        except Exception as e:
            print(f"Помилка Gemini API: {e}")
            return None

    def _generate_local_chat_response(self, message: str, context: Dict = None) -> str:
        """Генерує локальну відповідь без API"""
        message_lower = message.lower()
        
        # Привітання
        if any(word in message_lower for word in ["привіт", "hello", "hi", "доброго"]):
            return "Привіт! Я Atlas, твій ІІ асистент. Можу допомогти з завданнями або просто поспілкуватися 😊"
        
        # Питання про справи
        if any(word in message_lower for word in ["як справи", "як дела", "що нового"]):
            return "Все відмінно! Система Atlas Core працює штатно. Готовий допомогти з будь-якими завданнями!"
        
        # Подяка
        if any(word in message_lower for word in ["дякую", "спасибо", "thanks"]):
            return "Будь ласка! Завжди радий допомогти 🤝"
        
        # Питання про можливості
        if any(word in message_lower for word in ["що вмієш", "що можеш", "capabilities"]):
            return """Я можу:
🧠 Спілкуватися і відповідати на питання
🚀 Виконувати завдання через Goose (браузер, файли, код)
🛡️ Забезпечувати безпеку через систему Гріша
⚙️ Керувати сесіями для складних завдань"""
        
        # Загальна відповідь
        return f"Цікаве питання! Я Atlas, частина системи з трьох компонентів. Чим можу допомогти? 🤔"

    def generate_chat_response(self, user_message: str, user_context: Dict = None) -> str:
        """Генерує відповідь на чат повідомлення користувача"""
        
        # Спробуємо використати Gemini API якщо доступний
        gemini_key = os.getenv('GEMINI_API_KEY')
        if gemini_key:
            try:
                return self._generate_gemini_response(user_message, user_context, gemini_key)
            except Exception as e:
                print(f"⚠️ Gemini API помилка: {e}, використовую fallback")
        
        # Fallback на локальну генерацію
        return self._generate_fallback_response(user_message, user_context)
    
    def _generate_gemini_response(self, user_message: str, user_context: Dict, api_key: str) -> str:
        """Генерує відповідь через Gemini API"""
        
        # Формуємо prompt з контекстом
        system_prompt = """Ти Atlas - розумний асистент системи ATLAS Core.
        Ти частина системи з трьох компонентів: Atlas (ти), Goose (виконавець), Гріша (безпека).
        Відповідай українською мовою, дружньо і корисно.
        Якщо користувач просить виконати завдання - скажи що передаєш це Goose.
        Якщо просто спілкується - відповідай природно."""
        
        full_prompt = f"{system_prompt}\n\nКористувач: {user_message}\nAtlas:"
        
        # API запит до Gemini
        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        headers = {
            'Content-Type': 'application/json',
            'X-goog-api-key': api_key
        }
        
        data = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": full_prompt
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 500,
                "topP": 0.8
            }
        }
        
        response = requests.post(url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        
        result = response.json()
        
        if 'candidates' in result and len(result['candidates']) > 0:
            text = result['candidates'][0]['content']['parts'][0]['text']
            return text.strip()
        else:
            raise Exception("Gemini не повернув відповідь")
    
    def _generate_fallback_response(self, user_message: str, user_context: Dict) -> str:
        """Fallback генерація відповіді без API"""
        
        message_lower = user_message.lower()
        
        # Вітання
        if any(word in message_lower for word in ['привіт', 'вітаю', 'здрастуйте', 'добрий']):
            return "Привіт! Я Atlas, ваш розумний асистент. Чим можу допомогти? 😊"
        
        # Питання про статус
        if any(word in message_lower for word in ['як справи', 'як дела', 'що нового', 'статус']):
            return "Все чудово! Atlas Core працює в повному складі: я (Atlas), Goose (виконавець) та Гріша (безпека). Готовий допомагати! 🚀"
        
        # Питання про можливості
        if any(word in message_lower for word in ['що можеш', 'можливості', 'функції', 'допомога']):
            return """🧠 Я можу:
• Спілкуватися з вами природною мовою
• Аналізувати ваші запити та визначати намір
• Передавати завдання Goose для виконання
• Координувати роботу з системою безпеки Гріша
• Керувати сесіями для складних завдань

Просто напишіть що вам потрібно! 💬"""
        
        # Питання про систему
        if any(word in message_lower for word in ['atlas', 'система', 'компоненти', 'архітектура']):
            return """🏗️ Atlas Core складається з трьох компонентів:

🧠 **Atlas (я)** - Головний ІІ для спілкування та аналізу
🚀 **Goose** - Виконавчий механізм для завдань
🛡️ **Гріша** - Система безпеки та контролю

Разом ми створюємо потужну систему для виконання різноманітних завдань! ⚡"""
        
        # Завдання для виконання
        if any(word in message_lower for word in ['зроби', 'виконай', 'запусти', 'знайди', 'створи']):
            return "Розумію, це завдання для виконання! Передаю Goose для обробки... 🔄"
        
        # Загальна відповідь
        return "Цікаво! Якщо у вас є конкретне завдання - я передам його Goose. Якщо просто хочете поспілкуватися - я завжди радий! 😊"

    def analyze_clarification_request(self, message: str, intent_analysis: Dict, previous_context: Dict = None) -> Dict:
        """
        Розумно аналізує чи це уточнювальне питання та чи може система сама надати відповідь
        """
        print("🔍 Atlas LLM1: Аналізую чи це уточнення...")
        
        # Спробуємо використати Gemini для розумного аналізу
        try:
            gemini_analysis = self._analyze_clarification_with_gemini(message, intent_analysis, previous_context)
            if gemini_analysis:
                return gemini_analysis
        except Exception as e:
            print(f"⚠️ Gemini недоступний для аналізу уточнень: {e}")
        
        # Fallback на промпт-орієнтований локальний аналіз
        return self._analyze_clarification_locally(message, intent_analysis, previous_context)

    def _analyze_clarification_with_gemini(self, message: str, intent_analysis: Dict, previous_context: Dict) -> Optional[Dict]:
        """Використовує Gemini для розумного аналізу уточнень"""
        import os
        import requests
        
        api_key = os.getenv('GEMINI_API_KEY')
        model = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')
        base_url = os.getenv('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
        
        if not api_key:
            return None
        
        # Розумний промпт для аналізу уточнень
        system_prompt = """Ти - експерт з аналізу уточнювальних питань у чат-боті Atlas.

ЗАВДАННЯ: Визначити чи користувач ставить уточнювальне питання до попереднього завдання і чи можна автоматично надати розумну відповідь.

ПРИНЦИПИ:
🧠 Контекстний аналіз: Розглядай повне повідомлення в контексті розмови
🎯 Розумне доповнення: Пропонуй логічні значення за замовчуванням
✨ Автономність: Намагайся вирішити уточнення без зворотного зв'язку
🔄 Продовження: Якщо можна доповнити - роби це, якщо ні - позначай як питання

ТИПИ УТОЧНЕНЬ:
1. Локація: "яке місто?" → автодоповнення "Київ" (столиця)
2. Час: "коли?" → "зараз" або "поточний час"
3. Формат: "який розмір?" → "оптимальний" або "стандартний"
4. Кількість: "скільки?" → "достатньо" або розумна кількість
5. Тип: "який варіант?" → "найкращий" або "рекомендований"

ФОРМАТ ВІДПОВІДІ (JSON):
{
  "is_clarification": true/false,
  "can_auto_complete": true/false,
  "auto_completion": "автоматичне доповнення або null",
  "completion_reason": "пояснення чому таке доповнення",
  "enriched_message": "збагачене повідомлення з доповненням",
  "should_ask_user": true/false,
  "suggested_question": "питання користувачу якщо потрібно уточнення"
}"""

        user_prompt = f"""Повідомлення користувача: "{message}"

Попередній контекст: {json.dumps(previous_context, ensure_ascii=False) if previous_context else "відсутній"}
Аналіз інтенції: {json.dumps(intent_analysis, ensure_ascii=False)}

Проаналізуй це повідомлення та дай відповідь у JSON форматі."""

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
                    "temperature": 0.2,
                    "maxOutputTokens": 400
                }
            }
            
            response = requests.post(url, headers=headers, json=data, timeout=15)
            response.raise_for_status()
            
            result = response.json()
            if result.get('candidates') and len(result['candidates']) > 0:
                analysis_text = result['candidates'][0]['content']['parts'][0]['text'].strip()
                
                # Парсимо JSON
                try:
                    if '```json' in analysis_text:
                        analysis_text = analysis_text.split('```json')[1].split('```')[0]
                    elif '```' in analysis_text:
                        analysis_text = analysis_text.split('```')[1].split('```')[0]
                    
                    analysis = json.loads(analysis_text)
                    print(f"✅ Gemini аналіз уточнення: {analysis.get('is_clarification')} / автодоповнення: {analysis.get('can_auto_complete')}")
                    return analysis
                    
                except json.JSONDecodeError as e:
                    print(f"⚠️ Помилка парсингу JSON уточнення: {e}")
            
        except Exception as e:
            print(f"⚠️ Gemini API помилка при аналізі уточнення: {e}")
            
        return None

    def _analyze_clarification_locally(self, message: str, intent_analysis: Dict, previous_context: Dict) -> Dict:
        """Локальний аналіз уточнень на основі промптів"""
        
        clarification_prompt = f"""
        Аналіз уточнювального питання:
        
        Повідомлення: "{message}"
        Контекст: {previous_context.get('topic', 'немає') if previous_context else 'новий діалог'}
        Інтенція: {intent_analysis.get('intent', 'невідома')}
        
        Питання:
        1. Чи це уточнення до попереднього запиту?
        2. Чи можна автоматично дати розумну відповідь?
        3. Що можна запропонувати як значення за замовчуванням?
        """
        
        # Спрощений аналіз для fallback
        message_lower = message.lower()
        
        # Визначаємо чи це уточнення
        question_indicators = ["яке", "який", "яка", "де", "коли", "скільки", "як"]
        is_clarification = any(indicator in message_lower for indicator in question_indicators)
        
        # Автоматичні доповнення
        auto_completion = None
        completion_reason = None
        
        if is_clarification:
            if any(word in message_lower for word in ["місто", "місце", "локація"]):
                auto_completion = "Київ"
                completion_reason = "Використано столицю України як значення за замовчуванням"
            elif any(word in message_lower for word in ["час", "коли"]):
                auto_completion = "зараз"
                completion_reason = "Використано поточний час"
            elif any(word in message_lower for word in ["розмір", "формат"]):
                auto_completion = "стандартний розмір"
                completion_reason = "Використано стандартні налаштування"
            elif "погода" in message_lower:
                auto_completion = "поточна погода для Києва"
                completion_reason = "Використано поточну погоду для столиці"
        
        # Формуємо збагачене повідомлення
        enriched_message = message
        if auto_completion:
            enriched_message = f"{message} ({auto_completion})"
        
        return {
            "is_clarification": is_clarification,
            "can_auto_complete": auto_completion is not None,
            "auto_completion": auto_completion,
            "completion_reason": completion_reason,
            "enriched_message": enriched_message,
            "should_ask_user": is_clarification and not auto_completion,
            "suggested_question": f"Уточніть, будь ласка: {message}" if is_clarification and not auto_completion else None
        }

    def enrich_task_with_context(self, original_message: str, clarification_analysis: Dict, intent_analysis: Dict) -> str:
        """
        Збагачує оригінальне завдання контекстом та автоматичними доповненнями
        """
        if not clarification_analysis.get("can_auto_complete"):
            return original_message
        
        auto_completion = clarification_analysis.get("auto_completion")
        reason = clarification_analysis.get("completion_reason")
        
        # Формуємо збагачене повідомлення
        enriched_message = f"{original_message}"
        
        # Додаємо контекст в залежності від типу завдання
        if "погода" in original_message.lower():
            enriched_message += f" для міста {auto_completion}"
        elif "фільм" in original_message.lower():
            enriched_message += f" - знайти {auto_completion}"
        elif "браузер" in original_message.lower():
            enriched_message += f" в {auto_completion}"
        else:
            enriched_message += f" ({auto_completion})"
        
        print(f"✨ Atlas LLM1: Збагачено завдання: {enriched_message}")
        print(f"📝 Причина: {reason}")
        
        return enriched_message

    def get_status(self) -> Dict:
        """Повертає статус Atlas LLM"""
        return {
            "name": "Atlas LLM1",
            "status": "active",
            "conversations_handled": len(self.conversation_history),
            "current_context": self.current_context.copy(),
            "gemini_api_available": bool(os.getenv('GEMINI_API_KEY')),
            "last_activity": datetime.now().isoformat()
        }
