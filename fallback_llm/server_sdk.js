#!/usr/bin/env node
/*
 Enhanced OpenAI-compatible fallback server for ATLAS with OpenAI SDK integration.
 Provides /v1/models and /v1/chat/completions with streaming support.
 Uses OpenAI SDK for better error handling and connection management.
*/

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const PORT = process.env.FALLBACK_PORT || 3010;
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Token budget controls
const MAX_INPUT_TOKENS = parseInt(process.env.FALLBACK_MAX_INPUT_TOKENS || '8000', 10);
const TRUNCATE_STRATEGY = String(process.env.FALLBACK_TRUNCATE_STRATEGY || 'clip').toLowerCase(); // 'clip' | 'reject'

// Model registry
const MODELS = (
  process.env.FALLBACK_MODELS?.split(',').map(s => s.trim()).filter(Boolean)
) || [
  // OpenAI models (most common)
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'openai/o1',
  'openai/o1-mini',
  'openai/o1-preview',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  
  // Microsoft models
  'microsoft/mai-ds-r1',
  'microsoft/phi-3-medium-128k-instruct',
  'microsoft/phi-3-medium-4k-instruct',
  'microsoft/phi-3-mini-128k-instruct',
  'microsoft/phi-3-mini-4k-instruct',
  'microsoft/phi-3-small-128k-instruct',
  'microsoft/phi-3-small-8k-instruct',
  'microsoft/phi-3.5-mini-instruct',
  'microsoft/phi-3.5-moe-instruct',
  'microsoft/phi-3.5-vision-instruct',
  'microsoft/phi-4',
  'microsoft/phi-4-mini-instruct',
  'microsoft/phi-4-mini-reasoning',
  'microsoft/phi-4-multimodal-instruct',
  'microsoft/phi-4-reasoning',
  
  // Meta Llama models
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-4-maverick-17b-128e-instruct-fp8',
  'meta/llama-4-scout-17b-16e-instruct',
  'meta/meta-llama-3.1-405b-instruct',
  'meta/meta-llama-3.1-8b-instruct',
  
  // Mistral AI models
  'mistral-ai/codestral-2501',
  'mistral-ai/ministral-3b',
  'mistral-ai/mistral-large-2411',
  'mistral-ai/mistral-medium-2505',
  'mistral-ai/mistral-nemo',
  'mistral-ai/mistral-small-2503',
  
  // AI21 Labs models
  'ai21-labs/ai21-jamba-1.5-large',
  'ai21-labs/ai21-jamba-1.5-mini',
  
  // DeepSeek models
  'deepseek/deepseek-r1',
  'deepseek/deepseek-r1-0528',
  'deepseek/deepseek-v3-0324',
  
  // Cohere models
  'cohere/cohere-command-a',
  'cohere/cohere-command-r-08-2024',
  'cohere/cohere-command-r-plus-08-2024',
  'cohere/cohere-embed-v3-english',
  'cohere/cohere-embed-v3-multilingual',
  
  // Core42 models
  'core42/jais-30b-chat',
  
  // xAI models
  'xai/grok-3',
  'xai/grok-3-mini',
  
  // OpenAI embeddings
  'openai/text-embedding-3-large',
  'openai/text-embedding-3-small',
  
  // Newer OpenAI models (might not be available everywhere)
  'openai/gpt-5',
  'openai/gpt-5-chat', 
  'openai/gpt-5-mini',
  'openai/gpt-5-nano'
];

// OpenAI SDK клієнт для проксування до справжніх провайдерів (опціонально)
const upstreamClient = process.env.UPSTREAM_API_KEY ? new OpenAI({
  apiKey: process.env.UPSTREAM_API_KEY,
  baseURL: process.env.UPSTREAM_BASE_URL || 'https://api.openai.com/v1',
  timeout: 30000
}) : null;

// Health
app.get('/health', (_, res) => res.json({ 
  ok: true, 
  time: Date.now(), 
  models: MODELS.length,
  upstream: !!upstreamClient 
}));

// OpenAI models endpoint
app.get('/v1/models', (_, res) => {
  res.json({ 
    object: 'list', 
    data: MODELS.map(m => ({ 
      id: m, 
      object: 'model', 
      created: Date.now(), 
      owned_by: 'atlas-fallback' 
    })) 
  });
});

// OpenAI chat completions (with and without streaming)
app.post('/v1/chat/completions', async (req, res) => {
  const { model, messages, max_tokens = 400, temperature = 0.7, stream = false } = req.body || {};
  
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ 
      error: { 
        message: 'messages required', 
        type: 'invalid_request_error' 
      } 
    });
  }

  // Перевіримо чи модель доступна
  if (model && !MODELS.includes(model)) {
    return res.status(404).json({
      error: {
        message: `Model ${model} not found`,
        type: 'invalid_request_error',
        param: 'model',
        code: 'model_not_found'
      }
    });
  }

  // Оцінка використання токенів
  const estimateTokens = (msgs) => {
    try {
      let totalChars = 0;
      for (const m of msgs) {
        const c = typeof m?.content === 'string'
          ? m.content
          : Array.isArray(m?.content)
            ? m.content.map(x => (typeof x?.text === 'string' ? x.text : '')).join(' ')
            : '';
        totalChars += (c || '').length;
      }
      return Math.ceil(totalChars / 4);
    } catch {
      return 0;
    }
  };

  const truncateToBudget = (msgs, budgetTokens) => {
    const lastUser = [...msgs].reverse().find(m => m.role === 'user') || msgs[msgs.length - 1];
    const str = typeof lastUser?.content === 'string'
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map(x => (typeof x?.text === 'string' ? x.text : '')).join(' ')
        : '';
    const maxChars = Math.max(0, budgetTokens * 4);
    const clipped = str.length > maxChars ? (str.slice(0, maxChars) + '…') : str;
    return [{ role: 'user', content: clipped }];
  };

  const promptTokens = estimateTokens(messages);
  let effectiveMessages = messages;
  let atlas_truncated = false;
  
  if (promptTokens > MAX_INPUT_TOKENS) {
    if (TRUNCATE_STRATEGY === 'reject') {
      return res.status(413).json({
        error: { 
          message: 'tokens_limit_reached', 
          type: 'tokens_limit_reached', 
          limit: MAX_INPUT_TOKENS, 
          prompt_tokens: promptTokens 
        }
      });
    } else {
      effectiveMessages = truncateToBudget(messages, MAX_INPUT_TOKENS);
      atlas_truncated = true;
    }
  }

  try {
    // Спочатку спробуємо проксувати до справжнього провайдера, якщо налаштовано
    if (upstreamClient && Math.random() > 0.3) { // 70% шанс використати справжній провайдер
      try {
        const upstreamResponse = await upstreamClient.chat.completions.create({
          model: model || 'gpt-4o-mini',
          messages: effectiveMessages,
          max_tokens,
          temperature,
          stream
        });

        if (stream) {
          // Проксування streaming відповіді
          res.status(200);
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          
          for await (const chunk of upstreamResponse) {
            const data = JSON.stringify(chunk);
            res.write(`data: ${data}\n\n`);
          }
          
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } else {
          // Не-streaming відповідь
          return res.json({
            ...upstreamResponse,
            atlas_truncated,
            atlas_source: 'upstream'
          });
        }
      } catch (upstreamError) {
        console.warn('[FALLBACK] Upstream failed, falling back to local generation:', upstreamError.message);
        // Падаємо до локальної генерації
      }
    }

    // Локальна генерація (fallback)
    const userMsg = effectiveMessages.slice().reverse().find(m => m.role === 'user')?.content || '';
    const reply = generateReply(userMsg, model);

    if (stream) {
      // SSE streaming headers
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const id = 'chatcmpl_' + Date.now();
      const created = Math.floor(Date.now()/1000);
      const chosenModel = model || MODELS[0];

      const writeEvent = (payload) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // Initial chunk with role
      writeEvent({
        id,
        object: 'chat.completion.chunk',
        created,
        model: chosenModel,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
      });

      // Stream content in chunks
      const chunkSize = 48;
      for (let i = 0; i < reply.length; i += chunkSize) {
        const piece = reply.slice(i, i + chunkSize);
        writeEvent({
          id,
          object: 'chat.completion.chunk',
          created,
          model: chosenModel,
          choices: [{ index: 0, delta: { content: piece }, finish_reason: null }]
        });
        // Невелика затримка для реалістичності
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Final chunk
      writeEvent({
        id,
        object: 'chat.completion.chunk',
        created,
        model: chosenModel,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      });

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Regular completion response
    return res.json({
      id: 'chatcmpl_' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now()/1000),
      model: model || MODELS[0],
      choices: [{
        index: 0,
        message: { role: 'assistant', content: reply },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: atlas_truncated ? MAX_INPUT_TOKENS : promptTokens,
        completion_tokens: Math.ceil(reply.length / 4),
        total_tokens: (atlas_truncated ? MAX_INPUT_TOKENS : promptTokens) + Math.ceil(reply.length / 4)
      },
      atlas_truncated,
      atlas_source: 'local'
    });

  } catch (error) {
    console.error('[FALLBACK] Error:', error);
    return res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Покращена функція генерації відповідей
function generateReply(user, model) {
  const u = String(user || '').trim();
  if (!u) return 'Я тут. Чим допомогти?';
  
  // Інтелектуальніші відповіді на основі моделі
  const modelLower = (model || '').toLowerCase();
  
  if (/привіт|вітаю|hello|hi/i.test(u)) {
    return `Привіт! Я ${model || 'ATLAS fallback'}. Чим допомогти?`;
  }
  
  if (/як.*зват|хто ти|your name/i.test(u)) {
    return `Я локальний fallback сервер ATLAS, використовую модель ${model || 'local'}. Можете продовжити питання.`;
  }
  
  if (/програм|код|function|python|javascript/i.test(u)) {
    return `Звичайно, можу допомогти з програмуванням! Ваше питання: "${u.slice(0, 100)}${u.length > 100 ? '...' : ''}". Надайте більше деталей для кращої відповіді.`;
  }
  
  if (/аналіз|дослідж|проаналізу/i.test(u)) {
    return `Готовий провести аналіз. Запит: "${u.slice(0, 100)}${u.length > 100 ? '...' : ''}". Потрібні додаткові дані або специфікації?`;
  }
  
  // Загальна відповідь з відлунням
  const maxLen = 600;
  const echo = u.length > maxLen ? u.slice(0, maxLen) + '…' : u;
  
  return `Обробляю ваш запит через ${model || 'fallback'}:\n\n"${echo}"\n\nДля кращої відповіді підключіться до повноцінного LLM провайдера.`;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[FALLBACK] Shutting down gracefully...');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`[FALLBACK] Server listening on http://localhost:${PORT}`);
  console.log(`[FALLBACK] Models available: ${MODELS.length}`);
  console.log(`[FALLBACK] Upstream configured: ${!!upstreamClient}`);
});
