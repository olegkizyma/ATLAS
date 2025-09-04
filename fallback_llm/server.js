#!/usr/bin/env node
/*
 Simple OpenAI-compatible fallback server for ATLAS.
 Provides minimal /v1/models and /v1/chat/completions without streaming.
 Uses a pluggable local model registry with rule-based responses if no backend.
*/

import express from 'express';
import cors from 'cors';

const PORT = process.env.FALLBACK_PORT || 3010;
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Token budget controls
const MAX_INPUT_TOKENS = parseInt(process.env.FALLBACK_MAX_INPUT_TOKENS || '8000', 10);
const TRUNCATE_STRATEGY = String(process.env.FALLBACK_TRUNCATE_STRATEGY || 'clip').toLowerCase(); // 'clip' | 'reject'

// Model registry. You can wire this to a local backend later.
const MODELS = (
  process.env.FALLBACK_MODELS?.split(',').map(s => s.trim()).filter(Boolean)
) || [
  'gpt-4o-mini',
  'openai/gpt-4o-mini',
  'microsoft/Phi-3.5-mini-instruct',
  'microsoft/Phi-3-mini-4k-instruct',
  'Meta-Llama-3.1-8B-Instruct',
  'Mistral-Nemo'
];

// Health
app.get('/health', (_, res) => res.json({ ok: true, time: Date.now() }));

// OpenAI models
app.get('/v1/models', (_, res) => {
  res.json({ object: 'list', data: MODELS.map(m => ({ id: m, object: 'model', created: Date.now(), owned_by: 'atlas-fallback' })) });
});

// OpenAI chat completions (no streaming)
app.post('/v1/chat/completions', (req, res) => {
  const { model, messages, max_tokens = 400, temperature = 0.7 } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages required', type: 'invalid_request_error' } });
  }
  const stream = req.body?.stream;
  // streaming now supported (SSE style like OpenAI)
  // Estimate token usage (approximate: 1 token ~= 4 chars)
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
        error: { message: 'tokens_limit_reached', type: 'tokens_limit_reached', limit: MAX_INPUT_TOKENS, prompt_tokens: promptTokens }
      });
    } else {
      effectiveMessages = truncateToBudget(messages, MAX_INPUT_TOKENS);
      atlas_truncated = true;
    }
  }

  const userMsg = effectiveMessages.slice().reverse().find(m => m.role === 'user')?.content || '';
  const reply = generateReply(userMsg, model);

  if (stream) {
    // SSE headers
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Some proxies require explicit flush of headers
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const id = 'chatcmpl_' + Date.now();
    const created = Math.floor(Date.now()/1000);
    const chosenModel = model || MODELS[0];

    const writeEvent = (payload) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // Initial chunk with role per OpenAI behavior
    writeEvent({
      id,
      object: 'chat.completion.chunk',
      created,
      model: chosenModel,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
    });

    const chunkSize = 48; // ~50 chars per chunk
    for (let i = 0; i < reply.length; i += chunkSize) {
      const piece = reply.slice(i, i + chunkSize);
      writeEvent({
        id,
        object: 'chat.completion.chunk',
        created,
        model: chosenModel,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }]
      });
    }

    // Final chunk signaling stop
    writeEvent({
      id,
      object: 'chat.completion.chunk',
      created,
      model: chosenModel,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    });

    // OpenAI ends with [DONE]
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }

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
      completion_tokens: (reply.length / 4) | 0,
      total_tokens: ((atlas_truncated ? MAX_INPUT_TOKENS : promptTokens) + ((reply.length / 4) | 0))
    },
    atlas_truncated
  });
});

function generateReply(user, model){
  const u = String(user || '').trim();
  if (!u) return 'Я тут. Чим допомогти?';
  if (/привіт|вітаю|hello|hi/i.test(u)) return 'Привіт! Я локальний фолбек. Чим допомогти?';
  if (/як.*зват|хто ти|your name/i.test(u)) return 'Я локальний фолбек ATLAS. Можете продовжити питання.';
  // lightweight echo with safety cap
  const maxLen = 600;
  const echo = u.length > maxLen ? u.slice(0, maxLen) + '…' : u;
  return `Коротко по суті: ${echo}`;
}

app.listen(PORT, () => {
  console.log(`[fallback-llm] listening on http://localhost:${PORT}`);
});
