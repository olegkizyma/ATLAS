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
            stream
            // Не передаємо timeout в запит, оскільки наш проксі його не підтримує
        });
        
        if (stream) {
            return response; // Повертаємо stream для обробки ззовні
        }
        
        const content = response.choices?.[0]?.message?.content;
        return content && content.trim() ? content.trim() : null;
        
    } catch (error) {
        console.warn(`[OpenAI SDK] Error with model ${model}:`, error.message);
        
        // Детальніша обробка помилок для ротації моделей
        if (error.status === 429) {
            const retryAfter = error.headers?.['retry-after'] || error.headers?.['Retry-After'] || 60;
            throw new Error(`RATE_LIMITED:${model}:${retryAfter}:${error.message}`);
        } else if (error.status === 401 || error.status === 403) {
            throw new Error(`AUTH_ERROR:${model}:${error.message}`);
        } else if (error.status === 404) {
            throw new Error(`MODEL_NOT_FOUND:${model}:${error.message}`);
        } else if (error.status === 400) {
            throw new Error(`BAD_REQUEST:${model}:${error.message}`);
        } else if (error.status === 500 || error.status === 502 || error.status === 503) {
            throw new Error(`SERVER_ERROR:${model}:${error.status}:${error.message}`);
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            throw new Error(`CONNECTION_ERROR:${baseUrl}:${error.message}`);
        } else if (error.code === 'ETIMEDOUT') {
            throw new Error(`TIMEOUT:${model}:${error.message}`);
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

/**
 * Розумна ротація моделей з обробкою помилок та retry логікою
 * Автоматично пробує наступні моделі при 429, 500 та інших помилках
 */
export async function chatWithModelRotation(baseUrl, models, userMessage, options = {}) {
    if (!Array.isArray(models) || models.length === 0) {
        throw new Error('Models array cannot be empty');
    }
    
    const {
        systemMessage = null,
        maxTokens = 1000,
        temperature = 0.7,
        stream = false,
        timeout = null,
        maxRetries = 2,
        retryDelay = 1000
    } = options;
    
    const errors = [];
    const rateLimitedModels = new Set();
    
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        
        // Пропускаємо rate limited моделі
        if (rateLimitedModels.has(model)) {
            console.log(`[ROTATION] Skipping rate limited model: ${model}`);
            continue;
        }
        
        for (let retry = 0; retry <= maxRetries; retry++) {
            try {
                console.log(`[ROTATION] Trying model ${model} (attempt ${retry + 1}/${maxRetries + 1})`);
                
                const result = await chatWithModel(baseUrl, model, userMessage, {
                    systemMessage,
                    maxTokens,
                    temperature,
                    stream,
                    timeout
                });
                
                console.log(`[ROTATION] ✅ Success with model: ${model}`);
                return {
                    content: result,
                    model: model,
                    attempt: retry + 1,
                    totalModelsUsed: i + 1
                };
                
            } catch (error) {
                const errorType = error.message.split(':')[0];
                
                if (errorType === 'RATE_LIMITED') {
                    const parts = error.message.split(':');
                    const modelName = parts[1] || model;
                    const retryAfter = parseInt(parts[2]) || 60;
                    
                    console.warn(`[ROTATION] ⚠️ Rate limited: ${modelName}, retry after ${retryAfter}s`);
                    rateLimitedModels.add(modelName);
                    errors.push({ model, error: error.message, type: 'rate_limit' });
                    break; // Переходимо до наступної моделі
                    
                } else if (errorType === 'MODEL_NOT_FOUND') {
                    console.warn(`[ROTATION] ❌ Model not found: ${model}`);
                    errors.push({ model, error: error.message, type: 'not_found' });
                    break; // Переходимо до наступної моделі
                    
                } else if (errorType === 'AUTH_ERROR') {
                    console.warn(`[ROTATION] 🔐 Auth error: ${model}`);
                    errors.push({ model, error: error.message, type: 'auth' });
                    break; // Переходимо до наступної моделі
                    
                } else if (errorType === 'SERVER_ERROR' && retry < maxRetries) {
                    console.warn(`[ROTATION] 🔄 Server error, retrying ${model} in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue; // Повторюємо ту ж модель
                    
                } else if (errorType === 'TIMEOUT' && retry < maxRetries) {
                    console.warn(`[ROTATION] ⏱️ Timeout, retrying ${model}...`);
                    continue; // Повторюємо ту ж модель
                    
                } else {
                    console.warn(`[ROTATION] ❌ Other error with ${model}: ${error.message}`);
                    errors.push({ model, error: error.message, type: 'other' });
                    break; // Переходимо до наступної моделі
                }
            }
        }
    }
    
    // Всі моделі провалились
    const errorSummary = errors.map(e => `${e.model}:${e.type}`).join(', ');
    throw new Error(`ALL_MODELS_FAILED: Tried ${models.length} models - ${errorSummary}`);
}

// Експорт для зворотної сумісності
export default {
    chatWithModel,
    chatWithModelTimeout,
    streamChatWithModel,
    batchChatWithModels,
    chatWithModelRotation,
    healthCheck,
    getAvailableModels,
    clearClients
};
