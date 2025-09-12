#!/usr/bin/env node
/**
 * GitHub Models Proxy - Адаптер між client-module та ATLAS оркестратором
 * Запускається на порту 3010 і переадресовує OpenAI API запити до ATLAS
 */

import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';

// Load env
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PROXY_PORT || process.env.PORT || '3010', 10);
// Target OpenAI-compatible API (58 models) running locally but outside this repo
// e.g., http://localhost:4000/v1
const TARGET_API_BASE = (
    process.env.TARGET_API_BASE ||
    (process.env.PROXY_UPSTREAM ? `${process.env.PROXY_UPSTREAM.replace(/\/$/, '')}/v1` : '') ||
    process.env.GITHUB_MODELS_BASE_URL ||
    'http://localhost:4000/v1'
).replace(/\/$/, '');

// Middleware
app.use(cors());
app.use(express.json());

// Логування всіх запитів
app.use((req, res, next) => {
    // Avoid logging huge bodies
    const preview = (() => {
        try {
            const s = JSON.stringify(req.body);
            return s && s.length > 1000 ? s.slice(0, 1000) + '…' : s;
        } catch (_) { return ''; }
    })();
    console.log(`[PROXY] ${req.method} ${req.path} body=${preview || 'n/a'}`);
    next();
});

/**
 * OpenAI-сумісний endpoint для chat completions
 * Переадресовує безпосередньо до локального API (порт 4000)
 */
app.post('/v1/chat/completions', async (req, res) => {
    try {
        // Pass-through to upstream OpenAI-compatible API
        const url = `${TARGET_API_BASE}/chat/completions`;
        const headers = {
            'Content-Type': 'application/json',
            // Pass through Authorization if provided; else use env
            ...(req.headers['authorization'] ? { Authorization: req.headers['authorization'] } : {}),
            ...(process.env.TARGET_API_KEY ? { Authorization: `Bearer ${process.env.TARGET_API_KEY}` } : {})
        };

        const upstream = await axios.post(url, req.body, { timeout: 60000, headers });
        res.status(upstream.status).json(upstream.data);
    } catch (error) {
        const status = error.response?.status || 500;
        const data = error.response?.data || { message: error.message };
        console.error(`[PROXY] /v1/chat/completions error status=${status}:`, data);
        res.status(status).json({ error: { message: data.message || 'Upstream error', type: 'upstream_error', data } });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        proxy: 'GitHub Models Proxy',
        target: TARGET_API_BASE,
        timestamp: new Date().toISOString()
    });
});

/**
 * Models list endpoint (сумісний з OpenAI API)
 */
app.get('/v1/models', async (req, res) => {
    try {
        // Try upstream first
        const url = `${TARGET_API_BASE}/models`;
        const headers = {
            ...(req.headers['authorization'] ? { Authorization: req.headers['authorization'] } : {}),
            ...(process.env.TARGET_API_KEY ? { Authorization: `Bearer ${process.env.TARGET_API_KEY}` } : {})
        };
        const upstream = await axios.get(url, { timeout: 10000, headers });
        res.status(upstream.status).json(upstream.data);
    } catch (error) {
        console.warn(`[PROXY] Upstream models failed, returning minimal static list: ${error.message}`);
        res.json({
            object: 'list',
            data: [
                { id: 'openai/gpt-4o-mini', object: 'model', created: 1692901427, owned_by: 'openai' }
            ]
        });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 GitHub Models Proxy запущено на порту ${PORT}`);
    console.log(`🎯 Переадресовує до API: ${TARGET_API_BASE}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📋 Models: http://localhost:${PORT}/v1/models`);
    console.log(`💬 Chat: POST http://localhost:${PORT}/v1/chat/completions`);
});

export default app;
