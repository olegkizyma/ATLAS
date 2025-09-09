#!/usr/bin/env node
/**
 * GitHub Models Proxy - Адаптер між client-module та ATLAS оркестратором
 * Запускається на порту 3010 і переадресовує OpenAI API запити до ATLAS
 */

import express from 'express';
import axios from 'axios';
import cors from 'cors';

const app = express();
const PORT = 3010;
const ATLAS_ORCHESTRATOR_URL = 'http://localhost:5101';

// Middleware
app.use(cors());
app.use(express.json());

// Логування всіх запитів
app.use((req, res, next) => {
    console.log(`[PROXY] ${req.method} ${req.path} - ${JSON.stringify(req.body, null, 2)}`);
    next();
});

/**
 * OpenAI-сумісний endpoint для chat completions
 * Переадресовує до ATLAS /test/model_rotation
 */
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { model, messages, max_tokens, temperature, ...otherParams } = req.body;
        
        console.log(`[PROXY] Запит до моделі: ${model}`);
        console.log(`[PROXY] Повідомлення:`, messages);
        
        // Витягуємо користувацьке повідомлення (останнє user message)
        const userMessage = messages
            .filter(msg => msg.role === 'user')
            .pop()?.content || '';
        
        if (!userMessage) {
            return res.status(400).json({
                error: {
                    message: 'No user message found',
                    type: 'invalid_request_error'
                }
            });
        }
        
        // Формуємо запит до ATLAS
        const atlasRequest = {
            agent: 'atlas',  // Використовуємо atlas як агента за замовчуванням
            message: userMessage,
            model: model,  // Передаємо модель
            max_tokens: max_tokens,
            temperature: temperature
        };
        
        console.log(`[PROXY] Запит до ATLAS:`, atlasRequest);
        
        // Робимо запит до ATLAS оркестратора
        const atlasResponse = await axios.post(
            `${ATLAS_ORCHESTRATOR_URL}/test/model_rotation`,
            atlasRequest,
            {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log(`[PROXY] Відповідь ATLAS:`, atlasResponse.data);
        
        // Перетворюємо відповідь ATLAS в OpenAI формат
        const openaiResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: atlasResponse.data.model || model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: atlasResponse.data.content || atlasResponse.data.response || 'Немає відповіді'
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: Math.ceil(userMessage.length / 4),
                completion_tokens: Math.ceil((atlasResponse.data.content || '').length / 4),
                total_tokens: Math.ceil((userMessage + (atlasResponse.data.content || '')).length / 4)
            }
        };
        
        console.log(`[PROXY] OpenAI відповідь:`, openaiResponse);
        
        res.json(openaiResponse);
        
    } catch (error) {
        console.error(`[PROXY] Помилка:`, error.message);
        
        // Повертаємо помилку в OpenAI форматі
        res.status(500).json({
            error: {
                message: error.message,
                type: 'server_error',
                code: error.response?.status || 500
            }
        });
    }
});

/**
 * Endpoint для перевірки доступних моделей
 */
app.get('/v1/models', async (req, res) => {
    // Повертаємо список моделей з models.json
    try {
        const modelsResponse = {
            object: 'list',
            data: [
                {
                    id: 'microsoft/phi-3-mini-4k-instruct',
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'microsoft'
                },
                {
                    id: 'openai/gpt-4o-mini',
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'openai'
                }
                // Додайте інші моделі з models.json за потребою
            ]
        };
        
        res.json(modelsResponse);
    } catch (error) {
        res.status(500).json({
            error: {
                message: error.message,
                type: 'server_error'
            }
        });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'github-models-proxy',
        atlas_target: ATLAS_ORCHESTRATOR_URL
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 GitHub Models Proxy запущено на порту ${PORT}`);
    console.log(`📡 Переадресовує запити до ATLAS: ${ATLAS_ORCHESTRATOR_URL}`);
    console.log(`🔗 OpenAI API endpoint: http://localhost:${PORT}/v1/chat/completions`);
    console.log(`📋 Models endpoint: http://localhost:${PORT}/v1/models`);
    console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});

export default app;
