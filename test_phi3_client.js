#!/usr/bin/env node
/**
 * Тест клієнта для microsoft/phi-3-mini-4k-instruct - Node.js версія
 */

import GitHubModelsClient from './client-module/nodejs_client/client.js';

async function testPhi3Mini() {
    console.log("🚀 Тестуємо модель microsoft/phi-3-mini-4k-instruct");
    console.log("=".repeat(50));
    
    // Створюємо клієнт
    const client = new GitHubModelsClient({
        proxyURL: "http://localhost:5101/v1"
    });
    
    // Тестове повідомлення українською
    const testMessage = "Розкажи коротко про штучний інтелект українською мовою. Максимум 3 речення.";
    
    console.log(`📝 Запит: ${testMessage}`);
    console.log("-".repeat(50));
    
    try {
        // Викликаємо модель
        const result = await client.chatCompletion({
            model: "microsoft/phi-3-mini-4k-instruct",
            messages: [
                { role: "user", content: testMessage }
            ],
            maxTokens: 200,
            temperature: 0.7
        });
        
        console.log("📊 Повна відповідь:", JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log("✅ Успіх!");
            console.log(`🤖 Модель: ${result.model || 'невідомо'}`);
            console.log(`💬 Відповідь: ${result.content || 'немає відповіді'}`);
            console.log(`📊 Токени: ${result.usage?.totalTokens || 'невідомо'}`);
        } else {
            console.log("❌ Помилка в результаті:");
            console.log(`🔍 Помилка: ${result.error}`);
        }
        
    } catch (error) {
        console.log(`❌ Помилка виконання: ${error.message}`);
        console.log(`🔍 Тип помилки: ${error.constructor.name}`);
        
        // Додаткова інформація для діагностики
        if (error.response) {
            console.log(`📡 Статус HTTP: ${error.response.status}`);
            console.log(`📄 Відповідь сервера:`, error.response.data);
        }
    }
}

// Запускаємо тест
testPhi3Mini().catch(console.error);
