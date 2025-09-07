/**
 * OpenAI SDK Client для ATLAS
 * Замінює прямі HTTP запити на використання офіційного OpenAI SDK
 */

import OpenAI from 'openai';

// Конфігурація клієнтів
const DEFAULT_FALLBACK_BASE = process.env.FALLBACK_API_BASE || 'http://127.0.0.1:3010/v1';
const DEFAULT_API_KEY = process.env.OPENAI_COMPAT_API_KEY || process.env.FALLBACK_API_KEY || 'dummy-key';

// Singleton клієнти для різних базових URL
const clients = new Map();

/**
 * Отримує або створює OpenAI клієнт для вказаного базового URL
 */
function getClient(baseUrl = DEFAULT_FALLBACK_BASE) {
    if (!clients.has(baseUrl)) {
        const client = new OpenAI({
            apiKey: DEFAULT_API_KEY,
            baseURL: baseUrl,
            timeout: 60000, // 60 секунд таймаут
            maxRetries: 2,   // автоматичні повтори
        });
        clients.set(baseUrl, client);
    }
    return clients.get(baseUrl);
}

/**
 * Динамічний розрахунок таймауту на основі розміру повідомлення та моделі
 */
function calculateTimeout(model, message) {
    const baseMs = parseInt(process.env.LLM_BASE_TIMEOUT_MS || '8000', 10);
    const perTokMs = parseFloat(process.env.LLM_PER_TOKEN_TIMEOUT_MS || '18');
    const maxMs = parseInt(process.env.LLM_MAX_TIMEOUT_MS || '60000', 10);
    
    // Приблизна оцінка токенів (1 токен ≈ 4 символи)
    const estimatedTokens = Math.ceil((message || '').length / 4);
    
    let timeout = baseMs + estimatedTokens * perTokMs;
    
    // Корекція для різних моделей
    const modelLower = (model || '').toLowerCase();
    if (/70b|gpt-5|deepseek-v3/.test(modelLower)) {
        timeout *= 1.6;
    } else if (/llama-3\.3|gemma-2|deepseek-r1/.test(modelLower)) {
        timeout *= 1.25;
    }
    
    return Math.min(Math.max(timeout, baseMs), maxMs);
}

/**
 * Основна функція для чату з OpenAI SDK
 * Заміна для callOpenAICompatChat
 */
export async function chatWithModel(baseUrl, model, userMessage, options = {}) {
    const client = getClient(baseUrl);
    
    const {
        systemMessage = null,
        maxTokens = 1000,
        temperature = 0.7,
        stream = false,
        timeout = null
    } = options;
    
    try {
        // Формуємо повідомлення
        const messages = [];
        if (systemMessage) {
            messages.push({ role: 'system', content: systemMessage });
        }
        messages.push({ role: 'user', content: userMessage });
        
        // Розраховуємо таймаут
        const finalTimeout = timeout || calculateTimeout(model, userMessage);
        
        const response = await client.chat.completions.create({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
            stream,
            timeout: finalTimeout
        });
        
        if (stream) {
            return response; // Повертаємо stream для обробки ззовні
        }
        
        const content = response.choices?.[0]?.message?.content;
        return content && content.trim() ? content.trim() : null;
        
    } catch (error) {
        console.warn(`[OpenAI SDK] Error with model ${model}:`, error.message);
        
        // Детальніша обробка помилок
        if (error.status === 429) {
            throw new Error(`RATE_LIMITED:${error.message}`);
        } else if (error.status === 401 || error.status === 403) {
            throw new Error(`AUTH_ERROR:${error.message}`);
        } else if (error.status === 404) {
            throw new Error(`MODEL_NOT_FOUND:${model}`);
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            throw new Error(`CONNECTION_ERROR:${baseUrl}`);
        }
        
        throw error;
    }
}

/**
 * Функція з таймаутом (заміна для callOpenAICompatChatWithTimeout)
 */
export async function chatWithModelTimeout(baseUrl, model, userMessage, timeoutMs = 1500, options = {}) {
    return chatWithModel(baseUrl, model, userMessage, {
        ...options,
        timeout: timeoutMs
    });
}

/**
 * Потокова функція для streaming відповідей
 */
export async function streamChatWithModel(baseUrl, model, userMessage, options = {}) {
    const stream = await chatWithModel(baseUrl, model, userMessage, {
        ...options,
        stream: true
    });
    
    return stream;
}

/**
 * Batch функція для обробки кількох запитів
 */
export async function batchChatWithModels(baseUrl, requests) {
    const client = getClient(baseUrl);
    
    const promises = requests.map(async (req) => {
        try {
            const result = await chatWithModel(baseUrl, req.model, req.message, req.options);
            return {
                success: true,
                model: req.model,
                result,
                ...req.metadata
            };
        } catch (error) {
            return {
                success: false,
                model: req.model,
                error: error.message,
                ...req.metadata
            };
        }
    });
    
    return Promise.allSettled(promises);
}

/**
 * Перевірка здоров'я моделі
 */
export async function healthCheck(baseUrl = DEFAULT_FALLBACK_BASE) {
    try {
        const client = getClient(baseUrl);
        
        // Простий тест з мінімальним запитом
        const response = await client.chat.completions.create({
            model: 'openai/gpt-4o-mini', // Використовуємо стабільну модель
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            timeout: 5000
        });
        
        return response.choices?.[0]?.message?.content !== undefined;
    } catch (error) {
        console.warn(`[OpenAI SDK] Health check failed for ${baseUrl}:`, error.message);
        return false;
    }
}

/**
 * Отримання списку доступних моделей
 */
export async function getAvailableModels(baseUrl = DEFAULT_FALLBACK_BASE) {
    try {
        const client = getClient(baseUrl);
        const response = await client.models.list();
        return response.data.map(model => model.id);
    } catch (error) {
        console.warn(`[OpenAI SDK] Failed to get models from ${baseUrl}:`, error.message);
        return [];
    }
}

/**
 * Очищення кешу клієнтів (для тестування)
 */
export function clearClients() {
    clients.clear();
}

// Експорт для зворотної сумісності
export default {
    chatWithModel,
    chatWithModelTimeout,
    streamChatWithModel,
    batchChatWithModels,
    healthCheck,
    getAvailableModels,
    clearClients
};
