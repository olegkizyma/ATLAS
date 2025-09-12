/**
 * GitHub Models Client Adapter для ATLAS
 * Повністю використовує client-module з прокси на порту 3010
 */

import GitHubModelsClient from '../../client-module/nodejs_client/client.js';

// Singleton клієнт
let clientInstance = null;

function getClient() {
    if (!clientInstance) {
        const proxyURL = (process.env.GITHUB_MODELS_PROXY_URL || 'http://localhost:3010/v1').replace(/\/$/, '');
        clientInstance = new GitHubModelsClient({
            proxyURL,  // GitHub Models прокси
            maxRetries: 3,
            retryDelay: 1000,
            maxDelay: 60000
        });
        console.log(`[ATLAS_CLIENT] Initialized GitHub Models client with proxy ${proxyURL}`);
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

// Лічильник запитів для ротації
let requestCounter = 0;
let shuffledModels = new Map(); // Кеш перемішаних моделей для кожного агента

/**
 * Функція з агресивною ротацією моделей 
 * Використовує всі 58 моделей з ротацією кожен запит або кожні 3 запити
 */
export async function chatWithModelRotation(baseUrl, models, userMessage, options = {}) {
    const modelList = Array.isArray(models) ? models : [models];
    
    // Читаємо конфігурацію ротації з .env
    const rotationFreq = parseInt(process.env.MODEL_ROTATION_FREQUENCY || '1');
    const minPoolSize = parseInt(process.env.MODEL_ROTATION_MIN_POOL_SIZE || '8');
    const shuffleEvery = parseInt(process.env.MODEL_ROTATION_SHUFFLE_EVERY || '3');
    const rotationDelayMs = parseInt(process.env.MODEL_ROTATION_DELAY_MS || '2000');
    const aggressiveRotation = process.env.ENABLE_AGGRESSIVE_ROTATION === 'true';
    
    // Інкрементуємо лічильник запитів
    requestCounter++;
    
    let modelsToUse = modelList;
    
    // Агресивна ротація - перемішуємо модель кожні N запитів
    if (aggressiveRotation && requestCounter % shuffleEvery === 0) {
        const agentKey = options.agent || 'default';
        
        // Перемішуємо модель для цього агента
        const shuffled = [...modelList];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        shuffledModels.set(agentKey, shuffled);
        console.log(`[ROTATION] Shuffled ${shuffled.length} models for agent ${agentKey} (request #${requestCounter})`);
    }
    
    // Використовуємо перемішані моделі якщо доступні
    const agentKey = options.agent || 'default';
    if (shuffledModels.has(agentKey)) {
        modelsToUse = shuffledModels.get(agentKey);
    }
    
    // Використовуємо мінімум minPoolSize моделей
    const poolSize = Math.min(modelsToUse.length, Math.max(minPoolSize, 1));
    const modelPool = modelsToUse.slice(0, poolSize);
    
    console.log(`[ROTATION] Using ${modelPool.length} models from pool of ${modelsToUse.length} (req #${requestCounter})`);
    
    // Ротація кожен запит або кожні rotationFreq запитів
    const shouldRotate = requestCounter % rotationFreq === 0;
    if (shouldRotate && modelPool.length > 1) {
        // Починаємо з випадкової моделі
        const startIndex = Math.floor(Math.random() * modelPool.length);
        const rotatedPool = [...modelPool.slice(startIndex), ...modelPool.slice(0, startIndex)];
        console.log(`[ROTATION] Starting with model #${startIndex}: ${rotatedPool[0]}`);
        modelPool.splice(0, modelPool.length, ...rotatedPool);
    }
    
    for (let i = 0; i < modelPool.length; i++) {
        const model = modelPool[i];
        try {
            console.log(`[ROTATION] Trying model ${model} (attempt ${i + 1}/${modelPool.length})`);
            const result = await chatWithModel(baseUrl, model, userMessage, options);
            console.log(`[ROTATION] ✅ Success with model: ${model}`);
            return result;
        } catch (error) {
            console.log(`[ROTATION] ❌ Model ${model} failed: ${error.message}`);
            
            // Якщо це остання модель, кидаємо помилку
            if (i === modelPool.length - 1) {
                throw new Error(`All ${modelPool.length} models failed. Last error from ${model}: ${error.message}`);
            }
            
            // Додаємо затримку між спробами моделей (крім останньої)
            if (rotationDelayMs > 0 && i < modelPool.length - 1) {
                console.log(`[ROTATION] Waiting ${rotationDelayMs}ms before next model...`);
                await new Promise(resolve => setTimeout(resolve, rotationDelayMs));
            }
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
