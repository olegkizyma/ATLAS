/**
 * GitHub Models Client Adapter для ATLAS
 * Повністю використовує client-module з прокси на порту 3010
 */

import GitHubModelsClient from '../../client-module/nodejs_client/client.js';

// Singleton клієнт
let clientInstance = null;

function getClient() {
    if (!clientInstance) {
        clientInstance = new GitHubModelsClient({
            proxyURL: 'http://localhost:3010/v1',  // GitHub Models прокси
            maxRetries: 3,
            retryDelay: 1000,
            maxDelay: 60000
        });
        console.log('[ATLAS_CLIENT] Initialized GitHub Models client with proxy http://localhost:3010/v1');
    }
    return clientInstance;
}

/**
 * Основна функція для чату з моделлю через client-module
 */
export async function chatWithModel(baseUrl, model, userMessage, options = {}) {
    const {
        systemMessage = null,
        maxTokens = 1000,
        temperature = 0.7,
        timeout = null
    } = options;

    const client = getClient();
    
    console.log(`[ATLAS_CLIENT] Calling model: ${model} with message length: ${userMessage.length}`);

    try {
        // Готуємо повідомлення
        const messages = [];
        if (systemMessage) {
            messages.push({ role: 'system', content: systemMessage });
        }
        messages.push({ role: 'user', content: userMessage });

        // Викликаємо модель через client-module
        const result = await client.chatCompletion({
            model: model,
            messages: messages,
            maxTokens: maxTokens,
            temperature: temperature
        });

        if (result.success) {
            console.log(`[ATLAS_CLIENT] Success: ${model} -> ${result.content.length} chars, ${result.usage?.totalTokens || 'N/A'} tokens`);
            
            return {
                content: result.content,
                model: result.model,
                usage: result.usage,
                success: true
            };
        } else {
            console.error(`[ATLAS_CLIENT] Model error: ${model} -> ${result.error}`);
            throw new Error(`Model ${model} failed: ${result.error}`);
        }

    } catch (error) {
        console.error(`[ATLAS_CLIENT] Exception calling ${model}:`, error.message);
        throw error;
    }
}

/**
 * Функція з таймаутом
 */
export async function chatWithModelTimeout(baseUrl, model, userMessage, timeoutMs, options = {}) {
    const timeout = timeoutMs || 30000; // 30 секунд за замовчуванням
    
    return Promise.race([
        chatWithModel(baseUrl, model, userMessage, options),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        )
    ]);
}

/**
 * Функція з ротацією моделей (для випадку коли одна модель не працює)
 */
export async function chatWithModelRotation(baseUrl, models, userMessage, options = {}) {
    const modelList = Array.isArray(models) ? models : [models];
    
    for (const model of modelList) {
        try {
            console.log(`[ATLAS_CLIENT] Trying model: ${model}`);
            const result = await chatWithModel(baseUrl, model, userMessage, options);
            console.log(`[ATLAS_CLIENT] Model rotation success with: ${model}`);
            return result;
        } catch (error) {
            console.log(`[ATLAS_CLIENT] Model ${model} failed: ${error.message}`);
            
            // Якщо це остання модель, кидаємо помилку
            if (model === modelList[modelList.length - 1]) {
                throw new Error(`All models failed. Last error from ${model}: ${error.message}`);
            }
            
            // Інакше пробуємо наступну модель
            continue;
        }
    }
}

/**
 * Перевірка здоров'я клієнта
 */
export async function healthCheck() {
    try {
        const client = getClient();
        
        // Пробуємо простий запит
        const result = await client.chatCompletion({
            model: 'openai/gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hi' }],
            maxTokens: 10
        });
        
        return {
            status: 'healthy',
            client: 'github-models-proxy',
            url: 'http://localhost:3010/v1',
            test_result: result.success
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            client: 'github-models-proxy',
            url: 'http://localhost:3010/v1',
            error: error.message
        };
    }
}

// Додаткові експорти для сумісності з існуючим кодом ATLAS
export { getClient };

// Експорт за замовчуванням для сумісності
export default { 
    chatWithModel, 
    chatWithModelTimeout, 
    chatWithModelRotation, 
    healthCheck, 
    getClient 
};
