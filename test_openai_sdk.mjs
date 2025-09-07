#!/usr/bin/env node
/**
 * ATLAS OpenAI SDK Integration Demo (Node.js)
 * Демонстрація використання OpenAI SDK з компактними моделями ATLAS
 */

import OpenAI from 'openai';
import fs from 'fs';

// Налаштування клієнта для локального проксі
const client = new OpenAI({
  apiKey: 'dummy-key',  // Для локального проксі може бути будь-яким
  baseURL: 'http://localhost:3010/v1',
  timeout: 30000
});

// Компактні моделі для тестування
const COMPACT_MODELS = [
  "openai/gpt-4o-mini",
  "microsoft/phi-3.5-mini-instruct", 
  "mistral-ai/ministral-3b",
  "microsoft/phi-3-mini-4k-instruct",
  "meta/meta-llama-3.1-8b-instruct"
];

/**
 * Тест одної моделі
 */
async function testSingleModel(model, message = "Привіт! Як справи?") {
  console.log(`\n🤖 Тестування ${model}`);
  console.log('='.repeat(50));
  
  const startTime = Date.now();
  
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Ви - корисний AI асистент." },
        { role: "user", content: message }
      ],
      max_tokens: 500,
      temperature: 0.7
    });
    
    const duration = Date.now() - startTime;
    const content = response.choices[0].message.content;
    const tokens = response.usage?.total_tokens || 0;
    
    console.log(`⏱️  Час відповіді: ${duration}мс`);
    console.log(`🎯 Токенів: ${tokens}`);
    console.log(`📝 Відповідь: ${content.slice(0, 200)}...`);
    
    return {
      model,
      success: true,
      duration,
      tokens,
      content
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`❌ Помилка: ${error.message}`);
    
    return {
      model,
      success: false,
      duration,
      error: error.message
    };
  }
}

/**
 * Тест потокової передачі
 */
async function testStreaming(model = "mistral-ai/ministral-3b", message = "Розкажи короткий анекдот") {
  console.log(`\n🌊 Streaming тест з ${model}`);
  console.log('='.repeat(50));
  
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: message }],
      max_tokens: 300,
      temperature: 0.8,
      stream: true
    });
    
    console.log("📡 Потокова відповідь:");
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      process.stdout.write(content);
    }
    
    console.log("\n✅ Streaming завершено");
    
  } catch (error) {
    console.log(`❌ Streaming помилка: ${error.message}`);
  }
}

/**
 * Асинхронний тест кількох моделей
 */
async function testAsyncMultiple() {
  console.log(`\n⚡ Асинхронний тест кількох моделей`);
  console.log('='.repeat(50));
  
  const prompt = "Напиши короткий вірш про програмування";
  
  // Беремо перші 3 моделі для демо
  const testModels = COMPACT_MODELS.slice(0, 3);
  
  const startTime = Date.now();
  
  const promises = testModels.map(async (model) => {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7
      });
      
      return {
        model,
        success: true,
        content: response.choices[0].message.content
      };
    } catch (error) {
      return {
        model,
        success: false,
        error: error.message
      };
    }
  });
  
  const results = await Promise.all(promises);
  const duration = Date.now() - startTime;
  
  console.log(`⏱️  Загальний час: ${duration}мс`);
  
  results.forEach(result => {
    console.log(`\n🤖 ${result.model}:`);
    if (result.success) {
      console.log(`✅ ${result.content.slice(0, 100)}...`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  });
}

/**
 * Порівняння продуктивності моделей
 */
async function compareModelsPerformance() {
  console.log(`\n📊 Порівняння продуктивності компактних моделей`);
  console.log('='.repeat(60));
  
  const testPrompt = "Поясни що таке JavaScript у 2-3 реченнях";
  const results = [];
  
  for (const model of COMPACT_MODELS) {
    const result = await testSingleModel(model, testPrompt);
    results.push(result);
    
    // Невелика пауза між запитами
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Сортуємо за швидкістю
  const successfulResults = results.filter(r => r.success);
  successfulResults.sort((a, b) => a.duration - b.duration);
  
  console.log(`\n🏆 Рейтинг за швидкістю:`);
  successfulResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.model}: ${result.duration}мс (${result.tokens} токенів)`);
  });
  
  return successfulResults;
}

/**
 * Тест різних типів завдань
 */
async function testDifferentTasks() {
  const tasks = {
    "Код": "Створи функцію для сортування масиву на JavaScript",
    "Аналіз": "Проаналізуй переваги та недоліки Node.js vs Python",
    "Креативність": "Напиши невеликий вірш про штучний інтелект",
    "Факти": "Назви 3 найпопулярніші мови програмування"
  };
  
  // Використовуємо найшвидшу модель для всіх завдань
  const model = "mistral-ai/ministral-3b";
  
  console.log(`\n🎯 Тест різних завдань з ${model}`);
  console.log('='.repeat(60));
  
  for (const [taskName, prompt] of Object.entries(tasks)) {
    console.log(`\n📋 Завдання: ${taskName}`);
    console.log('-'.repeat(30));
    
    const result = await testSingleModel(model, prompt);
    if (result.success) {
      console.log(`✅ Успішно за ${result.duration}мс`);
    } else {
      console.log(`❌ Помилка: ${result.error}`);
    }
  }
}

/**
 * Створення клієнта для ATLAS системи
 */
function createATLASClient() {
  console.log(`\n🧠 Приклад створення ATLAS клієнта`);
  console.log('='.repeat(50));
  
  const atlasClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
    baseURL: 'http://localhost:3010/v1',
    timeout: 60000,
    maxRetries: 3
  });
  
  console.log(`✅ ATLAS клієнт створено`);
  console.log(`🔗 Base URL: http://localhost:3010/v1`);
  console.log(`🔑 API Key: ${process.env.OPENAI_API_KEY ? 'Встановлено' : 'Dummy key'}`);
  console.log(`⏱️  Timeout: 60s`);
  console.log(`🔄 Max Retries: 3`);
  
  return atlasClient;
}

/**
 * Збереження результатів у файл
 */
async function saveResults(results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `atlas_sdk_test_${timestamp}.json`;
  
  const reportData = {
    timestamp: new Date().toISOString(),
    total_models: COMPACT_MODELS.length,
    successful_models: results.filter(r => r.success).length,
    results: results,
    summary: {
      fastest_model: results[0]?.model,
      fastest_time: results[0]?.duration,
      average_time: Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length)
    }
  };
  
  fs.writeFileSync(filename, JSON.stringify(reportData, null, 2));
  console.log(`💾 Результати збережено у ${filename}`);
}

/**
 * Головна функція демонстрації
 */
async function main() {
  console.log("🚀 ATLAS OpenAI SDK Integration Demo");
  console.log('='.repeat(60));
  
  // Перевіримо доступність сервера
  try {
    const models = await client.models.list();
    console.log(`✅ Сервер доступний, моделей: ${models.data.length}`);
  } catch (error) {
    console.log(`❌ Сервер недоступний: ${error.message}`);
    console.log("🔧 Запустіть fallback сервер: node fallback_llm/server_sdk.js");
    return;
  }
  
  // Створюємо клієнта
  const atlasClient = createATLASClient();
  
  // Послідовність тестів
  await testSingleModel(COMPACT_MODELS[0]);
  await testStreaming();
  await testAsyncMultiple();
  
  // Порівняння продуктивності
  const performanceResults = await compareModelsPerformance();
  
  // Тест різних завдань
  await testDifferentTasks();
  
  // Збереження результатів
  await saveResults(performanceResults);
  
  console.log(`\n🎉 Демонстрація завершена!`);
  console.log("💡 Тепер ви можете використовувати OpenAI SDK з ATLAS!");
  console.log(`\n📖 Приклад базового використання:`);
  console.log(`
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key',
  baseURL: 'http://localhost:3010/v1'
});

const response = await client.chat.completions.create({
  model: 'mistral-ai/ministral-3b',
  messages: [{ role: 'user', content: 'Привіт!' }]
});

console.log(response.choices[0].message.content);
  `);
}

// Обробка помилок
process.on('unhandledRejection', (error) => {
  console.error('❌ Необроблена помилка:', error.message);
});

// Запуск
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Помилка виконання:', error.message);
    process.exit(1);
  });
}
