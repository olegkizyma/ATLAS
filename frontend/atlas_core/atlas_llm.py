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

    def analyze_user_intent(self, message: str, previous_context: Dict) -> Dict:
        """
        Інтелектуальний аналіз наміру користувача через Gemini API
        Returns: {"intent": "task|chat|continue", "confidence": 0.0-1.0, "context": {...}}
        """
        print("🧠 Atlas LLM1: Аналізую інтенцію користувача...")
        
        try:
            # Спроба використати Gemini API для аналізу інтенції
            gemini_analysis = self._analyze_intent_with_gemini(message, previous_context)
            if gemini_analysis:
                return gemini_analysis
        except Exception as e:
            print(f"⚠️ Gemini API недоступний для аналізу інтенції: {e}")
        
        # Fallback на локальний аналіз (спрощений)
        return self._analyze_intent_locally(message, previous_context)

    def _analyze_intent_with_gemini(self, message: str, previous_context: Dict) -> Optional[Dict]:
        """Використовує Gemini API для аналізу наміру користувача"""
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

КОНТЕКСТ СЕСІЇ:
- Якщо є активна сесія і користувач каже "це", "той", "зупини", "більше" - це continue
- Якщо користувач ввічливо питає можливості - це chat
- Якщо користувач дає конкретне доручення - це task

ФОРМАТ ВІДПОВІДІ (тільки JSON):
{
  "intent": "chat|task|continue",
  "confidence": 0.0-1.0,
  "reasoning": "коротке пояснення чому саме така інтенція",
  "context": {}
}"""
        
        user_prompt = f"""Повідомлення користувача: "{message}"

Попередній контекст: {json.dumps(previous_context, ensure_ascii=False) if previous_context else "відсутній"}

Проаналізуй інтенцію та дай відповідь у JSON форматі."""
        
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

    def _analyze_intent_locally(self, message: str, previous_context: Dict) -> Dict:
        """Локальний fallback аналіз інтенції"""
        message_lower = message.lower()
        
        # Прості евристики як fallback
        if any(word in message_lower for word in ["продовжи", "далі", "зупини", "повний екран"]):
            return {
                "intent": "continue",
                "confidence": 0.6,
                "reasoning": "Виявлено слова продовження (локальний аналіз)",
                "context": previous_context
            }
        
        if any(phrase in message_lower for phrase in ["хочу щоб", "можеш зробити", "знайди і", "запусти", "відкрий"]):
            return {
                "intent": "task", 
                "confidence": 0.7,
                "reasoning": "Виявлено фрази завдання (локальний аналіз)",
                "context": self._extract_task_context(message)
            }
        
        return {
            "intent": "chat",
            "confidence": 0.5,
            "reasoning": "За замовчуванням - спілкування (локальний аналіз)",
            "context": {"topic": self._extract_chat_topic(message)}
        }



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
        """Витягує тему для спілкування"""
        if any(word in message.lower() for word in ["технології", "ІІ", "ai"]):
            return "technology"
        elif any(word in message.lower() for word in ["фільм", "кіно", "серіал"]):
            return "entertainment" 
        elif any(word in message.lower() for word in ["допомога", "як", "що"]):
            return "help"
        else:
            return "general"

    def determine_session_strategy(self, intent_analysis: Dict, active_sessions: List) -> Dict:
        """
        Визначає стратегію роботи з сесіями
        Returns: {"strategy": "new|continue|resume", "session_name": str, "action": str}
        """
        intent = intent_analysis["intent"]
        context = intent_analysis["context"]
        
        if intent == "continue" and active_sessions:
            # Продовжити останню активну сесію
            latest_session = active_sessions[0] if active_sessions else None
            return {
                "strategy": "continue",
                "session_name": latest_session["name"] if latest_session else None,
                "action": "resume_and_continue",
                "reasoning": "Продовження активної сесії"
            }
        
        elif intent == "task":
            # Створити нову сесію для завдання
            task_type = context.get("task_type", "general")
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            session_name = f"{task_type}_{timestamp}"
            
            return {
                "strategy": "new",
                "session_name": session_name,
                "action": "create_and_execute",
                "reasoning": "Створення нової сесії для завдання"
            }
        
        else:
            # Спілкування - використати chat сесію
            return {
                "strategy": "chat",
                "session_name": "atlas_chat",
                "action": "direct_response",
                "reasoning": "Пряма відповідь без Goose"
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
        
        # Спеціальний промпт для переформулювання завдань
        system_prompt = """Ти - експерт з переформулювання завдань для автоматизації. 
        
        Твоя задача: перетворити нечітке користувацьке завдання в детальну покрокову інструкцію для виконання системою Goose з playwright.

        Правила переформулювання:
        1. Розбий завдання на конкретні кроки
        2. Використовуй playwright команди: browser_navigate, browser_type, browser_click, browser_press_key, browser_wait_for
        3. Додай чіткі селектори та послідовність дій
        4. Зазнач точні URL та пошукові фрази
        5. Включи перевірки та очікування завантаження
        6. Додай інструкції для повноекранного режиму якщо потрібно

        Приклад:
        Користувач: "знайди фільм про кохання"
        Інструкція: "1. playwright__browser_navigate до https://google.com
        2. playwright__browser_type в пошуковому полі 'фільм про кохання онлайн дивитися HD'
        3. playwright__browser_press_key Enter
        4. playwright__browser_click на перший результат з онлайн кінотеатром
        5. playwright__browser_wait_for зачекай завантаження сторінки"
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
        """Локальне переформулювання завдання"""
        intent = intent_analysis.get("intent", "")
        confidence = intent_analysis.get("confidence", 0)
        entities = intent_analysis.get("entities", {})
        
        # Визначаємо тип завдання та переформулюємо
        if "відео" in message.lower() or "фільм" in message.lower():
            # Завдання з відео
            search_term = entities.get("search_term", "відео")
            return f"""Завдання: Знайти та запустити відео '{search_term}'

Детальна інструкція:
1. playwright__browser_navigate до https://google.com
2. playwright__browser_type в пошуковому полі '{search_term} онлайн дивитися HD'
3. playwright__browser_press_key Enter для початку пошуку
4. playwright__browser_click на перший результат з відео платформою (YouTube, онлайн кінотеатр)
5. playwright__browser_wait_for зачекай завантаження відео сторінки
6. playwright__browser_click на кнопку Play/Відтворити для запуску відео
7. playwright__browser_press_key F11 для переходу в повноекранний режим браузера
8. playwright__browser_click на кнопку fullscreen відео (якщо є) для повноекранного відео
9. playwright__browser_wait_for дай відео грати та стабілізуватися

Результат: Відео запущено в повноекранному режимі"""

        elif "браузер" in message.lower() or "сайт" in message.lower():
            # Завдання з браузером
            url = entities.get("url", "https://google.com")
            return f"""Завдання: Робота з браузером

Детальна інструкція:
1. playwright__browser_navigate до {url}
2. playwright__browser_wait_for зачекай повного завантаження сторінки
3. {message}

Результат: Браузер готовий до роботи"""

        else:
            # Загальне завдання
            return f"""Завдання: {message}

Детальна інструкція:
1. Аналізую завдання: "{message}"
2. Визначаю необхідні кроки для виконання
3. Виконую послідовно кожен крок
4. Перевіряю результат виконання

Результат: Завдання виконано згідно з інструкцією"""

    def process_user_message(self, message: str, previous_context: Dict, active_sessions: List) -> Dict:
        """
        Основний метод обробки повідомлення користувача
        Returns: повну відповідь з планом дій
        """
        # 1. Аналіз наміру
        intent_analysis = self.analyze_user_intent(message, previous_context)
        
        # 2. Визначення стратегії сесії
        session_strategy = self.determine_session_strategy(intent_analysis, active_sessions)
        
        # 3. Формування відповіді
        if session_strategy["strategy"] == "chat":
            # Пряма відповідь
            response = self.generate_direct_response(message)
            return {
                "response_type": "direct",
                "response": response,
                "session_action": None
            }
        else:
            # Для завдань додаємо етап переформулювання
            # 3.5. Переформулювання завдання в детальну інструкцію
            detailed_instruction = self.reformulate_task_instruction(message, intent_analysis)
            
            # Через Goose з переформульованою інструкцією
            goose_command = self.format_goose_command(detailed_instruction, intent_analysis, session_strategy)
            return {
                "response_type": "goose",
                "goose_command": goose_command,
                "detailed_instruction": detailed_instruction,
                "original_message": message,
                "session_action": session_strategy,
                "intent_analysis": intent_analysis
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
