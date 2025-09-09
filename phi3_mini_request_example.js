#!/usr/bin/env node
/**
 * Приклад запиту до моделі microsoft/phi-3-mini-4k-instruct через ATLAS client-module
 */

import { GitHubModelsClient } from './client-module/nodejs_client/client.js';

async function main() {
    console.log('🤖 Тестуємо модель: microsoft/phi-3-mini-4k-instruct');
    console.log('='.repeat(50));

    // Ініціалізуємо клієнт (використовуємо локальний прокси ATLAS)
    const client = new GitHubModelsClient({
        proxyURL: 'http://localhost:5101/v1',  // ATLAS orchestrator API
        apiKey: 'dummy-key'
    });

    const modelName = 'microsoft/phi-3-mini-4k-instruct';

    try {
        // Простий запит
        console.log('📝 Простий запит:');
        const response = await client.chatCompletion({
            model: modelName,
            messages: [
                { role: 'user', content: 'Розкажи мені коротко про штучний інтелект українською мовою' }
            ],
            max_tokens: 500,
            temperature: 0.7
        });

        console.log(`Відповідь: ${response.choices[0].message.content}`);
        console.log(`Токенів використано: ${response.usage.total_tokens}`);
        console.log();

        // Складніший запит з контекстом
        console.log('🧠 Запит з контекстом:');
        const contextResponse = await client.chatCompletion({
            model: modelName,
            messages: [
                { role: 'system', content: 'Ти - досвідчений програміст JavaScript, який допомагає з кодом.' },
                { role: 'user', content: 'Напиши простий приклад використання async/await в JavaScript' }
            ],
            max_tokens: 800,
            temperature: 0.5
        });

        console.log(`Відповідь: ${contextResponse.choices[0].message.content}`);
        console.log(`Токенів використано: ${contextResponse.usage.total_tokens}`);
        console.log();

        // Креативний запит
        console.log('🎨 Креативний запит:');
        const creativeResponse = await client.chatCompletion({
            model: modelName,
            messages: [
                { role: 'user', content: 'Придумай короткий вірш про програмування українською мовою' }
            ],
            max_tokens: 300,
            temperature: 1.0
        });

        console.log(`Відповідь: ${creativeResponse.choices[0].message.content}`);
        console.log(`Токенів використано: ${creativeResponse.usage.total_tokens}`);

    } catch (error) {
        console.error(`❌ Помилка: ${error.message}`);
        console.log('\n🔧 Перевірте, що:');
        console.log('1. ATLAS система запущена (./restart_simple.sh)');
        console.log('2. Orchestrator працює на порту 5101');
        console.log('3. Модель доступна в models.json');
    }
}

main().catch(console.error);
