import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import WebSocket from 'ws';
import { execSync } from 'child_process';
import { ContextSummarizer } from './context_summarizer.js';

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
const ORCH_MAX_REFINEMENT_CYCLES = parseInt(process.env.ORCH_MAX_REFINEMENT_CYCLES || '20', 10);
const ORCH_GRISHA_MAX_ATTEMPTS = parseInt(process.env.ORCH_GRISHA_MAX_ATTEMPTS || '20', 10);
const ORCH_ATLAS_MAX_ATTEMPTS = parseInt(process.env.ORCH_ATLAS_MAX_ATTEMPTS || '6', 10);

// Backoff & timeouts (env-tunable)
const ORCH_BACKOFF_BASE_MS = parseInt(process.env.ORCH_BACKOFF_BASE_MS || '400', 10); // стартова затримка ~0.4s
const ORCH_BACKOFF_MAX_MS = parseInt(process.env.ORCH_BACKOFF_MAX_MS || '8000', 10); // верхня межа ~8s
const ORCH_BACKOFF_JITTER_MS = parseInt(process.env.ORCH_BACKOFF_JITTER_MS || '400', 10); // довільний джиттер до 400ms
const ORCH_ATLAS_TIMEOUT_MS = parseInt(process.env.ORCH_ATLAS_TIMEOUT_MS || '45000', 10);
const ORCH_GRISHA_TIMEOUT_MS = parseInt(process.env.ORCH_GRISHA_TIMEOUT_MS || '45000', 10);
// Prompt size guards
const ORCH_MAX_MSPS_CHARS = parseInt(process.env.ORCH_MAX_MSPS_CHARS || '4000', 10);
const ORCH_MAX_TASKSPEC_SUMMARY_CHARS = parseInt(process.env.ORCH_MAX_TASKSPEC_SUMMARY_CHARS || '12000', 10);
const ORCH_MAX_EXEC_REPORT_CHARS = parseInt(process.env.ORCH_MAX_EXEC_REPORT_CHARS || '12000', 10);
const ORCH_MAX_VERIFY_EVIDENCE_CHARS = parseInt(process.env.ORCH_MAX_VERIFY_EVIDENCE_CHARS || '10000', 10);
const ORCH_MAX_MISTRAL_USER_CHARS = parseInt(process.env.ORCH_MAX_MISTRAL_USER_CHARS || '28000', 10);
const ORCH_MAX_MISTRAL_SYSTEM_CHARS = parseInt(process.env.ORCH_MAX_MISTRAL_SYSTEM_CHARS || '4000', 10);
// Feature flags
const ORCH_AUTO_TRUNCATE_ON_TOKEN_LIMIT = String(process.env.ORCH_AUTO_TRUNCATE_ON_TOKEN_LIMIT || 'true') === 'true';
const ORCH_CONTEXT_COMPRESSION_RATIO = parseFloat(process.env.ORCH_CONTEXT_COMPRESSION_RATIO || '0.7');
// Force using goosed /reply (SSE) instead of Goose WebSocket interface
const ORCH_FORCE_GOOSE_REPLY = String(process.env.ORCH_FORCE_GOOSE_REPLY || 'false') === 'true';

// Smart Context Management
const contextSummarizer = new ContextSummarizer(
    parseInt(process.env.ORCH_MAX_CONTEXT_TOKENS || '45000', 10),
    parseFloat(process.env.ORCH_SUMMARY_RATIO || '0.3')
);
console.log('[ATLAS] Smart Context Summarization initialized');

// Gemini (Atlas)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENERATIVE_LANGUAGE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_URL = (process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

// Mistral (Grisha)
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

// Adaptive execution system - cycle-based MSP/tool targeting
const sessionCycleState = new Map(); // sessionId -> { cycleCount, usedTools, usedMSPs, lastState }

function getExecutionMode(sessionId, currentCycle) {
  if (currentCycle === 3) {
    return {
      mode: "msp_specific",
      description: "Обмеження до конкретних MSP серверів"
    };
  } else if (currentCycle === 6) {
    return {
      mode: "tool_specific", 
      description: "Фокус на конкретних інструментах"
    };
  } else {
    return {
      mode: "normal",
      description: "Повний доступ до всіх ресурсів"
    };
  }
}

function updateSessionState(sessionId, cycle, usedTools = [], usedMSPs = []) {
  if (!sessionCycleState.has(sessionId)) {
    sessionCycleState.set(sessionId, { 
      cycleCount: 0, 
      usedTools: new Set(), 
      usedMSPs: new Set(),
      lastState: null
    });
  }
  
  const state = sessionCycleState.get(sessionId);
  state.cycleCount = cycle;
  usedTools.forEach(tool => state.usedTools.add(tool));
  usedMSPs.forEach(msp => state.usedMSPs.add(msp));
  state.lastState = { cycle, timestamp: Date.now() };
  
  return state;
}

// Функція для аналізу виводу та відстеження використаних інструментів та MSP
function analyzeExecutionOutput(output, sessionId) {
  const usedTools = [];
  const usedMSPs = [];
  
  // Аналізуємо використання інструментів (на основі типових патернів Goose)
  const toolPatterns = [
    /use_tool:\s*(\w+)/gi,
    /tool_call:\s*(\w+)/gi,
    /executing\s+(\w+)\s+tool/gi,
    /running\s+(\w+)\s+command/gi,
    /\*\*(\w+)\*\*:\s+/gi, // **tool_name**: pattern
    /`(\w+)`\s+tool/gi,
    /browser_(\w+)/gi,
    /file_(\w+)/gi,
    /terminal_(\w+)/gi,
    /shell_(\w+)/gi
  ];
  
  for (const pattern of toolPatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const tool = match[1];
      if (tool && tool.length > 2 && !usedTools.includes(tool)) {
        usedTools.push(tool);
      }
    }
  }
  
  // Аналізуємо використання MSP (на основі активних з'єднань та запитів)
  const mspPatterns = [
    /using\s+msp:\s*(\w+)/gi,
    /connected\s+to\s+(\w+)/gi,
    /provider:\s*(\w+)/gi,
    /model:\s*(\w+)/gi,
    /endpoint:\s*(\w+)/gi,
    /msp_(\w+)/gi,
    /server:\s*(\w+)/gi
  ];
  
  for (const pattern of mspPatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const msp = match[1];
      if (msp && msp.length > 2 && !usedMSPs.includes(msp)) {
        usedMSPs.push(msp);
      }
    }
  }
  
  // Оновлюємо стан сесії, якщо знайдено використані ресурси
  if (usedTools.length > 0 || usedMSPs.length > 0) {
    const currentState = sessionCycleState.get(sessionId);
    if (currentState) {
      updateSessionState(sessionId, currentState.cycleCount, usedTools, usedMSPs);
    }
  }
  
  return { usedTools, usedMSPs };
}

function getRecommendedResources(sessionId, currentCycle) {
  const state = sessionCycleState.get(sessionId);
  const mode = getExecutionMode(sessionId, currentCycle);
  
  if (mode.mode === "msp_specific" && state) {
    // 3-й цикл: повертаємо найчастіше використовувані MSP
    return {
      msps: Array.from(state.usedMSPs).slice(0, 3), // топ-3 MSP
      reason: "Базуючись на попередньому використанні"
    };
  } else if (mode.mode === "tool_specific" && state) {
    // 6-й цикл: фокус на інструментах із попереднього стану
    return {
      tools: Array.from(state.usedTools).slice(-3), // останні 3 інструменти
      reason: "Завершення на основі останнього стану"
    };
  }
  
  return { reason: "Повний доступ до ресурсів" };
}

// Intent classifier (chat vs task) with Gemini keys rotation
async function classifyIntentSafe(text) {
  const sys = prompts.atlas?.intent_classifier_system || 'Answer one word: task or chat.';
  const keys = [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.GENERATIVE_LANGUAGE_API_KEY].filter(Boolean);
  const payload = { contents: [ { role: 'user', parts: [{ text: `${sys}\n\nТекст: ${text}\nВідповідь: ` }] } ] };
  for (let i = 0; i < keys.length; i++) {
    try {
      const url = `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${keys[i]}`;
      const { data } = await axios.post(url, payload, { timeout: 12000 });
      const out = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').toLowerCase();
      if (out.includes('task')) return 'task';
      if (out.includes('chat')) return 'chat';
    } catch (e) {
      const st = e?.response?.status; if (!(st === 401 || st === 403 || st === 429)) break;
    }
  }
  // Heuristic fallback
  const t = (text || '').toLowerCase();
  const taskHints = ['зроби', 'створи', 'налаштуй', 'запусти', 'перевір', 'згенеруй', 'інстал', 'деплой', 'configure', 'run', 'create', 'build', 'deploy'];
  if (taskHints.some(h => t.includes(h))) return 'task';
  return 'chat';
}

// MSP config (optional)
const MSP_CONFIG_PATH = process.env.MSP_CONFIG_PATH || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../config/msp.json');

function readMspsFromConfig() {
  try {
    if (fs.existsSync(MSP_CONFIG_PATH)) {
      const raw = fs.readFileSync(MSP_CONFIG_PATH, 'utf8');
      const json = JSON.parse(raw);
      const arr = Array.isArray(json?.servers) ? json.servers : Array.isArray(json) ? json : [];
      return arr.filter(x => x && typeof x === 'object');
    }
  } catch (e) {
    console.warn('Failed to read MSP config:', e.message);
  }
  return [];
}

function readMspsFromCommand() {
  try {
  // MCP discovery відключено для Goose 1.7.0 через несумісність API
  // Goose 1.7.0 не підтримує --json параметр для команди mcp
  return [];
  } catch (e) {
    if (process.env.DEBUG) console.warn('MCP command discovery disabled:', e.message);
    return [];
  }
}

async function getAvailableMsps() {
  // Prefer live discovery via command, then config file
  const byCmd = readMspsFromCommand();
  if (byCmd.length) return byCmd;
  return readMspsFromConfig();
}

// --- Helpers: robust JSON parsing and Mistral JSON calls ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// Експоненційний backoff із джиттером
function backoffDelay(attempt) {
  const expo = ORCH_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(ORCH_BACKOFF_MAX_MS, expo);
  const jitter = Math.floor(Math.random() * Math.max(0, ORCH_BACKOFF_JITTER_MS));
  return capped + jitter;
}
function extractJsonBlock(text) {
  if (!text) return null;
  // Try fenced code first
  const fenced = text.match(/```\s*json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    const inner = fenced[1].trim();
    try { return JSON.parse(inner); } catch {}
  }
  // Try last JSON-looking block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    const candidate = match[0];
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

// --- Prompt size helpers ---
function capHead(text, max) {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max));
}
function capTail(text, max) {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return text.slice(Math.max(0, text.length - max));
}

// Estimate token count (approximate: 1 token ≈ 4 characters for most languages)
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// Smart context truncation based on estimated token count
function smartTruncate(system, user, maxTokens = 15000) {
  const systemTokens = estimateTokens(system);
  const userTokens = estimateTokens(user);
  const totalTokens = systemTokens + userTokens;
  
  if (totalTokens <= maxTokens) {
    return { system, user };
  }
  
  console.log(`[SMART_TRUNCATE] Total estimated tokens: ${totalTokens}, target: ${maxTokens}`);
  
  // Preserve more system prompt, truncate user content more aggressively
  const systemTargetTokens = Math.min(systemTokens, Math.floor(maxTokens * 0.3)); // 30% для system
  const userTargetTokens = maxTokens - systemTargetTokens; // Решта для user
  
  const truncatedSystem = systemTokens > systemTargetTokens 
    ? capHead(system, systemTargetTokens * 4) 
    : system;
    
  const truncatedUser = userTokens > userTargetTokens
    ? capTail(user, userTargetTokens * 4)
    : user;
  
  console.log(`[SMART_TRUNCATE] Reduced: system ${systemTokens} -> ${estimateTokens(truncatedSystem)}, user ${userTokens} -> ${estimateTokens(truncatedUser)}`);
  
  return { 
    system: truncatedSystem, 
    user: truncatedUser 
  };
}

// Ensure a text chunk is within safe char bounds; logs when truncation happens
function ensurePromptBounds(text, maxChars, label = 'prompt') {
  if (!text) return '';
  const s = String(text);
  if (!ORCH_AUTO_TRUNCATE_ON_TOKEN_LIMIT) return s;
  if (s.length <= maxChars) return s;
  const truncated = capTail(s, maxChars);
  console.log(`[CONTEXT_LIMIT] ${label} length ${s.length} > ${maxChars}, truncated to ${truncated.length}`);
  return truncated;
}
function summarizeTaskSpec(ts, { maxChars = ORCH_MAX_TASKSPEC_SUMMARY_CHARS, maxArray = 10, maxStr = 500 } = {}) {
  try {
    const pick = (obj) => {
      const out = {};
      if (!obj || typeof obj !== 'object') return out;
      const keys = ['title','summary','inputs','steps','constraints','success_criteria','tool_hints','_msps'];
      for (const k of keys) {
        const v = obj[k];
        if (v == null) continue;
        if (Array.isArray(v)) {
          out[k] = v.slice(0, maxArray).map(x => {
            if (typeof x === 'string') return capHead(x, maxStr);
            if (x && typeof x === 'object') return JSON.parse(capHead(JSON.stringify(x), maxStr));
            return x;
          });
        } else if (typeof v === 'string') {
          out[k] = capHead(v, maxStr);
        } else if (typeof v === 'object') {
          out[k] = JSON.parse(capHead(JSON.stringify(v), maxStr));
        } else {
          out[k] = v;
        }
      }
      return out;
    };
    let out = pick(ts || {});
    let s = JSON.stringify(out);
    if (s.length > maxChars) {
      // fallback: keep only essentials
      out = { title: capHead(String(ts?.title || 'Task'), 200), summary: capHead(String(ts?.summary || ''), 2000), steps: Array.isArray(ts?.steps) ? ts.steps.slice(0, 5) : [], success_criteria: Array.isArray(ts?.success_criteria) ? ts.success_criteria.slice(0, 5) : [] };
      s = JSON.stringify(out).slice(0, maxChars);
      out = JSON.parse(s);
    }
    return out;
  } catch {
    return { title: String(ts?.title || 'Task'), summary: capHead(String(ts?.summary || ''), 1000) };
  }
}

async function mistralChat(system, user, { temperature = 0, timeout = ORCH_GRISHA_TIMEOUT_MS } = {}) {
  const url = 'https://api.mistral.ai/v1/chat/completions';
  const payload = { model: MISTRAL_MODEL, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], temperature };
  const { data } = await axios.post(url, payload, { headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` }, timeout });
  return data?.choices?.[0]?.message?.content || '';
}

async function mistralJsonOnly(system, user, { maxAttempts = ORCH_GRISHA_MAX_ATTEMPTS, temperature = 0, sessionId = null } = {}) {
  let attempts = 0;
  let lastErr = null;
  let sys = system;
  let usr = user;
  
  // Smart Context Management: Apply summarization if context is too large
  if (sessionId && contextSummarizer.shouldSummarize(sys + (typeof usr === 'string' ? usr : JSON.stringify(usr)))) {
    console.log(`[ContextSummarizer] Context too large for session ${sessionId}, optimizing...`);
    const optimizedContext = contextSummarizer.formatForAiPrompt();
    if (optimizedContext) {
      sys = `${system}\n\n${optimizedContext}`;
      console.log(`[ContextSummarizer] Applied optimized context: ${contextSummarizer.getStats().estimatedTokens} estimated tokens`);
    }
  }
  
  // Pre-truncate if context is still too large
  const preCheck = smartTruncate(sys, typeof usr === 'string' ? usr : JSON.stringify(usr), 14000);
  sys = preCheck.system;
  usr = preCheck.user;
  
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
  const sysSafe = capHead(sys, ORCH_MAX_MISTRAL_SYSTEM_CHARS);
  const usrStr = typeof usr === 'string' ? usr : JSON.stringify(usr);
  const usrSafe = capTail(usrStr, ORCH_MAX_MISTRAL_USER_CHARS);
  const text = await mistralChat(sysSafe, usrSafe, { temperature });
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') parsed._attemptsUsed = attempts;
        return parsed;
      } catch (e) {
        const extracted = extractJsonBlock(text);
        if (extracted) {
          if (extracted && typeof extracted === 'object') extracted._attemptsUsed = attempts;
          return extracted;
        }
        lastErr = e;
        // tighten instructions for next attempt
        sys = `${system}\n\nIMPORTANT: Return ONLY valid minified JSON (no markdown, no prose, no comments). If you previously included any non-JSON text, remove it.`;
        // no change to user content to avoid drift
      }
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const msg = e?.response?.data?.error?.message || e?.message || '';
      const tooLong = status === 400 && /model_max_prompt_tokens_exceeded|prompt token count/i.test(msg);
      if (tooLong) {
        console.log(`[CONTEXT_LIMIT] Attempt ${attempts}: Token limit exceeded. Shrinking context...`);
        
        // shrink both system and user payload more aggressively
        const userStr = typeof usr === 'string' ? usr : JSON.stringify(usr);
        const systemStr = typeof sys === 'string' ? sys : JSON.stringify(sys);
        
        // More aggressive shrinking for subsequent attempts
        const shrinkFactor = Math.max(0.3, 0.8 - (attempts * 0.15)); // Більш агресивне стискання з кожною спробою
        const userTarget = Math.max(1000, Math.floor(userStr.length * shrinkFactor));
        const systemTarget = Math.max(1000, Math.floor(systemStr.length * shrinkFactor));
        
        usr = capTail(userStr, Math.min(ORCH_MAX_MISTRAL_USER_CHARS, userTarget));
        sys = capHead(systemStr, Math.min(ORCH_MAX_MISTRAL_SYSTEM_CHARS, systemTarget));
        
        console.log(`[CONTEXT_LIMIT] Reduced user: ${userStr.length} -> ${usr.length}, system: ${systemStr.length} -> ${sys.length}`);
        continue;
      }
      if (status === 429 || (status >= 500 && status < 600)) {
        // експоненційний backoff із джиттером
        await sleep(backoffDelay(attempts));
      }
    }
  }
  throw new Error(`Failed to obtain valid JSON from Mistral after ${maxAttempts} attempts: ${lastErr?.message || 'unknown error'}`);
}

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

// LLM health: light probes (no secrets returned)
app.get('/health/llm', async (_, res) => {
  const out = { atlas: { configured: !!(GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENERATIVE_LANGUAGE_API_KEY), ok: false, status: null }, grisha: { configured: !!MISTRAL_API_KEY, ok: false, status: null } };
  // Atlas probe with key rotation
  const keys = [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.GENERATIVE_LANGUAGE_API_KEY].filter(Boolean);
  for (let i = 0; i < keys.length; i++) {
    try {
      const url = `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${keys[i]}`;
      const payload = { contents: [ { role: 'user', parts: [{ text: 'ping' }] } ] };
      const { status } = await axios.post(url, payload, { timeout: 8000 });
      out.atlas.ok = status >= 200 && status < 300;
      out.atlas.status = status;
      if (out.atlas.ok) break;
    } catch (e) {
      out.atlas.ok = false;
      out.atlas.status = e?.response?.status || 'error';
      // try next key if 401/403/429
      const st = e?.response?.status;
      if (!(st === 401 || st === 403 || st === 429)) break;
    }
  }
  // Grisha probe
  if (MISTRAL_API_KEY) {
    try {
      const url = 'https://api.mistral.ai/v1/chat/completions';
      const payload = { model: MISTRAL_MODEL, messages: [ { role: 'system', content: 'You are a JSON echo. Reply with {"ok":true} only.' }, { role: 'user', content: 'now' } ], temperature: 0 };
      const { status } = await axios.post(url, payload, { headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` }, timeout: 8000 });
      out.grisha.ok = status >= 200 && status < 300;
      out.grisha.status = status;
    } catch (e) {
      out.grisha.ok = false;
      out.grisha.status = e?.response?.status || 'error';
    }
  }
  res.json(out);
});

// List available MSP servers (optional config-powered)
app.get('/api/msp/list', async (_, res) => {
  let servers = readMspsFromCommand();
  let source = 'none';
  if (servers.length) {
    source = 'cmd';
  } else {
    servers = readMspsFromConfig();
    if (servers.length) source = 'config';
  }
  res.json({ servers, source });
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

    // Smart Context Management: Check if we need to process context
    console.log(`[ContextSummarizer] Processing request for session: ${sessionId || 'no-session'}`);
    const contextStats = contextSummarizer.getStats();
    console.log(`[ContextSummarizer] Current context stats:`, contextStats);
    
    if (contextStats.estimatedTokens > 40000) {
      sseSend(res, { type: 'info', agent: 'system', content: 'Оптимізую контекст для кращої продуктивності...' });
    }

  // 1) Atlas enriches
    sseSend(res, { type: 'info', agent: 'Atlas', content: '[ATLAS] Аналізую запит та збагачую…' });
  const msps = await getAvailableMsps();
  let atlasOut;
  try {
    atlasOut = await callAtlas(message, sessionId, { msps });
  } catch (e) {
    // Мʼякий фолбэк: відповідь у чат‑режимі без запуску виконання
    sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] Зараз сервіс планування перевантажений (429). Відповім коротко і без запуску виконання: ' + (message.length > 160 ? message.slice(0,160) + '…' : message) });
    sseSend(res, { type: 'complete', agent: 'system' });
    return res.end();
  }
  sseSend(res, { type: 'agent_message', agent: 'Atlas', content: `[ATLAS] ${atlasOut.user_reply || ''}` });
  if (typeof atlasOut._attemptsUsed === 'number') {
    sseSend(res, { type: 'info', agent: 'Atlas', content: `[ATLAS] Спроб: ${atlasOut._attemptsUsed}/${ORCH_ATLAS_MAX_ATTEMPTS}` });
  }

  // 1.1) Намір користувача: якщо це chat — завершуємо без виконання
  try {
    const intentRaw = String(atlasOut?.task_spec?.intent || '').toLowerCase();
    const doNotExec = atlasOut?.task_spec?.do_not_execute === true;
    let intent = (intentRaw === 'chat' || intentRaw === 'task') ? intentRaw : null;
    if (!intent) {
      intent = await classifyIntentSafe(message);
    }
    if (doNotExec || intent === 'chat') {
      sseSend(res, { type: 'info', agent: 'system', content: 'Режим розмови: виконання не запускається.' });
      sseSend(res, { type: 'complete', agent: 'system' });
      return res.end();
    }
  } catch (_) { /* ігноруємо, продовжуємо пайплайн */ }

  // 1.5) Уточнення будуть виникати природно під час виконання Тетяни (без штучної інʼєкції тут)

    // 2) Grisha checks
  sseSend(res, { type: 'info', agent: 'Grisha', content: '[ГРИША] Перевіряю політики…' });
    const grishaOut = await callGrisha({ ...atlasOut.task_spec, _msps: msps }, sessionId);
    if (grishaOut?.inter_agent_note_ua) {
      sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `[ГРИША] ${grishaOut.inter_agent_note_ua}` });
    }
  sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `[ГРИША] isSafe=${grishaOut.isSafe}. ${grishaOut.rationale ? grishaOut.rationale : ''}` });
    if (typeof grishaOut._attemptsUsed === 'number') {
      sseSend(res, { type: 'info', agent: 'Grisha', content: `[ГРИША] Спроб (policy): ${grishaOut._attemptsUsed}/${ORCH_GRISHA_MAX_ATTEMPTS}` });
    }

    if (!grishaOut.isSafe) {
      const testMode = !!(prompts?.grisha?.test_mode);
      if (testMode) {
        sseSend(res, { type: 'info', agent: 'system', content: 'TEST MODE: безпековий блок вимкнено; продовжую виконання.' });
      } else {
        sseSend(res, { type: 'complete', agent: 'system', content: 'Запит заблоковано політиками' });
        return res.end();
      }
    }

  // 3) Tetiana executes
  sseSend(res, { type: 'info', agent: 'Tetiana', content: '[ТЕТЯНА] Виконую задачу…' });
  
  // Ініціалізуємо стан сесії для адаптивного виконання
  updateSessionState(sessionId, 1);
  const initialMode = getExecutionMode(sessionId, 1);
  const initialRecommended = getRecommendedResources(sessionId, 1);
  
  let execText = await streamTetianaExecute(atlasOut.task_spec, sessionId, res, {
    cycle: 1, 
    mode: initialMode.mode
  }, initialRecommended);

  // 4) Post-execution verification loop (requires Grisha API key)
  if (MISTRAL_API_KEY) {
    for (let cycle = 1; cycle <= ORCH_MAX_REFINEMENT_CYCLES; cycle++) {
      // Адаптивна логіка на основі циклу
      const mode = getExecutionMode(sessionId, cycle);
      const recommended = getRecommendedResources(sessionId, cycle);
      
      sseSend(res, { type: 'info', agent: 'Grisha', content: `Запускаю перевірку виконання (цикл ${cycle}/${ORCH_MAX_REFINEMENT_CYCLES}) - ${mode.description}` });
      
      // Передаємо інформацію про режим виконання до планувальника верифікації
      const plan = await grishaGenerateVerificationPlan(
        atlasOut.task_spec, 
        execText, 
        msps, 
        { cycle, mode: mode.mode, recommended, sessionId }
      );
      
      const verifySession = `${sessionId || `sess-${Date.now()}`}-verify-${cycle}`;
      sseSend(res, { type: 'info', agent: 'Tetiana', content: '[ТЕТЯНА] Перевіряю результати…' });
      if (plan?.inter_agent_note_ua) {
        sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `[ГРИША] ${plan.inter_agent_note_ua}` });
      }
      if (typeof plan._attemptsUsed === 'number') {
  sseSend(res, { type: 'info', agent: 'Grisha', content: `Спроб (verification plan): ${plan._attemptsUsed}/${ORCH_GRISHA_MAX_ATTEMPTS}` });
      }
      let verifyPrompt = plan.verification_prompt;
      
      // Додаємо інформацію про режим виконання
      if (mode.mode !== "normal") {
        verifyPrompt += `\n\nРежим виконання: ${mode.description}`;
        if (recommended.reason) {
          verifyPrompt += `\nОснова: ${recommended.reason}`;
        }
      }
      
      // Якщо Гріша пропонує конкретні інструменти, додаємо їх до промпту
      if (Array.isArray(plan.suggested_tools) && plan.suggested_tools.length > 0) {
        verifyPrompt += `\n\nРекомендовані інструменти: ${plan.suggested_tools.join(', ')}`;
      }
      
      const verifyText = await streamTetianaMessage(
        verifyPrompt,
        verifySession,
        res
      );

      const judgement = await grishaAssessCompletion(atlasOut.task_spec, execText, verifyText, sessionId);
  if (judgement.isComplete) {
        sseSend(res, { type: 'agent_message', agent: 'Grisha', content: 'Перевірка пройдена. Завдання виконано повністю.' });
        
        // Context Summarization: Process completed interaction
        try {
          if (sessionId) {
            await contextSummarizer.processNewInteraction(
              message, 
              `${atlasOut.user_reply}\n${execText}`, 
              {
                generateResponse: async (messages, options) => {
                  // Simple AI client for summarization using Mistral
                  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
                  const userMessage = messages.find(m => m.role === 'user')?.content || '';
                  const result = await mistralJsonOnly(
                    systemMessage, 
                    userMessage, 
                    { maxAttempts: 3, temperature: 0.3, sessionId }
                  );
                  return { content: typeof result === 'string' ? result : JSON.stringify(result) };
                }
              }
            );
            console.log(`[ContextSummarizer] Updated context for session ${sessionId}`);
            const updatedStats = contextSummarizer.getStats();
            console.log(`[ContextSummarizer] New stats:`, updatedStats);
          }
        } catch (error) {
          console.error('[ContextSummarizer] Failed to process interaction:', error);
        }
        
  sseSend(res, { type: 'complete', agent: 'system' });
  res.end();
  return;
      }
      if (typeof judgement._attemptsUsed === 'number') {
        sseSend(res, { type: 'info', agent: 'Grisha', content: `Спроб (judge): ${judgement._attemptsUsed}/${ORCH_GRISHA_MAX_ATTEMPTS}` });
      }

  const issuesText = (judgement.issues || []).join('; ');
      sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `Виявлено невідповідності: ${issuesText || 'потрібне доопрацювання'}` });
      if (judgement?.inter_agent_note_ua) {
        sseSend(res, { type: 'agent_message', agent: 'Grisha', content: judgement.inter_agent_note_ua });
      }
  const refineBase = `Задача виконана неповністю. Проблеми: ${issuesText}.
Сформуй *план виправлення* для доопрацювання. Замість повного нового TaskSpec, створи компактний, що містить *лише* кроки для виправлення невиконаних success_criteria.
- Сфокусуйся на невиконаних критеріях.
- Кожен крок має бути спрямований на збір конкретного доказу (значення, стан, URL).
- Зроби план максимально коротким і точним.`;
      const refineMsg = judgement?.atlas_refine_prompt_ua ? `${refineBase}\n\nДодаткова підказка від Гріші:\n${judgement.atlas_refine_prompt_ua}` : refineBase;
      const atlasRefine = await callAtlas(refineMsg, sessionId);
      sseSend(res, { type: 'agent_message', agent: 'Atlas', content: atlasRefine.user_reply || 'Доопрацьовую задачу.' });
      sseSend(res, { type: 'info', agent: 'Tetiana', content: 'Продовжую доопрацювання…' });
      
      // Отримуємо адаптивний контекст для циклу доопрацювання
      const adaptiveContext = getExecutionMode(sessionId, cycle);
      const recommendedResources = await getRecommendedResources(sessionId, adaptiveContext.mode);
      
      const extraText = await streamTetianaExecute(atlasRefine.task_spec, sessionId, res, adaptiveContext, recommendedResources);
      execText = `${execText}\n\n[REFINEMENT ${cycle}]\n${extraText}`;
      
      // Оновлюємо стан сесії після кожного циклу доопрацювання
      updateSessionState(sessionId, cycle + 1); // cycle тут починається з 1
    }
    // Після циклів все ще не завершено
    sseSend(res, { type: 'agent_message', agent: 'Grisha', content: 'Після усіх спроб: завдання не довиконане. Потрібні додаткові дії.' });
    sseSend(res, { type: 'complete', agent: 'system' });
    res.end();
  } else {
    sseSend(res, { type: 'error', agent: 'Grisha', content: 'Відсутній ключ Mistral: неможливо провести перевірку/аудит.' });
    res.end();
  }
  } catch (err) {
    console.error('orchestrator error', err);
    try {
      sseSend(res, { type: 'error', error: err.message || String(err) });
      res.end();
    } catch {}
  }
});

// Atlas (Gemini) enrichment
async function callAtlas(userMessage, sessionId, options = {}) {
  const sys = prompts.atlas.system;
  const format = prompts.atlas.output_format;
  const instruction = `Відповідай українською. Спочатку коротко відповідай користувачу (user_reply). Потім побудуй task_spec у JSON відповідно до схеми: ${JSON.stringify(format)}. Виведи рівно один JSON-блок після користувацької відповіді. Не використовуй кодові блоки (три зворотні апострофи), не додавай префікси типу \"user_reply:\" у текст відповіді.`;
  const msps = Array.isArray(options.msps) ? options.msps : [];
  let mspsContext = '';
  if (msps.length) {
    const s = JSON.stringify(msps);
    mspsContext = `\n\nДодатковий контекст: Доступні MSP сервери (ім'я/порт/опис/статус) — ${capHead(s, ORCH_MAX_MSPS_CHARS)}`;
  }

  // Prepare candidate keys (rotate on 429/401/403)
  const candidateKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GENERATIVE_LANGUAGE_API_KEY
  ].filter((v, i, a) => v && a.indexOf(v) === i);
  if (candidateKeys.length === 0) {
    throw new Error('Atlas (Gemini) API key not configured');
  }

  const payload = {
    contents: [
      { role: 'user', parts: [{ text: `${sys}\n\n${instruction}${mspsContext}\n\nUser: ${userMessage}` }] }
    ]
  };

  const perKeyAttempts = Math.max(1, Math.min(ORCH_ATLAS_MAX_ATTEMPTS, 3));
  let usedAttempts = 0;
  let lastErr = null;
  let text = '';
  let keyUsed = null;

  for (let ki = 0; ki < candidateKeys.length; ki++) {
    const key = candidateKeys[ki];
    if (!key) continue;
    for (let a = 1; a <= perKeyAttempts; a++) {
      usedAttempts += 1;
      try {
        const url = `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${key}`;
        const { data } = await axios.post(url, payload, { timeout: ORCH_ATLAS_TIMEOUT_MS });
        text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        keyUsed = key;
        break;
      } catch (e) {
        lastErr = e;
        const status = e?.response?.status;
        // On rate limit or auth, try next key sooner; otherwise backoff and retry
        if (status === 429 || status === 401 || status === 403) {
          if (ki < candidateKeys.length - 1) {
            // switch to next key
            break;
          }
          await sleep(backoffDelay(a));
          continue;
        }
        if (status >= 500 && status < 600) {
          await sleep(backoffDelay(a));
          continue;
        }
        // Fatal - stop immediately
        throw e;
      }
    }
    if (text) break;
  }

  if (!text) {
    console.warn('Gemini call failed:', lastErr?.message);
    throw new Error('Atlas недоступний: ' + (lastErr?.message || 'невідома помилка'));
  }

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
    },
    _attemptsUsed: usedAttempts,
    _keyUsed: keyUsed ? (keyUsed === process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : keyUsed === process.env.GOOGLE_API_KEY ? 'GOOGLE_API_KEY' : 'GENERATIVE_LANGUAGE_API_KEY') : null
  };
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
  const keys = [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.GENERATIVE_LANGUAGE_API_KEY].filter(Boolean);
  let data = null; let lastErr = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      const url = `${GEMINI_API_URL}/models/${GEMINI_MODEL}:generateContent?key=${keys[i]}`;
      const payload = { contents: [ { role: 'user', parts: [{ text: `${base}\n\n${ask}` }] } ] };
      const resp = await axios.post(url, payload, { timeout: ORCH_ATLAS_TIMEOUT_MS });
      data = resp.data; break;
    } catch (e) { lastErr = e; const st = e?.response?.status; if (!(st === 401 || st === 403 || st === 429)) break; }
  }
  if (!data) throw lastErr || new Error('clarify failed');
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
    throw new Error('Grisha (Mistral) API key not configured');
  }
  
  // Додаємо MSP контекст, якщо є
  const msps = taskSpec._msps || [];
  let mspsContext = '';
  if (msps.length) {
    const s = JSON.stringify(msps);
    mspsContext = `\n\nДоступні MSP сервери: ${capHead(s, ORCH_MAX_MSPS_CHARS)}`;
  }
  
  try {
    const tsSummary = summarizeTaskSpec(taskSpec);
    const userMessage = `TaskSpecSummary JSON:\n${JSON.stringify(tsSummary)}${mspsContext}`;
    const out = await mistralJsonOnly(sys, userMessage, { maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, temperature: 0, sessionId });
  if (typeof out.isSafe !== 'boolean') out.isSafe = true;
  if (!Array.isArray(out.flagged)) out.flagged = [];
  return out;
  } catch (e) {
  console.warn('Mistral policy check failed:', e.message);
  throw new Error('Grisha policy check failed: ' + (e.message || 'unknown error'));
  }
}

// Grisha: сформувати план перевірки виконання
async function grishaGenerateVerificationPlan(taskSpec, execText, msps = [], adaptiveContext = {}) {
  if (!MISTRAL_API_KEY) throw new Error('Grisha verification requires Mistral API key');
  const sys = prompts.grisha.verification_planner_system || `You are Grisha, a strict verification planner. Return JSON with keys: verification_prompt (string) describing a self-contained check the executor (Tetiana) can run to confirm completeness; hints (array of strings).`;
  const tsSummary = summarizeTaskSpec(taskSpec);
  const execTail = capTail(execText || '', ORCH_MAX_EXEC_REPORT_CHARS);
  
  // Додаємо MSP контекст для verification planning
  let mspsContext = '';
  if (msps.length) {
    let mspsToUse = msps;
    
    // Адаптивна логіка: на 3-му циклі обмежуємо MSP
    if (adaptiveContext.mode === "msp_specific" && adaptiveContext.recommended?.msps?.length) {
      mspsToUse = msps.filter(msp => 
        adaptiveContext.recommended.msps.some(rec => 
          msp.name && msp.name.toLowerCase().includes(rec.toLowerCase())
        )
      );
      if (mspsToUse.length === 0) mspsToUse = msps.slice(0, 3); // fallback
    }
    
    const s = JSON.stringify(mspsToUse);
    mspsContext = `\n\nДоступні MSP сервери для верифікації: ${capHead(s, ORCH_MAX_MSPS_CHARS)}`;
    
    if (adaptiveContext.mode === "msp_specific") {
      mspsContext += `\n\n[ЦИКЛ ${adaptiveContext.cycle}] Обмеження до конкретних MSP серверів.`;
    } else if (adaptiveContext.mode === "tool_specific") {
      mspsContext += `\n\n[ЦИКЛ ${adaptiveContext.cycle}] Фокус на конкретних інструментах: ${adaptiveContext.recommended?.tools?.join(', ') || 'автовибір'}.`;
    }
  }
  
  const user = `TaskSpecSummary: ${JSON.stringify(tsSummary)}\n\nExecutor report (tail):\n${execTail}${mspsContext}`;
  try {
    const out = await mistralJsonOnly(sys, user, { maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, temperature: 0, sessionId: adaptiveContext.sessionId });
    if (typeof out.verification_prompt !== 'string' || !out.verification_prompt.trim()) {
      out.verification_prompt = 'Верифікуй повноту виконання і надай докази з мапінгом критеріїв -> артефакти.';
    }
    if (!Array.isArray(out.hints)) out.hints = [];
    if (!Array.isArray(out.suggested_tools)) out.suggested_tools = [];
    return out;
  } catch (e) {
    throw new Error('Grisha verification plan failed: ' + (e.message || 'unknown error'));
  }
}

// Grisha: оцінити завершеність після перевірки
async function grishaAssessCompletion(taskSpec, execText, verifyText, sessionId = null) {
  if (!MISTRAL_API_KEY) throw new Error('Grisha completion judge requires Mistral API key');
  const sys = prompts.grisha.completion_judge_system || `You are Grisha, a strict completion judge. Return JSON: { isComplete: boolean, issues: string[] } based on evidence.`;
  const tsSummary = summarizeTaskSpec(taskSpec);
  const execTail = capTail(execText || '', ORCH_MAX_EXEC_REPORT_CHARS);
  const verifyTail = capTail(verifyText || '', ORCH_MAX_VERIFY_EVIDENCE_CHARS);
  const user = `TaskSpecSummary: ${JSON.stringify(tsSummary)}\n\nExecutor report (tail):\n${execTail}\n\nVerification evidence (tail):\n${verifyTail}`;
  try {
    const out = await mistralJsonOnly(sys, user, { maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, temperature: 0.1, sessionId });
    if (typeof out.isComplete !== 'boolean') {
      return { isComplete: false, issues: ['Не вдалося інтерпретувати результат оцінки завершеності. Очікується поле isComplete:boolean.'] };
    }
    if (!Array.isArray(out.issues)) out.issues = [];
    return out;
  } catch (e) {
    return { isComplete: false, issues: ['Помилка оцінки завершеності: ' + (e.message || 'невідома помилка')] };
  }
}

// Tetiana: универсальный стрим произвольного повідомлення
async function streamTetianaMessage(messageText, sessionId, res, options = {}) {
  const secret = process.env.GOOSE_SECRET_KEY;

  // Автовизначення режиму Goose: web (ws) чи goosed (/reply)
  const gooseBase = GOOSE_BASE_URL.replace(/\/$/, '');
  const isWebDetected = await isGooseWeb(gooseBase);
  const isWeb = ORCH_FORCE_GOOSE_REPLY ? false : isWebDetected;

  // Guard prompt size to avoid 400 from upstream providers
  const safeMessageText = ensurePromptBounds(messageText, ORCH_MAX_MISTRAL_USER_CHARS, 'Tetiana prompt');
  try {
    const est = estimateTokens(safeMessageText);
    console.log(`[CONTEXT_LIMIT] Tetiana prompt size: chars=${safeMessageText.length}, estTokens=${est}, mode=${isWeb ? 'websocket' : 'sse'}`);
  } catch {}

  const payload = {
    messages: [
      {
        role: 'user',
        created: Math.floor(Date.now() / 1000),
        content: [{ type: 'text', text: safeMessageText }]
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

  const sendViaSse = async (overrideText) => {
    const text = overrideText || safeMessageText;
    const url = `${gooseBase}/reply`;
    const ssePayload = {
      ...payload,
      messages: [
        {
          role: 'user',
          created: Math.floor(Date.now() / 1000),
          content: [{ type: 'text', text }]
        }
      ]
    };
    let response;
    try {
      response = await axios.post(url, ssePayload, { headers, responseType: 'stream', timeout: 0 });
    } catch (e) {
      const status = e?.response?.status;
      const msg = `[Tetiana][SSE] POST ${url} failed: ${status || e.message}`;
      throw new Error(msg);
    }
    return new Promise((resolve, reject) => {
      let collected = '';
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
              resolve(collected.trim());
              return;
            }
            const msg = obj.message;
            if (msg && Array.isArray(msg.content)) {
              for (const c of msg.content) {
                if (c.type === 'text' && c.text) {
                  sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: c.text });
                  collected += c.text + '\n';
                  maybeAutoAnswerFromAtlasText(c.text, answeredQuestions, sessionId, res, gooseBase, secret, null).catch(() => {});
                }
                if (c.type === 'frontendToolRequest' || c.type === 'question') {
                  autoAnswerFromAtlas(c, sessionId, res, gooseBase, secret).catch(() => {});
                }
              }
            }
          } catch (_) {}
        }
      });
      response.data.on('end', () => {
        analyzeExecutionOutput(collected, sessionId);
        resolve(collected.trim());
      });
      response.data.on('error', (err) => reject(err));
    });
  };

  if (isWeb) {
    try {
      // Потік через WebSocket /ws з авто-відповідями Атласа на уточнення
      return await streamTetianaWs(gooseBase, payload, res, sessionId);
    } catch (e) {
      const msg = e?.message || '';
      const tooLong = /model_max_prompt_tokens_exceeded|prompt token count/i.test(msg);
      const notFound = /404|not\s*found/i.test(msg);
      if (tooLong) {
        console.log('[CONTEXT_LIMIT] Goose Web reported token overflow. Falling back to SSE with extra compression...');
        const fallbackMax = Math.max(2000, Math.floor(ORCH_MAX_MISTRAL_USER_CHARS * 0.5));
        const compressed = ensurePromptBounds(messageText, fallbackMax, 'Tetiana prompt (fallback)');
        try {
          const est2 = estimateTokens(compressed);
          console.log(`[CONTEXT_LIMIT] Fallback prompt size: chars=${compressed.length}, estTokens=${est2}`);
        } catch {}
        return await sendViaSse(compressed);
      } else if (notFound) {
        console.log('[ROUTE_FALLBACK] Goose Web /ws returned 404; trying /reply SSE...');
        return await sendViaSse();
      }
      throw e;
    }
  } else {
    // Потік через goosed /reply (SSE)
    return await sendViaSse();
  }
}

// Tetiana: виконання по TaskSpec
async function streamTetianaExecute(taskSpec, sessionId, res, adaptiveContext = {}, recommendedResources = {}) {
  // Гріша перевіряє активні MSP перед виконанням
  let liveMsps = await getAvailableMsps();
  
  // Адаптивна логіка: обмеження MSP на основі циклу
  if (adaptiveContext.mode === "msp_specific" && recommendedResources?.msps?.length) {
    liveMsps = liveMsps.filter(msp => 
      recommendedResources.msps.some(rec => 
        msp.name && msp.name.toLowerCase().includes(rec.toLowerCase())
      )
    );
    if (liveMsps.length === 0) liveMsps = await getAvailableMsps(); // fallback до всіх MSP
  }
  
  let mspsContext = '';
  if (liveMsps.length) {
    const s = JSON.stringify(liveMsps);
    mspsContext = `\n\nАктивні MSP сервери (перевірено Гришею): ${capHead(s, ORCH_MAX_MSPS_CHARS)}`;
    
    if (adaptiveContext.mode === "msp_specific") {
      mspsContext += `\n\n[АДАПТИВНИЙ РЕЖИМ] Цикл ${adaptiveContext.cycle || 'поточний'}: Обмеження до конкретних MSP серверів: ${recommendedResources?.msps?.join(', ') || 'всі доступні'}.`;
    } else if (adaptiveContext.mode === "tool_specific") {
      mspsContext += `\n\n[АДАПТИВНИЙ РЕЖИМ] Цикл ${adaptiveContext.cycle || 'поточний'}: Сфокусуйся на інструментах: ${recommendedResources?.tools?.join(', ') || 'найкращі доступні'}.`;
    }
  }
  
  // Стискаємо TaskSpec перед вставкою в промпт, щоб уникати переповнення контексту
  const originalTs = JSON.stringify(taskSpec);
  const summarizedTs = summarizeTaskSpec(taskSpec); // вже обмежує довжину полів
  const summarizedTsJson = JSON.stringify(summarizedTs);
  if (summarizedTsJson.length < originalTs.length) {
    console.log(`[ContextSummarizer] TaskSpec reduced: ${originalTs.length} -> ${summarizedTsJson.length} chars`);
  }
  
  // Використовуємо новий розумний промпт для Тетяни з intelligeich.json
  const tetyanaSystem = prompts.tetyana?.system || 'Ти - Тетяна, досвідчена виконавиця завдань та практикуюча спеціалістка.';
  const tetyanaApproach = prompts.tetyana?.execution_approach || {};
  
  // Створюємо розумний промпт з урахуванням ролі Тетяни
  const roleContext = `[ТЕТЯНА] ${tetyanaSystem}
  
Твоя методологія роботи:
- ${tetyanaApproach.methodology || 'покроковий детальний підхід'}
- ${tetyanaApproach.verification || 'збір конкретних доказів виконання'}
- ${tetyanaApproach.reporting || 'чіткі звіти з результатами'}
- ${tetyanaApproach.problem_solving || 'практичне вирішення проблем по ходу'}`;
  
  const messageText = `${roleContext}

Виконай наступну задачу (TaskSpec JSON нижче) максимально надійно відповідно до своєї ролі. Після КОЖНОГО кроку виконуй коротку перевірку успіху і, якщо щось не спрацювало, динамічно переформульовуй наступні дії (в межах task_spec та його contingencies), доки не отримаєш доказ виконання або вичерпаєш варіанти. 

Завжди підписуйся як [ТЕТЯНА] та наприкінці обов'язково надавай мапу criterion->evidence.

TaskSpec: ${summarizedTsJson}${mspsContext}`;
  
  return streamTetianaMessage(messageText, sessionId, res);
}

// Перевірка: чи це Goose Web (а не goosed agent)
async function isGooseWeb(baseUrl) {
  const urlBase = baseUrl.replace(/\/$/, '');
  // 1) Спроба офіційного health для веб-інтерфейсу (якщо є)
  try {
    const resp = await axios.get(`${urlBase}/api/health`, { timeout: 2000, validateStatus: () => true });
    if (resp.status >= 200 && resp.status < 300) return true;
  } catch {}
  // 2) Fallback: головна сторінка Goose Web віддає HTML з UI
  try {
    const resp = await axios.get(`${urlBase}/`, { timeout: 2000, validateStatus: () => true });
    const ct = String(resp.headers?.['content-type'] || '').toLowerCase();
    if (resp.status === 200 && (ct.includes('text/html') || ct.includes('text/plain'))) {
      const body = typeof resp.data === 'string' ? resp.data : '';
      // евристика: шукаємо згадування Goose або елементів UI
      if (body.includes('Goose') || body.includes('goose') || body.includes('<html')) return true;
    }
  } catch {}
  // 3) Інакше вважаємо, що це goosed agent (який не має HTML-UI) і використовуємо /reply
  return false;
}

// Стрім Тетяни через WebSocket інтерфейс Goose Web
function streamTetianaWs(baseUrl, chatPayload, res, sessionId) {
  return new Promise((resolve, reject) => {
    const wsUrl = baseUrl.replace(/^http/i, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const answeredQuestions = new Set();
    let collected = '';

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
            // maybeAutoAnswerFromAtlasText временно отключён из-за конфликтов API
            // maybeAutoAnswerFromAtlasText(String(content), answeredQuestions, sessionId, res, baseUrl, null, ws).catch(() => {});
            collected += String(content) + '\n';
          }
        } else if (t === 'question' || t === 'frontendToolRequest') {
          // Автовідповідь Атласа на уточнення тимчасово відключена через конфлікти з GitHub Copilot API
          // autoAnswerFromAtlas(obj, sessionId, res, baseUrl, null, ws).catch(() => {});
          console.log('[DEBUG] Question/frontendToolRequest received but auto-answer disabled:', obj.type);
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
  ws.on('close', () => { 
    // Аналізуємо зібраний вивід для відстеження використаних ресурсів
    analyzeExecutionOutput(collected, sessionId);
    finish(); 
    resolve(collected.trim()); 
  });
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
      // Ждем ответ потока, но не проксируем его напрямую (ответ пойдет в основному стриме)
      axios.post(url, payload, { headers, responseType: 'stream', timeout: 120000 }).catch((e) => {
        // Тихо ігноруємо 404 на /reply (часто від Goose Web UI, де немає цього маршруту)
        const st = e?.response?.status; if (st && st !== 404) console.warn('[autoAnswerFromAtlas] /reply error:', st);
      });
    }

    // Показати в UI, що Атлас відповів на уточнення (для прозрачности)
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
  const classifierSystem = prompts.atlas.classifier_system || 'You are a concise classifier. Answer strictly yes or no.';
  const classificationPrompt = `${classifierSystem}\nВизнач: чи є цей текст уточнюючим питанням (yes/no): "${snippet}". Виведи лише yes або no.`;
    const ans = await callAtlas(classificationPrompt, sessionId);
    const verdict = (ans.user_reply || '').trim().toLowerCase();
    if (verdict.startsWith('yes')) {
      answeredSet.add(key);
      await autoAnswerFromAtlas(snippet, sessionId, res, gooseBase, secret, wsOpt);
    }
  } catch {}
}

// Context management endpoints
app.get('/context/stats', (req, res) => {
  try {
    const stats = contextSummarizer.getStats();
    res.json({
      success: true,
      stats: stats,
      maxContextTokens: contextSummarizer.maxContextTokens,
      summaryRatio: contextSummarizer.summaryRatio
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/context/clear', (req, res) => {
  try {
    contextSummarizer.clearState();
    res.json({
      success: true,
      message: 'Context cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/context/formatted', (req, res) => {
  try {
    const formatted = contextSummarizer.formatForAiPrompt();
    res.json({
      success: true,
      formattedContext: formatted,
      length: formatted.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(ORCH_PORT, () => {
  console.log(`Orchestrator running on http://127.0.0.1:${ORCH_PORT}`);
  console.log(`Smart Context Summarization: ${contextSummarizer.maxContextTokens} max tokens, ${Math.round(contextSummarizer.summaryRatio * 100)}% summary ratio`);
});
