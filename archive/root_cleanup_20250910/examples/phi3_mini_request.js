#!/usr/bin/env node
/**
 * Приклад запиту до API для моделі microsoft/phi-3-mini-4k-instruct
 * Використовує ATLAS API модуль
 */

import GitHubModelsClient from '../client-module/nodejs_client/client.js';

// Ініціалізація клієнта
const client = new GitHubModelsClient({
    proxyURL: 'http://127.0.0.1:3010/v1', // ATLAS прокси сервер
    maxRetries: 3,
    retryDelay: 1000
});

// Приклад 1: Простий запит
async function simpleRequest() {
    console.log('🚀 Приклад 1: Простий запит до microsoft/phi-3-mini-4k-instruct');
    
    try {
        const result = await client.chatCompletion({
            model: 'microsoft/phi-3-mini-4k-instruct',
            messages: [
                { role: 'user', content: 'Привіт! Як справи?' }
            ],
            maxTokens: 150,
            temperature: 0.7
        });

        if (result.success) {
            console.log('✅ Успішна відповідь:');
            console.log('📝 Контент:', result.content);
            console.log('🤖 Модель:', result.model);
            console.log('📊 Використання токенів:', result.usage);
        } else {
            console.log('❌ Помилка:', result.error);
        }
    } catch (error) {
        console.error('💥 Критична помилка:', error.message);
    }
}

// Приклад 2: Запит з системним повідомленням
async function requestWithSystemMessage() {
    console.log('\n🚀 Приклад 2: Запит з системним повідомленням');
    
    try {
        const result = await client.chatCompletion({
            model: 'microsoft/phi-3-mini-4k-instruct',
            messages: [
                { 
                    role: 'system', 
                    content: 'Ти - корисний асистент, який відповідає українською мовою і допомагає з технічними питаннями.' 
                },
                { 
                    role: 'user', 
                    content: 'Поясни, як працює система ATLAS та які у неї переваги?' 
                }
            ],
            maxTokens: 300,
            temperature: 0.8
        });

        if (result.success) {
            console.log('✅ Успішна відповідь:');
            console.log('📝 Контент:', result.content);
            console.log('🤖 Модель:', result.model);
            console.log('📊 Використання токенів:', result.usage);
        } else {
            console.log('❌ Помилка:', result.error);
        }
    } catch (error) {
        console.error('💥 Критична помилка:', error.message);
    }
}

// Приклад 3: Запит з налаштуваннями для швидкої роботи
async function fastRequest() {
    console.log('\n🚀 Приклад 3: Швидкий запит (низька температура, менше токенів)');
    
    try {
        const result = await client.chatCompletion({
            model: 'microsoft/phi-3-mini-4k-instruct',
            messages: [
                { 
                    role: 'user', 
                    content: 'Створи короткий список переваг моделі Phi-3 Mini' 
                }
            ],
            maxTokens: 100,
            temperature: 0.3 // Низька температура для більш точних відповідей
        });

        if (result.success) {
            console.log('✅ Успішна відповідь:');
            console.log('📝 Контент:', result.content);
            console.log('🤖 Модель:', result.model);
            console.log('📊 Використання токенів:', result.usage);
        } else {
            console.log('❌ Помилка:', result.error);
        }
    } catch (error) {
        console.error('💥 Критична помилка:', error.message);
    }
}

// Приклад 4: Тестування моделі
async function testModel() {
    console.log('\n🚀 Приклад 4: Тестування моделі');
    
    try {
        const result = await client.testModel(
            'microsoft/phi-3-mini-4k-instruct', 
            'Тест моделі Phi-3 Mini'
        );

        if (result.success) {
            console.log('✅ Модель працює:');
            console.log('📝 Відповідь:', result.content);
        } else {
            console.log('❌ Модель не працює:', result.error);
        }
    } catch (error) {
        console.error('💥 Помилка тестування:', error.message);
    }
}

// Приклад 5: Запит через ATLAS Orchestrator API
async function requestViaOrchestrator() {
    console.log('\n🚀 Приклад 5: Запит через ATLAS Orchestrator API');
    
    try {
        const axios = (await import('axios')).default;
        
        const response = await axios.post('http://localhost:5101/api/chat/model', {
            model: 'microsoft/phi-3-mini-4k-instruct',
            message: 'Розкажи про можливості системи ATLAS',
            options: {
                maxTokens: 200,
                temperature: 0.7,
                systemMessage: 'Ти - експерт з AI систем та розробки.'
            }
        });

        console.log('✅ Відповідь через Orchestrator:');
        console.log('📝 Контент:', response.data.content);
        console.log('🤖 Модель:', response.data.model);
        console.log('⏱️ Час виконання:', response.data.duration + 'ms');
        
    } catch (error) {
        console.error('💥 Помилка Orchestrator API:', error.message);
    }
}

// Запуск всіх прикладів
async function runAllExamples() {
    console.log('🎯 Демонстрація запитів до microsoft/phi-3-mini-4k-instruct');
    console.log('=' .repeat(60));
    
    // Перевіряємо, чи працює ATLAS система
    try {
        const axios = (await import('axios')).default;
        await axios.get('http://localhost:5101/health');
        console.log('✅ ATLAS система працює\n');
    } catch (error) {
        console.log('⚠️  ATLAS система не запущена. Запустіть: ./start_stack_macos.sh\n');
    }
    
    await simpleRequest();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Пауза між запитами
    
    await requestWithSystemMessage();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await fastRequest();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testModel();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await requestViaOrchestrator();
    
    console.log('\n🎉 Всі приклади завершено!');
}

// Запуск, якщо файл виконується напряму
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllExamples().catch(console.error);
}

export { simpleRequest, requestWithSystemMessage, fastRequest, testModel, requestViaOrchestrator };
