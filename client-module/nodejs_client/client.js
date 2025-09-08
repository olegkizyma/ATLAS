#!/usr/bin/env node
/**
 * GitHub Models Client Module - Node.js Implementation
 * Поддерживает все 58 доступных моделей GitHub Models через прокси
 */

import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class GitHubModelsClient {
    /**
     * Клиент для работы с GitHub Models через прокси
     * 
     * @param {Object} options - Опции инициализации
     * @param {string} options.apiKey - API ключ (любая строка для прокси)
     * @param {string} options.proxyURL - URL прокси сервера
     * @param {number} options.maxRetries - Максимальное количество попыток
     * @param {number} options.retryDelay - Базовая задержка между попытками (мс)
     * @param {number} options.maxDelay - Максимальная задержка между попытками (мс)
     */
    constructor(options = {}) {
        const {
            apiKey = 'dummy-key',
            proxyURL,
            maxRetries = 3,
            retryDelay = 1000,
            maxDelay = 60000
        } = options;

        // Определяем URL прокси
        if (proxyURL) {
            this.baseURL = proxyURL;
        } else {
            this.baseURL = process.env.GITHUB_MODELS_PROXY_URL || 'http://localhost:3010/v1';
        }

        // Параметры retry
        this.maxRetries = maxRetries;
        this.retryDelay = retryDelay;
        this.maxDelay = maxDelay;

        // Инициализируем OpenAI клиент
        this.client = new OpenAI({
            apiKey: apiKey,
            baseURL: this.baseURL
        });

        // Загружаем список моделей
        this.models = this._loadModels();
    }

    /**
     * Ожидание с случайным джиттером
     * @param {number} delay - Задержка в миллисекундах
     * @private
     */
    async _waitWithJitter(delay) {
        const jitter = Math.random() * 0.3 * delay;
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }

    /**
     * Проверяем, стоит ли повторить запрос при данной ошибке
     * @param {Error} error - Ошибка
     * @returns {boolean}
     * @private
     */
    _shouldRetry(error) {
        const errorMsg = error.message.toLowerCase();
        const retryConditions = [
            errorMsg.includes('429'),  // Rate limit
            errorMsg.includes('500'),  // Server error
            errorMsg.includes('502'),  // Bad gateway
            errorMsg.includes('503'),  // Service unavailable
            errorMsg.includes('504'),  // Gateway timeout
            errorMsg.includes('timeout'),
            errorMsg.includes('connection')
        ];
        return retryConditions.some(condition => condition);
    }

    /**
     * Выполняет функцию с повторными попытками при ошибках
     * @param {Function} func - Функция для выполнения
     * @returns {Promise} Результат выполнения функции
     * @private
     */
    async _executeWithRetry(func) {
        let lastError = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await func();
            } catch (error) {
                lastError = error;

                if (attempt === this.maxRetries || !this._shouldRetry(error)) {
                    break;
                }

                // Экспоненциальная задержка с джиттером
                const delay = Math.min(this.retryDelay * (2 ** attempt), this.maxDelay);
                console.log(`⚠️ Попытка ${attempt + 1} неудачна, повтор через ${delay}мс: ${error.message.substring(0, 100)}`);
                await this._waitWithJitter(delay);
            }
        }

        throw lastError;
    }

    /**
     * Загрузка списка доступных моделей
     * @private
     */
    _loadModels() {
        try {
            const modelsPath = join(__dirname, '..', 'models.json');
            const data = JSON.parse(readFileSync(modelsPath, 'utf8'));
            return data.models;
        } catch (error) {
            console.warn(`⚠️ Не удалось загрузить список моделей: ${error.message}`);
            return [];
        }
    }

    /**
     * Получить список моделей с фильтрацией
     * 
     * @param {Object} filters - Фильтры
     * @param {string} filters.provider - Фильтр по провайдеру
     * @param {string} filters.type - Фильтр по типу модели
     * @returns {Array} Список моделей
     */
    getModels(filters = {}) {
        let models = this.models;

        if (filters.provider) {
            models = models.filter(m => 
                m.provider.toLowerCase() === filters.provider.toLowerCase()
            );
        }

        if (filters.type) {
            models = models.filter(m => 
                m.type.toLowerCase() === filters.type.toLowerCase()
            );
        }

        return models;
    }

    /**
     * Получить список всех провайдеров
     * @returns {Array} Список провайдеров
     */
    listProviders() {
        return [...new Set(this.models.map(model => model.provider))];
    }

    /**
     * Получить список всех типов моделей
     * @returns {Array} Список типов
     */
    listModelTypes() {
        return [...new Set(this.models.map(model => model.type))];
    }

    /**
     * Создать chat completion с автоматическими повторами
     * 
     * @param {Object} options - Параметры запроса
     * @param {string} options.model - ID модели
     * @param {Array} options.messages - Список сообщений
     * @param {number} options.maxTokens - Максимальное количество токенов
     * @param {number} options.temperature - Температура (0.0 - 2.0)
     * @returns {Promise<Object>} Ответ от модели
     */
    async chatCompletion(options = {}) {
        const {
            model,
            messages,
            maxTokens = 100,
            temperature = 0.7,
            ...otherParams
        } = options;

        const makeRequest = async () => {
            return await this.client.chat.completions.create({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                ...otherParams
            });
        };

        try {
            const response = await this._executeWithRetry(makeRequest);

            return {
                success: true,
                model: response.model,
                content: response.choices[0].message.content,
                usage: {
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                model: model
            };
        }
    }

    /**
     * Тестирование модели
     * 
     * @param {string} model - ID модели
     * @param {string} message - Тестовое сообщение
     * @returns {Promise<Object>} Результат теста
     */
    async testModel(model, message = 'Hello!') {
        return await this.chatCompletion({
            model,
            messages: [{ role: 'user', content: message }],
            maxTokens: 50
        });
    }

    /**
     * Тестирование всех моделей определенного типа с задержками
     * 
     * @param {Object} options - Опции тестирования
     * @param {string} options.type - Тип моделей
     * @param {number} options.limit - Лимит количества моделей
     * @param {string} options.message - Тестовое сообщение
     * @param {number} options.delayBetweenRequests - Задержка между запросами (мс)
     * @returns {Promise<Object>} Результаты тестирования
     */
    async testAllModels(options = {}) {
        const {
            type = 'chat',
            limit,
            message = 'Hello!',
            delayBetweenRequests = 500
        } = options;

        let chatModels = this.getModels({ type });
        if (limit) {
            chatModels = chatModels.slice(0, limit);
        }

        const results = {};
        
        for (let i = 0; i < chatModels.length; i++) {
            const modelInfo = chatModels[i];
            console.log(`🧪 Тестируем (${i+1}/${chatModels.length}): ${modelInfo.id}`);
            const result = await this.testModel(modelInfo.id, message);
            results[modelInfo.id] = result;

            if (result.success) {
                console.log(`✅ ${modelInfo.id}: ${result.content.substring(0, 100)}...`);
            } else {
                console.log(`❌ ${modelInfo.id}: ${result.error}`);
            }

            // Задержка между запросами для избежания rate limiting
            if (i < chatModels.length - 1) {  // Не ждать после последнего запроса
                await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
            }
        }

        return results;
    }

    /**
     * Получить эмбеддинги с автоматическими повторами
     * 
     * @param {Object} options - Параметры запроса
     * @param {string} options.model - ID модели для эмбеддингов
     * @param {string|Array} options.input - Текст или список текстов
     * @returns {Promise<Object>} Эмбеддинги
     */
    async getEmbedding(options = {}) {
        const { model, input, ...otherParams } = options;

        const makeRequest = async () => {
            return await this.client.embeddings.create({
                model,
                input,
                ...otherParams
            });
        };

        try {
            const response = await this._executeWithRetry(makeRequest);

            return {
                success: true,
                model: response.model,
                embeddings: response.data.map(item => item.embedding),
                usage: {
                    promptTokens: response.usage.prompt_tokens,
                    totalTokens: response.usage.total_tokens
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                model: model
            };
        }
    }

    /**
     * Получить статистику по моделям
     * @returns {Object} Статистика
     */
    getStats() {
        const stats = {
            total: this.models.length,
            byProvider: {},
            byType: {}
        };

        this.models.forEach(model => {
            // Подсчет по провайдерам
            stats.byProvider[model.provider] = (stats.byProvider[model.provider] || 0) + 1;
            
            // Подсчет по типам
            stats.byType[model.type] = (stats.byType[model.type] || 0) + 1;
        });

        return stats;
    }
}

/**
 * Пример использования клиента
 */
async function main() {
    console.log('🚀 GitHub Models Client - Node.js');
    console.log('='.repeat(50));

    // Инициализация клиента
    const client = new GitHubModelsClient();

    const stats = client.getStats();
    console.log(`📋 Доступно моделей: ${stats.total}`);
    console.log(`🏭 Провайдеры: ${client.listProviders().join(', ')}`);
    console.log(`📝 Типы моделей: ${client.listModelTypes().join(', ')}`);
    console.log();

    // Тест популярных моделей
    console.log('🧪 Тестируем популярные модели:');
    const popularModels = [
        'openai/gpt-4o-mini',
        'microsoft/phi-3-mini-128k-instruct',
        'meta/meta-llama-3.1-8b-instruct'
    ];

    for (const model of popularModels) {
        const result = await client.testModel(model, 'Привіт! Як справи?');
        if (result.success) {
            console.log(`✅ ${model}`);
            console.log(`   Ответ: ${result.content}`);
            console.log(`   Токены: ${result.usage.totalTokens}`);
        } else {
            console.log(`❌ ${model}: ${result.error}`);
        }
        console.log();
    }

    // Тест эмбеддингов
    console.log('🔍 Тестируем эмбеддинги:');
    const embeddingModels = client.getModels({ type: 'embedding' });
    if (embeddingModels.length > 0) {
        // Попробуем сначала OpenAI эмбеддинги
        const openaiEmbeddings = embeddingModels.filter(m => m.provider === 'OpenAI');
        const testModel = openaiEmbeddings.length > 0 ? openaiEmbeddings[0].id : embeddingModels[0].id;
        
        const result = await client.getEmbedding({
            model: testModel,
            input: 'Hello, world!'
        });
        
        if (result.success) {
            console.log(`✅ ${testModel}`);
            console.log(`   Размерность: ${result.embeddings[0].length}`);
            console.log(`   Токены: ${result.usage.totalTokens}`);
        } else {
            console.log(`❌ ${testModel}: ${result.error}`);
        }
    } else {
        console.log('⚠️ Эмбеддинг модели не найдены');
    }

    console.log('\n📊 Статистика по провайдерам:');
    Object.entries(stats.byProvider).forEach(([provider, count]) => {
        console.log(`   ${provider}: ${count} моделей`);
    });
}

// Запуск если файл вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default GitHubModelsClient;
