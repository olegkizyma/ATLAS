#!/usr/bin/env node
/**
 * Приклад запиту до моделі microsoft/phi-4-mini-instruct
 * (заміна для phi-3-mini-4k-instruct)
 */

import GitHubModelsClient from './client-module/nodejs_client/client.js';

async function exampleRequest() {
    const client = new GitHubModelsClient({
        proxyURL: "http://localhost:3010/v1"
    });
    
    console.log("🚀 Приклад запиту до microsoft/phi-4-mini-instruct");
    console.log("=" * 50);
    
    const result = await client.chatCompletion({
        model: "microsoft/phi-4-mini-instruct",  // Заміна для phi-3-mini-4k-instruct
        messages: [
            { 
                role: "user", 
                content: "Розкажи коротко про штучний інтелект українською мовою" 
            }
        ],
        maxTokens: 200,
        temperature: 0.7
    });
    
    if (result.success) {
        console.log("✅ Успішна відповідь:");
        console.log(`🤖 Модель: ${result.model}`);
        console.log(`💬 Відповідь: ${result.content}`);
        console.log(`📊 Токени: ${result.usage.totalTokens}`);
        
        return {
            model: result.model,
            content: result.content,
            tokens: result.usage.totalTokens
        };
    } else {
        console.log(`❌ Помилка: ${result.error}`);
        return null;
    }
}

// Приклад використання в оркестраторі ATLAS
async function atlasOrchestratorExample() {
    console.log("\n🧠 Приклад для оркестратора ATLAS:");
    console.log("-" * 40);
    
    const client = new GitHubModelsClient({
        proxyURL: "http://localhost:3010/v1"
    });
    
    // Функція для виклику моделі в оркестраторі
    async function callModel(agentName, message) {
        try {
            const result = await client.chatCompletion({
                model: "microsoft/phi-4-mini-instruct",
                messages: [
                    { role: "system", content: `Ти ${agentName} агент ATLAS системи.` },
                    { role: "user", content: message }
                ],
                maxTokens: 300,
                temperature: 0.7
            });
            
            return result.success ? result.content : null;
        } catch (error) {
            console.error(`Помилка ${agentName}:`, error.message);
            return null;
        }
    }
    
    // Тест для різних агентів
    const agents = ['Atlas', 'Tetyana', 'Grisha'];
    
    for (const agent of agents) {
        console.log(`\n🎭 Тестування агента ${agent}:`);
        const response = await callModel(agent, "Привіт! Як справи?");
        
        if (response) {
            console.log(`✅ ${agent}: ${response.substring(0, 100)}...`);
        } else {
            console.log(`❌ ${agent}: Помилка відповіді`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

// Запуск прикладів
if (import.meta.url === `file://${process.argv[1]}`) {
    await exampleRequest();
    await atlasOrchestratorExample();
}
