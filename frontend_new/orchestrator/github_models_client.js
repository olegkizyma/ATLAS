/**
 * GitHub Models Client Adapter для ATLAS
 * Використовує client-module замість старого openai_client.js
 */

import GitHubModelsClient from '../../client-module/nodejs_client/client.js';

// Global request manager для уникнення concurrent requests
class GlobalRequestManager {
    constructor() {
        this.lastRequestTime = 0;
        this.minDelay = 1500; // Мінімум 1.5 секунди між запитами
        this.rateLimitedModels = new Map(); // model -> timestamp коли можна знову спробувати
    }
    
    async waitForNextRequest() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minDelay) {
            const waitTime = this.minDelay - timeSinceLastRequest;
            console.log(`[GLOBAL_RATE_LIMIT] Waiting ${waitTime}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
    }
    
    isModelRateLimited(model) {
        const blockedUntil = this.rateLimitedModels.get(model);
        if (!blockedUntil) return false;
        
        if (Date.now() < blockedUntil) {
            const remainingMs = blockedUntil - Date.now();
            console.log(`[GLOBAL_RATE_LIMIT] Model ${model} blocked for ${Math.ceil(remainingMs/1000)}s more`);
            return true;
        }
        
        // Час вийшов, прибираємо з списку
        this.rateLimitedModels.delete(model);
        return false;
    }
    
    markModelRateLimited(model, retryAfterSeconds = 60) {
        const blockedUntil = Date.now() + (retryAfterSeconds * 1000);
        this.rateLimitedModels.set(model, blockedUntil);
        console.log(`[GLOBAL_RATE_LIMIT] Model ${model} blocked for ${retryAfterSeconds}s`);
    }
}

const globalRequestManager = new GlobalRequestManager();

// Singleton клієнт
let clientInstance = null;

function getClient() {
    if (!clientInstance) {
        clientInstance = new GitHubModelsClient({
            proxyURL: process.env.FALLBACK_API_BASE || 'http://127.0.0.1:3010/v1',
            maxRetries: 2,
            retryDelay: 1000,
            maxDelay: 60000
        });
    }
    return clientInstance;
}

/**
 * Динамічний розрахунок таймауту на основі розміру повідомлення та моделі
 */
function calculateTimeout(model, message) {
    const baseMs = parseInt(process.env.LLM_BASE_TIMEOUT_MS || '8000', 10);
    const perTokenMs = parseInt(process.env.LLM_PER_TOKEN_TIMEOUT_MS || '18', 10);
    const maxMs = parseInt(process.env.LLM_MAX_TIMEOUT_MS || '60000', 10);
    
    // Приблизна кількість токенів (4 символи = 1 токен)
    const estimatedTokens = Math.ceil(message.length / 4);
    const calculatedTimeout = baseMs + (estimatedTokens * perTokenMs);
    
    return Math.min(calculatedTimeout, maxMs);
}

/**
 * Основна функція для чату з моделлю
 */
export async function chatWithModel(baseUrl, model, userMessage, options = {}) {
    const {
        systemMessage = null,
        maxTokens = 1000,
        temperature = 0.7,
        stream = false,
        timeout = null
    } = options;

    // Глобальне обмеження запитів
    await globalRequestManager.waitForNextRequest();

    // Перевіряємо rate limit для моделі
    if (globalRequestManager.isModelRateLimited(model)) {
        throw new Error(`Model ${model} is rate limited`);
    }

    const client = getClient();
    const messages = [];
    
    if (systemMessage) {
        messages.push({ role: 'system', content: systemMessage });
    }
    messages.push({ role: 'user', content: userMessage });

    const actualTimeout = timeout || calculateTimeout(model, userMessage);

    try {
        const startTime = Date.now();
        
        const result = await client.chatCompletion({
            model,
            messages,
            maxTokens,
            temperature,
            timeout: actualTimeout
        });

        const duration = Date.now() - startTime;

        if (!result.success) {
            throw new Error(result.error);
        }

        console.log(`[GitHub Models] ✅ Success with model: ${model} (${duration}ms)`);

        return {
            content: result.content,
            model: result.model,
            usage: result.usage,
            duration
        };

    } catch (error) {
        console.error(`[GitHub Models] Error with model ${model}:`, error.message);

        // Обробляємо rate limiting
        if (error.message.includes('429') || error.message.toLowerCase().includes('rate limit')) {
            globalRequestManager.markModelRateLimited(model, 60);
        }

        throw error;
    }
}

/**
 * Чат з таймаутом
 */
export async function chatWithModelTimeout(baseUrl, model, userMessage, timeoutMs, options = {}) {
    return chatWithModel(baseUrl, model, userMessage, { ...options, timeout: timeoutMs });
}

/**
 * Чат з ротацією моделей
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
        if (rateLimitedModels.has(model) || globalRequestManager.isModelRateLimited(model)) {
            console.log(`[ROTATION] Skipping rate limited model: ${model}`);
            continue;
        }
        
        // Додаємо затримку між моделями
        if (i > 0) {
            const modelSwitchDelay = 3000;
            console.log(`[ROTATION] Waiting ${modelSwitchDelay}ms before trying next model...`);
            await new Promise(resolve => setTimeout(resolve, modelSwitchDelay));
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
                return result;
                
            } catch (error) {
                const errorMsg = error.message;
                errors.push(`${model}: ${errorMsg}`);
                
                // Rate limiting - не ретрай, спробуй наступну модель
                if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('rate limit')) {
                    console.log(`[ROTATION] ⚠️ Rate limited: ${model}, trying next model`);
                    rateLimitedModels.add(model);
                    break; // Переходимо до наступної моделі
                }
                
                // Server errors - ретрай
                if (errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')) {
                    if (retry < maxRetries) {
                        const delay = retryDelay * Math.pow(2, retry);
                        console.log(`[ROTATION] ⚠️ Server error, retrying ${model} in ${delay}ms`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }
                
                console.log(`[ROTATION] ❌ Failed: ${model} - ${errorMsg}`);
                break; // Переходимо до наступної моделі
            }
        }
    }
    
    throw new Error(`ALL_MODELS_FAILED: Tried ${models.length} models. Errors: ${errors.join(', ')}`);
}

/**
 * Health check для прокси
 */
export async function healthCheck(baseUrl) {
    try {
        const client = getClient();
        const models = client.getModels();
        return {
            healthy: true,
            models: models.length,
            baseUrl
        };
    } catch (error) {
        return {
            healthy: false,
            error: error.message,
            baseUrl
        };
    }
}

export {
    getClient,
    calculateTimeout,
    globalRequestManager
};
