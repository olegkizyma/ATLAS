import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import WebSocket from 'ws';

dotenv.config({ path: path.resolve(process.cwd(), '../config/.env') });
dotenv.config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Secret-Key'] }));
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
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
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

  // 1.5) Уточнення будуть виникати природно під час виконання Тетяни (без штучної інʼєкції тут)

    // 2) Grisha checks
  sseSend(res, { type: 'info', agent: 'Grisha', content: 'Перевіряю політики…' });
    const grishaOut = await callGrisha(atlasOut.task_spec, sessionId);
  sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `isSafe=${grishaOut.isSafe}. ${grishaOut.rationale ? grishaOut.rationale : ''}` });

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
  const instruction = `Відповідай українською. Спочатку коротко відповідай користувачу (user_reply). Потім побудуй task_spec у JSON відповідно до схеми: ${JSON.stringify(format)}. Виведи рівно один JSON-блок після користувацької відповіді. Не використовуй кодові блоки (три зворотні апострофи), не додавай префікси типу \"user_reply:\" у текст відповіді.`;

  if (!GEMINI_API_KEY) {
    throw new Error('Atlas (Gemini) API key not configured');
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
  const userReplyRaw = taskSpec ? text.replace(jsonMatch[0], '').trim() : text;
  const userReply = cleanUserReply(userReplyRaw);

    return {
      user_reply: userReply || 'Готово.',
      task_spec: taskSpec || {
        title: 'Задача', summary: userMessage, inputs: [userMessage], steps: [], constraints: [], success_criteria: [], tool_hints: {}
      }
    };
  } catch (e) {
    console.warn('Gemini call failed:', e.message);
    throw new Error('Atlas недоступний: ' + (e.message || 'невідома помилка'));
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
  // Test mode allow all (без хардкодного повідомлення)
  return { isSafe: true, rationale: '', flagged: [] };
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
  let out = { isSafe: true, rationale: '', flagged: [] };
    try { out = JSON.parse(text); } catch {}
    if (typeof out.isSafe !== 'boolean') out.isSafe = true;
    return out;
  } catch (e) {
  console.warn('Mistral call failed, allowing in test mode:', e.message);
  return { isSafe: true, rationale: '', flagged: [] };
  }
}

// Tetiana (Goose) streaming execution
async function streamTetiana(taskSpec, sessionId, res) {
  const secret = process.env.GOOSE_SECRET_KEY;

  // Автовизначення режиму Goose: web (ws) чи goosed (/reply)
  const gooseBase = GOOSE_BASE_URL.replace(/\/$/, '');
  const isWeb = await isGooseWeb(gooseBase);

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

  if (isWeb) {
    // Потік через WebSocket /ws з авто-відповідями Атласа на уточнення (безкінечний цикл до завершення сесії)
    return streamTetianaWs(gooseBase, payload, res, sessionId);
  } else {
    // Потік через goosed /reply (SSE)
    const url = `${gooseBase}/reply`;
    const response = await axios.post(url, payload, {
      headers,
      responseType: 'stream',
      timeout: 0
    });

    return new Promise((resolve, reject) => {
      const answeredQuestions = new Set();
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
            const obj = JSON.parse(dataLine);
            if (obj.type === 'Finish') {
              resolve();
              return;
            }
            const msg = obj.message;
            if (msg && Array.isArray(msg.content)) {
              for (const c of msg.content) {
                if (c.type === 'text' && c.text) {
                  sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: c.text });
                  // Постійний цикл: визначити чи це уточнення; якщо так — авто-відповідь Атласа
                  maybeAutoAnswerFromAtlasText(c.text, answeredQuestions, sessionId, res, gooseBase, secret, null).catch(() => {});
                }
                if (c.type === 'frontendToolRequest' || c.type === 'question') {
                  // Автовідповідь Атласа: формуємо коротку відповідь без залучення користувача
                  autoAnswerFromAtlas(c, sessionId, res, gooseBase, secret).catch(() => {});
                }
              }
            }
          } catch (_) {
            // ignore non-JSON lines
          }
        }
      });
      response.data.on('end', () => resolve());
      response.data.on('error', (err) => reject(err));
    });
  }
}

// Перевірка: чи це Goose Web
async function isGooseWeb(baseUrl) {
  try {
    const { status } = await axios.get(`${baseUrl}/api/health`, { timeout: 2000 });
    return status === 200;
  } catch {
    return false;
  }
}

// Стрім Тетяни через WebSocket інтерфейс Goose Web
function streamTetianaWs(baseUrl, chatPayload, res, sessionId) {
  return new Promise((resolve, reject) => {
    const wsUrl = baseUrl.replace(/^http/i, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    let settled = false;
  const answeredQuestions = new Set();

    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      if (err) reject(err); else resolve();
    };

    ws.on('open', () => {
      const payload = {
        type: 'message',
        content: chatPayload.messages?.[0]?.content?.[0]?.text || '',
        session_id: chatPayload.session_id,
        timestamp: Date.now()
      };
      ws.send(JSON.stringify(payload));
    });

    ws.on('message', (data) => {
      try {
        const obj = JSON.parse(data.toString());
        const t = obj.type;
        if (t === 'response') {
          const content = obj.content;
          if (content) {
            sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: String(content) });
            maybeAutoAnswerFromAtlasText(String(content), answeredQuestions, sessionId, res, baseUrl, null, ws).catch(() => {});
          }
        } else if (t === 'question' || t === 'frontendToolRequest') {
          // Автовідповідь Атласа на уточнення, без залучення користувача
          autoAnswerFromAtlas(obj, sessionId, res, baseUrl, null, ws).catch(() => {});
        } else if (t === 'complete' || t === 'cancelled') {
          finish();
        } else if (t === 'error') {
          finish(new Error(obj.message || 'websocket error'));
        }
      } catch (e) {
        // ignore non-JSON frames
      }
    });

    ws.on('error', (err) => finish(err));
    ws.on('close', () => finish());
  });
}

// Нормалізація відповіді Atlas: прибрати code fences та префікси
function cleanUserReply(text) {
  if (!text) return '';
  let out = String(text);
  // видалити трійні бектіки з будь-яким вмістом
  out = out.replace(/```[\s\S]*?```/g, '').trim();
  // прибрати префікс user_reply: (у різних регістрах/мовах)
  out = out.replace(/^\s*(user[_\s-]?reply\s*:\s*)/i, '');
  // прибрати зайві лапки навколо
  out = out.replace(/^"(.+)"$/s, '$1');
  return out.trim();
}

// Автовідповідь Атласа на уточнення Тетяни
async function autoAnswerFromAtlas(requestObjOrContent, sessionId, res, gooseBase, secret, wsOpt) {
  try {
    // Витягаємо текст питання
    let questionText = '';
    if (typeof requestObjOrContent === 'string') {
      questionText = requestObjOrContent;
    } else if (requestObjOrContent?.content) {
      // Goose Web event shape
      questionText = String(requestObjOrContent.content || '');
    } else if (requestObjOrContent?.text) {
      // frontendToolRequest content
      questionText = String(requestObjOrContent.text || '');
    }
    if (!questionText.trim()) return;

    // Спитати Атласа коротку конкретну відповідь
    const atlasAns = await callAtlas(`Коротко і по суті відповідай на уточнююче питання від Тетяни: ${questionText}`, sessionId);
    const reply = atlasAns.user_reply?.trim();
    if (!reply) return;

    // Відправити відповідь назад у Goose, щоб продовжити сесію
    if (wsOpt) {
      // Через WebSocket
      wsOpt.send(JSON.stringify({ type: 'message', content: reply, session_id: sessionId || `sess-${Date.now()}`, timestamp: Date.now() }));
    } else {
      // Через /reply
      const url = `${gooseBase.replace(/\/$/, '')}/reply`;
      const headers = { Accept: 'text/event-stream', 'Content-Type': 'application/json' };
      if (secret) headers['X-Secret-Key'] = secret;
      const payload = {
        messages: [ { role: 'user', created: Math.floor(Date.now()/1000), content: [ { type: 'text', text: reply } ] } ],
        session_id: sessionId || `sess-${Date.now()}`,
        session_working_dir: process.cwd()
      };
      // Ждем ответ потока, но не проксируем его напрямую (ответ пойдет в основном стриме)
      axios.post(url, payload, { headers, responseType: 'stream', timeout: 120000 }).catch(() => {});
    }

    // Показать в UI, что Атлас відповів на уточнення (для прозрачности)
    sseSend(res, { type: 'agent_message', agent: 'Atlas', content: reply });
  } catch (_) {
    // тихо игнорируем сбои авто-відповіді
  }
}

// Визначаємо, чи текст є уточнюючим питанням до користувача/Атласа; якщо так — авто-відповідь Атласа.
async function maybeAutoAnswerFromAtlasText(text, answeredSet, sessionId, res, gooseBase, secret, wsOpt) {
  try {
    const snippet = String(text || '').trim();
    if (!snippet || snippet.length < 3) return;
    // Антидедупликація
    const key = snippet.toLowerCase().slice(0, 160);
    if (answeredSet.has(key)) return;

    // Класификация через Atlas: вопрос-уточнение или просто ответ
    const classificationPrompt = `Визнач: чи є цей текст уточнюючим питанням (yes/no): "${snippet}". Виведи лише yes або no.`;
    const ans = await callAtlas(classificationPrompt, sessionId);
    const verdict = (ans.user_reply || '').trim().toLowerCase();
    if (verdict.startsWith('yes')) {
      answeredSet.add(key);
      await autoAnswerFromAtlas(snippet, sessionId, res, gooseBase, secret, wsOpt);
    }
  } catch {}
}

app.listen(ORCH_PORT, () => {
  console.log(`Orchestrator running on http://127.0.0.1:${ORCH_PORT}`);
});
