"""
Утиліти для визначення типу сесії та генерації імені сесії.
Виділено з класу HTTP-обробника для повторного використання в handlers.
"""

def determine_session_type(message: str, forced_type: str | None = None) -> str:
    if forced_type:
        return forced_type
    msg = (message or "").lower()
    chat_keywords = [
        "привіт", "вітаю", "добрий день", "добрий вечір", "що чутно", "як справи",
        "hi", "hello", "hey", "how are you", "how’s it going", "who are you",
        "як тебе звати", "як звати", "як тебе кличуть", "tell me about yourself",
        "поговоримо", "просто чат",
    ]
    if any(k in msg for k in chat_keywords):
        return "chat"
    new_keywords = ["відкрий", "знайди", "створи", "почни", "запусти", "нове", "завдання", "проект", "робота", "старт", "init"]
    if any(word in msg for word in new_keywords):
        return "new_session"
    continue_keywords = ["продовжи", "далі", "також", "тепер", "потім", "ще", "додай", "зміни", "покращи", "зроби", "включи", "натисни"]
    if any(word in msg for word in continue_keywords):
        return "continue_session"
    return "chat"


def get_session_name(message: str, session_type: str) -> str:
    msg = (message or "").lower()
    if session_type == "chat":
        return "general_chat"
    if any(w in msg for w in ["відео", "фільм", "youtube", "браузер"]):
        return "video_browser"
    if any(w in msg for w in ["музика", "пісня", "аудіо"]):
        return "music_player"
    if any(w in msg for w in ["документ", "файл", "текст"]):
        return "document_editor"
    if any(w in msg for w in ["калькулятор", "рахунок", "математика"]):
        return "calculator"
    if any(w in msg for w in ["система", "статус", "моніторинг"]):
        return "system_monitor"
    return "general_assistant"
