#!/usr/bin/env node
/**
 * Тестування моделей згідно з документацією
 */

// Працюючі моделі з документації
const workingModels = [
    // AI21 Labs
    'ai21-labs/ai21-jamba-1.5-large',
    'ai21-labs/ai21-jamba-1.5-mini',
    
    // Cohere
    'cohere/cohere-command-a',
    'cohere/cohere-command-r-08-2024',
    'cohere/cohere-command-r-plus-08-2024',
    
    // Core42
    'core42/jais-30b-chat',
    
    // DeepSeek
    'deepseek/deepseek-r1',
    'deepseek/deepseek-v3-0324',
    
    // Meta
    'meta/meta-llama-3.1-8b-instruct',
    'meta/llama-3.3-70b-instruct',
    
    // Microsoft (нові Phi-4)
    'microsoft/phi-4-mini-instruct',
    'microsoft/phi-4',
    
    // Mistral AI
    'mistral-ai/ministral-3b',
    'mistral-ai/mistral-small-2503',
    'mistral-ai/mistral-nemo',
    
    // OpenAI
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'openai/gpt-4.1-mini',
    
    // xAI
    'xai/grok-3-mini'
];

// Моделі, які мають бути недоступними
const notWorkingModels = [
    'microsoft/phi-3-mini-4k-instruct',
    'microsoft/phi-3.5-mini-instruct',
    'openai/o1-mini',
    'openai/gpt-5'
];

async function testModel(model) {
    const testMessage = "Hello! This is a test.";
    
    try {
        const response = await fetch('http://localhost:3010/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer dummy-key'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'user', content: testMessage }
                ],
                max_tokens: 50,
                temperature: 0.7
            })
        });

        if (response.ok) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || 'No content';
            return {
                status: 'SUCCESS',
                content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
                tokens: data.usage?.total_tokens || 'N/A'
            };
        } else {
            const errorData = await response.text();
            return {
                status: 'ERROR',
                error: `${response.status}: ${errorData.substring(0, 200)}`
            };
        }
    } catch (error) {
        return {
            status: 'FAILED',
            error: error.message
        };
    }
}

async function testModels() {
    console.log('🚀 Тестування моделей з прокси http://localhost:3010');
    console.log('=' * 60);
    
    console.log('\n✅ Тестування працюючих моделей:');
    console.log('-' * 40);
    
    const workingResults = [];
    for (const model of workingModels.slice(0, 10)) { // Тестуємо перші 10
        console.log(`\n🧪 Тестування: ${model}`);
        const result = await testModel(model);
        workingResults.push({ model, ...result });
        
        if (result.status === 'SUCCESS') {
            console.log(`   ✅ Працює - ${result.content}`);
            console.log(`   📊 Токени: ${result.tokens}`);
        } else {
            console.log(`   ❌ Помилка - ${result.error}`);
        }
        
        // Пауза між запитами
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n❌ Тестування неробочих моделей:');
    console.log('-' * 40);
    
    const notWorkingResults = [];
    for (const model of notWorkingModels) {
        console.log(`\n🧪 Тестування: ${model}`);
        const result = await testModel(model);
        notWorkingResults.push({ model, ...result });
        
        if (result.status === 'SUCCESS') {
            console.log(`   ⚠️  Несподівано працює! - ${result.content}`);
        } else {
            console.log(`   ✅ Очікувано не працює - ${result.error}`);
        }
        
        // Пауза між запитами
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n📊 Підсумок:');
    console.log('=' * 60);
    
    const successful = workingResults.filter(r => r.status === 'SUCCESS').length;
    const failed = workingResults.filter(r => r.status !== 'SUCCESS').length;
    
    console.log(`✅ Успішних: ${successful}/${workingResults.length}`);
    console.log(`❌ Невдалих: ${failed}/${workingResults.length}`);
    
    // Список робочих моделей для client-module
    const actualWorkingModels = workingResults
        .filter(r => r.status === 'SUCCESS')
        .map(r => r.model);
    
    console.log('\n🔧 Робочі моделі для client-module:');
    console.log(JSON.stringify(actualWorkingModels, null, 2));
}

testModels().catch(console.error);
