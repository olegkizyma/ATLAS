import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

dotenv.config({ path: path.resolve(process.cwd(), '../config/.env') });
dotenv.config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '1mb' }));

// Load prompts
const PROMPTS_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'intelligeich.json');
const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8'));

// Ports and external services
const ORCH_PORT = parseInt(process.env.ORCH_PORT || '5101', 10);
const GOOSE_BASE_URL = process.env.GOOSE_BASE_URL || 'http://127.0.0.1:3000';

// Gemini (Atlas)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENERATIVE_LANGUAGE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_URL = (process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

// Mistral (Grisha)
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

// Helper: stream as SSE
function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Health
app.get('/health', (_, res) => {
  res.json({ status: 'ok', services: { goose: GOOSE_BASE_URL }, time: Date.now() });
});

// POST /chat -> orchestrate Atlas -> Grisha -> Tetiana; respond with SSE stream
app.post('/chat/stream', async (req, res) => {
  try {
    const { message, sessionId } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    sseHeaders(res);
    sseSend(res, { type: 'start', agent: 'system', timestamp: Date.now() });

    // 1) Atlas enriches
    sseSend(res, { type: 'info', agent: 'Atlas', content: 'Аналізую запит та збагачую…' });
    const atlasOut = await callAtlas(message, sessionId);
    sseSend(res, { type: 'agent_message', agent: 'Atlas', content: atlasOut.user_reply || '' });

    // 1.5) Optional clarification: Tetiana asks, Atlas answers
    if ((process.env.TETIANA_CLARIFY || '1') === '1') {
      const q = await generateTetianaClarifyingQuestion(atlasOut.task_spec);
      if (q) {
        sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: `Питання для уточнення: ${q}\n` });
        const clarAns = await callAtlas(`Відповідай на уточнююче питання Тетяни коротко і по суті: ${q}`, sessionId);
        sseSend(res, { type: 'agent_message', agent: 'Atlas', content: clarAns.user_reply || 'Відповів.' });
      }
    }

    // 2) Grisha checks
    sseSend(res, { type: 'info', agent: 'Grisha', content: 'Перевіряю політики… (тестовий режим: пропускаю)' });
    const grishaOut = await callGrisha(atlasOut.task_spec, sessionId);
    sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `isSafe=${grishaOut.isSafe}. ${grishaOut.rationale || ''}` });

    if (!grishaOut.isSafe) {
      sseSend(res, { type: 'complete', agent: 'system', content: 'Запит заблоковано політиками' });
      return res.end();
    }

  // 3) Tetiana executes via Goose (SSE passthrough)
  sseSend(res, { type: 'info', agent: 'Tetiana', content: 'Виконую задачу…' });
  await streamTetiana(atlasOut.task_spec, sessionId, res);
  sseSend(res, { type: 'complete', agent: 'system' });
  res.end();
  } catch (err) {
    console.error('orchestrator error', err);
    try {
      sseSend(res, { type: 'error', error: err.message || String(err) });
      res.end();
    } catch {}
  }
});

// Atlas (Gemini) enrichment
async function callAtlas(userMessage, sessionId) {
  const sys = prompts.atlas.system;
  const format = prompts.atlas.output_format;
  const instruction = `Відповідай українською. Спочатку коротко відповідай користувачу (user_reply). Потім побудуй task_spec у JSON відповідно до схеми: ${JSON.stringify(format)}. Виведи рівно один JSON-блок після користувацької відповіді.`;

  if (!GEMINI_API_KEY) {
    // Fallback dummy
    return {
      user_reply: `Прийнято. Уточню деталі і підготую задачу до виконання.`,
      task_spec: {
        title: 'Автогенерована задача',
        summary: userMessage,
        inputs: [userMessage],
        steps: ['Крок 1: Аналіз', 'Крок 2: Виконання'],
        constraints: [],
        success_criteria: ['Отримано результат без помилок'],
        tool_hints: { engine: 'goose' }
      }
    };
  }

  try {
  const url = `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [
        { role: 'user', parts: [{ text: `${sys}\n\n${instruction}\n\nUser: ${userMessage}` }] }
      ]
    };
    const { data } = await axios.post(url, payload, { timeout: 30000 });
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse: first part for user, last JSON block for task
    const jsonMatch = text.match(/\{[\s\S]*\}$/);
    let taskSpec = null;
    if (jsonMatch) {
      try { taskSpec = JSON.parse(jsonMatch[0]); } catch {}
    }
    const userReply = taskSpec ? text.replace(jsonMatch[0], '').trim() : text;

    return {
      user_reply: userReply || 'Готово.',
      task_spec: taskSpec || {
        title: 'Задача', summary: userMessage, inputs: [userMessage], steps: [], constraints: [], success_criteria: [], tool_hints: {}
      }
    };
  } catch (e) {
    console.warn('Gemini call failed, using fallback:', e.message);
    return {
      user_reply: 'Прийнято. Переходжу до виконання.',
      task_spec: {
        title: 'Задача (fallback)', summary: userMessage, inputs: [userMessage], steps: [], constraints: [], success_criteria: [], tool_hints: {}
      }
    };
  }
}

// Create one clarifying question Tetiana might ask
async function generateTetianaClarifyingQuestion(taskSpec) {
  try {
    const base = prompts.atlas.system;
    const ask = `З урахуванням наступної специфікації задачі, згенеруй ОДНЕ коротке ключове уточнююче питання українською (лише питання, без пояснень):\n${JSON.stringify(taskSpec)}`;
    if (!GEMINI_API_KEY) {
      // heuristic fallback: no question
      return '';
    }
  const url = `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [ { role: 'user', parts: [{ text: `${base}\n\n${ask}` }] } ] };
    const { data } = await axios.post(url, payload, { timeout: 20000 });
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return (text || '').trim();
  } catch {
    return '';
  }
}

// Grisha (Mistral) policy check
async function callGrisha(taskSpec, sessionId) {
  const sys = prompts.grisha.system;
  if (!MISTRAL_API_KEY) {
    // Test mode allow all
    return { isSafe: true, rationale: 'TEST_MODE: allow all', flagged: [] };
  }
  try {
    const url = 'https://api.mistral.ai/v1/chat/completions';
    const payload = {
      model: MISTRAL_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `TaskSpec JSON:\n${JSON.stringify(taskSpec)}` }
      ],
      temperature: 0.1
    };
    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` },
      timeout: 25000
    });
    const text = data?.choices?.[0]?.message?.content || '';
    // Try parse JSON
    let out = { isSafe: true, rationale: 'ok', flagged: [] };
    try { out = JSON.parse(text); } catch {}
    if (typeof out.isSafe !== 'boolean') out.isSafe = true;
    return out;
  } catch (e) {
    console.warn('Mistral call failed, allowing in test mode:', e.message);
    return { isSafe: true, rationale: 'API error; fallback allow', flagged: [] };
  }
}

// Tetiana (Goose) streaming execution
async function streamTetiana(taskSpec, sessionId, res) {
  const url = `${GOOSE_BASE_URL.replace(/\/$/, '')}/reply`;
  const secret = process.env.GOOSE_SECRET_KEY;

  const messageText = `Виконай наступну задачу (TaskSpec JSON нижче). Пиши хід роботи та фінальний результат.\nTaskSpec: ${JSON.stringify(taskSpec)}`;
  const payload = {
    messages: [
      {
        role: 'user',
        created: Math.floor(Date.now() / 1000),
        content: [{ type: 'text', text: messageText }]
      }
    ],
    session_id: sessionId || `sess-${Date.now()}`,
    session_working_dir: process.cwd()
  };

  const headers = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json'
  };
  if (secret) headers['X-Secret-Key'] = secret;

  const response = await axios.post(url, payload, {
    headers,
    responseType: 'stream',
    timeout: 0
  });

  return new Promise((resolve, reject) => {
    let buffer = '';
    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        let dataLine = line;
        if (!dataLine) continue;
        if (dataLine.startsWith('data: ')) dataLine = dataLine.slice(6);
        try {
          const payload = JSON.parse(dataLine);
          if (payload.type === 'Finish') {
            // Goose signals completion
            resolve();
            return;
          }
          const msg = payload.message;
          if (msg && Array.isArray(msg.content)) {
            for (const c of msg.content) {
              if (c.type === 'text' && c.text) {
                sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: c.text });
              }
              // Optionally surface tool requests in UI logs
              if (c.type === 'frontendToolRequest') {
                sseSend(res, { type: 'info', agent: 'Tetiana', content: '[Tool request received]' });
              }
            }
          }
        } catch (_) {
          // Ignore parse errors on non-JSON lines
        }
      }
    });
    response.data.on('end', () => resolve());
    response.data.on('error', (err) => reject(err));
  });
}

app.listen(ORCH_PORT, () => {
  console.log(`Orchestrator running on http://127.0.0.1:${ORCH_PORT}`);
});
