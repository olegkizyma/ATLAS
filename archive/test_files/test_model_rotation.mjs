#!/usr/bin/env node
/**
 * Тест системи ротації моделей ATLAS
 * Перевіряє як система справляється з 429 та іншими помилками
 */

import { chatWithModelRotation } from './frontend_new/orchestrator/openai_client.js';

const BASE_URL = 'http://localhost:3010/v1';

// Моделі для тестування (включаючи деякі неіснуючі для тестування помилок)
const TEST_MODELS = [
    'nonexistent-model-test',           // Тест 404 помилки
    'mistral-ai/ministral-3b',          // Швидка модель
    'openai/gpt-4o-mini',               // Стабільна модель
    'microsoft/phi-3.5-mini-instruct',  // Резервна модель
    'meta/meta-llama-3.1-8b-instruct'   // Ще одна резервна
];

async function testRotation() {
    console.log('🔄 Тестування системи ротації моделей ATLAS');
    console.log('='.repeat(60));
    
    const testCases = [
        {
            name: 'Простий запит',
            message: 'Привіт! Як справи?',
            options: { maxTokens: 50 }
        },
        {
            name: 'Складний запит',
            message: 'Поясни різницю між JavaScript та TypeScript. Дай коротку відповідь.',
            options: { maxTokens: 200, temperature: 0.3 }
        },
        {
            name: 'Швидкий запит з коротким таймаутом',
            message: 'Один плюс один?',
            options: { maxTokens: 10, timeout: 2000 }
        }
    ];
    
    for (const testCase of testCases) {
        console.log(`\n📋 Тест: ${testCase.name}`);
        console.log('-'.repeat(40));
        
        try {
            const start = Date.now();
            const result = await chatWithModelRotation(
                BASE_URL,
                TEST_MODELS,
                testCase.message,
                testCase.options
            );
            
            const duration = Date.now() - start;
            
            console.log(`✅ Успіх! Модель: ${result.model}`);
            console.log(`⏱️  Час: ${duration}ms`);
            console.log(`📊 Спроб: ${result.attempt}, Моделей перепробовано: ${result.totalModelsUsed}`);
            console.log(`📝 Відповідь: ${result.content.slice(0, 100)}...`);
            
        } catch (error) {
            console.log(`❌ Помилка: ${error.message}`);
        }
    }
}

async function testSingleModel() {
    console.log('\n\n🎯 Тест одної швидкої моделі');
    console.log('='.repeat(60));
    
    try {
        const start = Date.now();
        const result = await chatWithModelRotation(
            BASE_URL,
            ['mistral-ai/ministral-3b'], // Тільки одна швидка модель
            'Скажи "привіт" українською',
            { maxTokens: 20 }
        );
        
        const duration = Date.now() - start;
        
        console.log(`✅ Швидка модель працює! Час: ${duration}ms`);
        console.log(`📝 Відповідь: ${result.content}`);
        
    } catch (error) {
        console.log(`❌ Швидка модель недоступна: ${error.message}`);
    }
}

async function testFailureScenario() {
    console.log('\n\n💥 Тест сценарію повної помилки');
    console.log('='.repeat(60));
    
    const failingModels = [
        'definitely-not-a-model',
        'another-fake-model',
        'third-fake-model'
    ];
    
    try {
        const result = await chatWithModelRotation(
            BASE_URL,
            failingModels,
            'Цей запит має провалитись',
            { maxTokens: 10, maxRetries: 1 }
        );
        
        console.log(`❓ Несподіваний успіх: ${result.content}`);
        
    } catch (error) {
        console.log(`✅ Очікувана помилка: ${error.message}`);
        
        // Перевіряємо, чи містить помилка інформацію про всі спробовані моделі
        if (error.message.includes('ALL_MODELS_FAILED')) {
            console.log(`📊 Система правильно спробувала всі ${failingModels.length} моделей`);
        }
    }
}

// Запускаємо тести
async function runAllTests() {
    try {
        await testRotation();
        await testSingleModel();
        await testFailureScenario();
        
        console.log('\n\n🎉 Всі тести завершені!');
        console.log('\n💡 Для тестування через HTTP використовуйте:');
        console.log('curl -X POST http://localhost:5101/test/model_rotation \\');
        console.log('  -H "Content-Type: application/json" \\');
        console.log('  -d \'{"agent": "atlas", "message": "Привіт!", "intent": "smalltalk"}\'');
        
    } catch (error) {
        console.error('💥 Критична помилка в тестах:', error);
        process.exit(1);
    }
}

runAllTests();
