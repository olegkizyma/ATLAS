#!/usr/bin/env node
/**
 * Отримання повного списку моделей та створення models.json
 */

async function getAllModels() {
    try {
        const response = await fetch('http://localhost:3010/v1/models');
        const data = await response.json();
        
        // Групуємо моделі по провайдерах
        const modelsByProvider = {};
        
        data.data.forEach(model => {
            const provider = model.id.split('/')[0];
            if (!modelsByProvider[provider]) {
                modelsByProvider[provider] = [];
            }
            modelsByProvider[provider].push({
                id: model.id,
                object: model.object,
                created: model.created,
                owned_by: model.owned_by
            });
        });
        
        console.log('📊 Моделі по провайдерах:');
        console.log('=' * 50);
        
        Object.keys(modelsByProvider).forEach(provider => {
            console.log(`\n${provider.toUpperCase()} (${modelsByProvider[provider].length} моделей):`);
            modelsByProvider[provider].forEach(model => {
                console.log(`  - ${model.id}`);
            });
        });
        
        // Створюємо JSON структуру для client-module
        const clientModels = {
            "models": data.data.map(model => ({
                "id": model.id,
                "provider": model.id.split('/')[0],
                "type": model.id.includes('embed') ? 'embedding' : 'chat'
            })),
            "providers": Object.keys(modelsByProvider),
            "total_models": data.data.length,
            "last_updated": new Date().toISOString()
        };
        
        console.log('\n📄 JSON для client-module:');
        console.log('=' * 50);
        console.log(JSON.stringify(clientModels, null, 2));
        
        return clientModels;
        
    } catch (error) {
        console.error('❌ Помилка:', error.message);
    }
}

getAllModels();
