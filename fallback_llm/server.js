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
  if (stream) {
    return res.status(400).json({ error: { message: 'streaming not supported', type: 'unsupported' } });
  }

  const userMsg = messages.slice().reverse().find(m => m.role === 'user')?.content || '';
  const reply = generateReply(userMsg, model);

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
    usage: { prompt_tokens: 0, completion_tokens: reply.length / 4 | 0, total_tokens: reply.length / 4 | 0 }
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
