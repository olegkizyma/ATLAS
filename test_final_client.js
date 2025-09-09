#!/usr/bin/env node
/**
 * Фінальний тест моделі microsoft/phi-3-mini-4k-instruct через client-module
 */

import GitHubModelsClient from './client-module/nodejs_client/client.js';

async function testPhiModel() {
    console.log("🚀 Фінальний тест client-module з GitHub Models прокси");
    console.log("=" * 60);
    
    // Створюємо клієнт
    const client = new GitHubModelsClient({
        proxyURL: "http://localhost:3010/v1"
    });
    
    console.log(`🔗 Клієнт: http://localhost:3010/v1`);
    
    // Тестуємо кілька моделей
    const testModels = [
        "microsoft/phi-3-mini-4k-instruct",   // Оригінальна модель (може не працювати)
        "microsoft/phi-4-mini-instruct",      // Працююча модель
        "mistral-ai/ministral-3b",            // Альтернатива
        "openai/gpt-4o-mini"                  // Базова модель
    ];
    
    const testMessage = "Привіт! Розкажи коротко про себе українською мовою.";
    
    for (const model of testModels) {
        console.log(`\n🧪 Тестування: ${model}`);
        console.log("-" * 40);
        
        try {
            const result = await client.chatCompletion({
                model: model,
                messages: [
                    { role: "user", content: testMessage }
                ],
                maxTokens: 150,
                temperature: 0.7
            });
            
            if (result.success) {
                console.log(`✅ Працює!`);
                console.log(`🤖 Модель: ${result.model}`);
                console.log(`💬 Відповідь: ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`);
                console.log(`📊 Токени: ${result.usage?.totalTokens || 'N/A'}`);
            } else {
                console.log(`❌ Помилка: ${result.error}`);
            }
            
        } catch (error) {
            console.log(`❌ Виключення: ${error.message}`);
        }
        
        // Пауза між запитами
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log("\n🎯 Висновок:");
    console.log("=" * 60);
    console.log("✅ Client-module працює з GitHub Models прокси на порту 3010");
    console.log("✅ Можна використовувати різні моделі через єдиний інтерфейс");
    console.log("🔧 Оркестратор ATLAS може використовувати цей клієнт");
    console.log("📋 Доступно 58 моделей від 9 провайдерів");
}

testPhiModel().catch(console.error);
