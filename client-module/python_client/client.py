#!/usr/bin/env python3
"""
GitHub Models Client Module - Python Implementation
Поддерживает все 58 доступных моделей GitHub Models через прокси
"""

import os
import json
import time
import random
from typing import List, Dict, Union
from dataclasses import dataclass
from openai import OpenAI
from dotenv import load_dotenv

# Загружаем переменные окружения
load_dotenv()

@dataclass
class ModelInfo:
    """Информация о модели"""
    id: str
    provider: str
    type: str

class GitHubModelsClient:
    """Клиент для работы с GitHub Models через прокси"""
    
    def __init__(
        self, 
        api_key: str = "dummy-key",
        proxy_url: str = None,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        max_delay: float = 60.0
    ):
        """
        Инициализация клиента
        
        Args:
            api_key: API ключ (любая строка для прокси)
            proxy_url: URL прокси сервера
            max_retries: Максимальное количество попыток при ошибках
            retry_delay: Базовая задержка между попытками (секунды)
            max_delay: Максимальная задержка между попытками (секунды)
        """
        # Определяем URL прокси
        if proxy_url:
            self.base_url = proxy_url
        else:
            self.base_url = os.getenv('GITHUB_MODELS_PROXY_URL', 'http://localhost:3010/v1')
        
        # Параметры retry
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.max_delay = max_delay
        
        # Инициализируем OpenAI клиент
        self.client = OpenAI(
            api_key=api_key,
            base_url=self.base_url
        )
        
        # Загружаем список моделей
        self.models = self._load_models()
    
    def _wait_with_jitter(self, delay: float) -> None:
        """Ожидание с случайным джиттером для избежания thundering herd"""
        jitter = random.uniform(0.1, 0.3) * delay
        time.sleep(delay + jitter)
    
    def _should_retry(self, error: Exception) -> bool:
        """Проверяем, стоит ли повторить запрос при данной ошибке"""
        error_msg = str(error).lower()
        # Повторяем при rate limiting, server errors, timeout
        retry_conditions = [
            '429' in error_msg,  # Rate limit
            '500' in error_msg,  # Server error
            '502' in error_msg,  # Bad gateway
            '503' in error_msg,  # Service unavailable
            '504' in error_msg,  # Gateway timeout
            'timeout' in error_msg,
            'connection' in error_msg
        ]
        return any(condition for condition in retry_conditions)
    
    def _execute_with_retry(self, func, *args, **kwargs):
        """Выполняет функцию с повторными попытками при ошибках"""
        last_error = None
        
        for attempt in range(self.max_retries + 1):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_error = e
                
                if attempt == self.max_retries or not self._should_retry(e):
                    break
                
                # Экспоненциальная задержка с джиттером
                delay = min(self.retry_delay * (2 ** attempt), self.max_delay)
                print(f"⚠️ Попытка {attempt + 1} неудачна, повтор через {delay:.1f}с: {str(e)[:100]}")
                self._wait_with_jitter(delay)
        
        # Если все попытки неудачны, возвращаем ошибку
        raise last_error
    
    def _load_models(self) -> List[ModelInfo]:
        """Загрузка списка доступных моделей"""
        models_file = os.path.join(os.path.dirname(__file__), '..', 'models.json')
        try:
            with open(models_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return [ModelInfo(**model) for model in data['models']]
        except FileNotFoundError:
            print(f"⚠️ Файл моделей не найден: {models_file}")
            return []
    
    def get_models(self, provider: str = None, model_type: str = None) -> List[ModelInfo]:
        """
        Получить список моделей с фильтрацией
        
        Args:
            provider: Фильтр по провайдеру (OpenAI, Microsoft, Meta, etc.)
            model_type: Фильтр по типу (chat, embedding, vision, etc.)
        
        Returns:
            Список моделей
        """
        models = self.models
        
        if provider:
            models = [m for m in models if m.provider.lower() == provider.lower()]
        
        if model_type:
            models = [m for m in models if m.type.lower() == model_type.lower()]
        
        return models
    
    def list_providers(self) -> List[str]:
        """Получить список всех провайдеров"""
        return list(set(model.provider for model in self.models))
    
    def list_model_types(self) -> List[str]:
        """Получить список всех типов моделей"""
        return list(set(model.type for model in self.models))
    
    def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, str]],
        max_tokens: int = 100,
        temperature: float = 0.7,
        **kwargs
    ) -> Dict:
        """
        Создать chat completion с автоматическими повторами
        
        Args:
            model: ID модели
            messages: Список сообщений
            max_tokens: Максимальное количество токенов
            temperature: Температура (0.0 - 2.0)
            **kwargs: Дополнительные параметры
        
        Returns:
            Ответ от модели
        """
        def _make_request():
            return self.client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                **kwargs
            )
        
        try:
            response = self._execute_with_retry(_make_request)
            return {
                'success': True,
                'model': response.model,
                'content': response.choices[0].message.content,
                'usage': {
                    'prompt_tokens': response.usage.prompt_tokens,
                    'completion_tokens': response.usage.completion_tokens,
                    'total_tokens': response.usage.total_tokens
                }
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'model': model
            }
    
    def test_model(self, model: str, message: str = "Hello!") -> Dict:
        """
        Тестирование модели
        
        Args:
            model: ID модели
            message: Тестовое сообщение
        
        Returns:
            Результат теста
        """
        return self.chat_completion(
            model=model,
            messages=[{"role": "user", "content": message}],
            max_tokens=50
        )
    
    def test_all_models(
        self, 
        model_type: str = "chat",
        limit: int = None,
        message: str = "Hello!",
        delay_between_requests: float = 0.5
    ) -> Dict[str, Dict]:
        """
        Тестирование всех моделей определенного типа с задержками
        
        Args:
            model_type: Тип моделей для тестирования
            limit: Лимит количества моделей
            message: Тестовое сообщение
            delay_between_requests: Задержка между запросами (секунды)
        
        Returns:
            Результаты тестирования
        """
        chat_models = self.get_models(model_type=model_type)
        if limit:
            chat_models = chat_models[:limit]
        
        results = {}
        for i, model_info in enumerate(chat_models):
            print(f"🧪 Тестируем ({i+1}/{len(chat_models)}): {model_info.id}")
            result = self.test_model(model_info.id, message)
            results[model_info.id] = result
            
            if result['success']:
                print(f"✅ {model_info.id}: {result['content'][:100]}...")
            else:
                print(f"❌ {model_info.id}: {result['error']}")
            
            # Задержка между запросами для избежания rate limiting
            if i < len(chat_models) - 1:  # Не ждать после последнего запроса
                time.sleep(delay_between_requests)
        
        return results
    
    def get_embedding(
        self,
        model: str,
        input_text: Union[str, List[str]],
        **kwargs
    ) -> Dict:
        """
        Получить эмбеддинги с автоматическими повторами
        
        Args:
            model: ID модели для эмбеддингов
            input_text: Текст или список текстов
            **kwargs: Дополнительные параметры
        
        Returns:
            Эмбеддинги
        """
        def _make_request():
            return self.client.embeddings.create(
                model=model,
                input=input_text,
                **kwargs
            )
        
        try:
            response = self._execute_with_retry(_make_request)
            return {
                'success': True,
                'model': response.model,
                'embeddings': [data.embedding for data in response.data],
                'usage': {
                    'prompt_tokens': response.usage.prompt_tokens,
                    'total_tokens': response.usage.total_tokens
                }
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'model': model
            }

def main():
    """Пример использования клиента"""
    print("🚀 GitHub Models Client - Python")
    print("=" * 50)
    
    # Инициализация клиента
    client = GitHubModelsClient()
    
    print(f"📋 Доступно моделей: {len(client.models)}")
    print(f"🏭 Провайдеры: {', '.join(client.list_providers())}")
    print(f"📝 Типы моделей: {', '.join(client.list_model_types())}")
    print()
    
    # Тест быстрых моделей
    print("🧪 Тестируем популярные модели:")
    popular_models = [
        "openai/gpt-4o-mini",
        "microsoft/phi-3-mini-128k-instruct",
        "meta/meta-llama-3.1-8b-instruct"
    ]
    
    for model in popular_models:
        result = client.test_model(model, "Привіт! Як справи?")
        if result['success']:
            print(f"✅ {model}")
            print(f"   Ответ: {result['content']}")
            print(f"   Токены: {result['usage']['total_tokens']}")
        else:
            print(f"❌ {model}: {result['error']}")
        print()
    
    # Тест эмбеддингов
    print("🔍 Тестируем эмбеддинги:")
    embedding_models = client.get_models(model_type="embedding")
    if embedding_models:
        # Попробуем сначала OpenAI эмбеддинги
        openai_embeddings = [m for m in embedding_models if m.provider == "OpenAI"]
        test_model = openai_embeddings[0].id if openai_embeddings else embedding_models[0].id
        
        result = client.get_embedding(test_model, "Hello, world!")
        if result['success']:
            print(f"✅ {test_model}")
            print(f"   Размерность: {len(result['embeddings'][0])}")
            print(f"   Токены: {result['usage']['total_tokens']}")
        else:
            print(f"❌ {test_model}: {result['error']}")
    else:
        print("⚠️ Эмбеддинг модели не найдены")

if __name__ == "__main__":
    main()
