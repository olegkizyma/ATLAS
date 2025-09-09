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
            agent: 'atlas',
            message: userMessage,
            model: model // Передаємо модель, яку запросив клієнт
        };
        
        console.log(`[PROXY] Відправляємо до ATLAS:`, atlasRequest);
        
        // Викликаємо ATLAS
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
        
        console.log(`[PROXY] Відповідь від ATLAS:`, atlasResponse.data);
        
        // Перетворюємо відповідь ATLAS в OpenAI формат
        const openaiResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: atlasResponse.data.response || atlasResponse.data.message || 'Немає відповіді'
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: Math.ceil(userMessage.length / 4),
                completion_tokens: Math.ceil((atlasResponse.data.response || '').length / 4),
                total_tokens: Math.ceil((userMessage + (atlasResponse.data.response || '')).length / 4)
            }
        };
        
        console.log(`[PROXY] Відправляємо клієнту:`, openaiResponse);
        res.json(openaiResponse);
        
    } catch (error) {
        console.error(`[PROXY] Помилка:`, error.message);
        
        // Детальна інформація про помилку
        if (error.response) {
            console.error(`[PROXY] Статус:`, error.response.status);
            console.error(`[PROXY] Дані:`, error.response.data);
        }
        
        res.status(500).json({
            error: {
                message: error.message,
                type: 'internal_server_error'
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
        proxy: 'GitHub Models Proxy',
        atlas_target: ATLAS_ORCHESTRATOR_URL,
        timestamp: new Date().toISOString()
    });
});

/**
 * Models list endpoint (сумісний з OpenAI API)
 */
app.get('/v1/models', async (req, res) => {
    try {
        // Можемо отримати список моделей від ATLAS або повернути статичний
        const models = [
            {
                id: 'microsoft/phi-3-mini-4k-instruct',
                object: 'model',
                created: 1692901427,
                owned_by: 'microsoft'
            },
            {
                id: 'mistral-ai/mistral-small-2503',
                object: 'model',
                created: 1692901427,
                owned_by: 'mistral-ai'
            },
            {
                id: 'openai/gpt-4o-mini',
                object: 'model',
                created: 1692901427,
                owned_by: 'openai'
            }
        ];
        
        res.json({
            object: 'list',
            data: models
        });
    } catch (error) {
        console.error(`[PROXY] Помилка отримання моделей:`, error.message);
        res.status(500).json({
            error: {
                message: error.message,
                type: 'internal_server_error'
            }
        });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 GitHub Models Proxy запущено на порту ${PORT}`);
    console.log(`🎯 Переадресовує до ATLAS: ${ATLAS_ORCHESTRATOR_URL}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📋 Models: http://localhost:${PORT}/v1/models`);
    console.log(`💬 Chat: POST http://localhost:${PORT}/v1/chat/completions`);
});

export default app;
