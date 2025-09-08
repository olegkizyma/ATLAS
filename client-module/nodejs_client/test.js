#!/usr/bin/env node
/**
 * Тестирование GitHub Models Client
 */

import GitHubModelsClient from './client.js';

async function runTests() {
    console.log('🧪 Запуск тестов GitHub Models Client');
    console.log('='.repeat(50));

    const client = new GitHubModelsClient();

    // Тест 1: Проверка загрузки моделей
    console.log('\n📋 Тест 1: Загрузка моделей');
    const allModels = client.getModels();
    console.log(`✅ Загружено моделей: ${allModels.length}`);

    // Тест 2: Фильтрация по провайдерам
    console.log('\n🏭 Тест 2: Фильтрация по провайдерам');
    const openaiModels = client.getModels({ provider: 'OpenAI' });
    const microsoftModels = client.getModels({ provider: 'Microsoft' });
    console.log(`✅ OpenAI моделей: ${openaiModels.length}`);
    console.log(`✅ Microsoft моделей: ${microsoftModels.length}`);

    // Тест 3: Фильтрация по типам
    console.log('\n📝 Тест 3: Фильтрация по типам');
    const chatModels = client.getModels({ type: 'chat' });
    const embeddingModels = client.getModels({ type: 'embedding' });
    console.log(`✅ Chat моделей: ${chatModels.length}`);
    console.log(`✅ Embedding моделей: ${embeddingModels.length}`);

    // Тест 4: Быстрый тест моделей
    console.log('\n🚀 Тест 4: Быстрый тест 3 моделей');
    const fastModels = [
        'openai/gpt-4o-mini',
        'microsoft/phi-3-mini-128k-instruct',
        'meta/meta-llama-3.1-8b-instruct'
    ];

    for (const model of fastModels) {
        try {
            const result = await client.testModel(model, 'Hi!');
            if (result.success) {
                console.log(`✅ ${model}: OK (${result.usage.totalTokens} tokens)`);
            } else {
                console.log(`❌ ${model}: ${result.error}`);
            }
        } catch (error) {
            console.log(`❌ ${model}: ${error.message}`);
        }
    }

    // Тест 5: Статистика
    console.log('\n📊 Тест 5: Статистика');
    const stats = client.getStats();
    console.log(`✅ Всего моделей: ${stats.total}`);
    console.log('✅ По провайдерам:');
    Object.entries(stats.byProvider).forEach(([provider, count]) => {
        console.log(`   ${provider}: ${count}`);
    });

    console.log('\n🎉 Все тесты завершены!');
}

runTests().catch(console.error);
