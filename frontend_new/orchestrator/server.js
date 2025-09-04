import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
// If provider is GitHub Copilot, prefer SSE to avoid strict tool_calls sequencing errors over WS
const ORCH_SSE_FOR_GITHUB_COPILOT = String(process.env.ORCH_SSE_FOR_GITHUB_COPILOT || 'true') === 'true';
// Optional manual override of detected Goose provider (useful if Goose API not accessible)
const ORCH_GOOSE_PROVIDER = process.env.ORCH_GOOSE_PROVIDER || '';
// Force verification cycles even if Tetiana reports completion
const ORCH_FORCE_VERIFICATION = String(process.env.ORCH_FORCE_VERIFICATION || 'false') === 'true';
// Optional: enable OpenRouter as last-resort multi-provider fallback
const ORCH_ENABLE_OPENROUTER_FALLBACK = String(process.env.ORCH_ENABLE_OPENROUTER_FALLBACK || 'true') === 'true';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_API_URL = (process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const OPENROUTER_MODELS_FILE = process.env.OPENROUTER_MODELS_FILE || path.resolve(path.dirname(new URL(import.meta.url).pathname), 'openrouter_models.json');

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
const MISTRAL_FALLBACK_MODEL = process.env.MISTRAL_FALLBACK_MODEL || 'mistral-large-latest';
// Optional: comma-separated list for cascade fallback, e.g. "mistral-small-latest,mistral-medium-latest,mistral-large-latest"
const MISTRAL_MODEL_CANDIDATES = (() => {
  const raw = (process.env.MISTRAL_MODEL_CANDIDATES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  // Default to primary + single fallback if list not provided
  const defaults = [MISTRAL_MODEL, MISTRAL_FALLBACK_MODEL].filter(Boolean);
  // De-duplicate while preserving order
  const seen = new Set();
  const out = (raw.length ? raw : defaults).filter(m => {
    if (seen.has(m)) return false; seen.add(m); return true;
  });
  return out;
})();

// --- OpenRouter helpers ---
function loadOpenRouterModels() {
  try {
    const envCsv = (process.env.OPENROUTER_MODEL_CANDIDATES || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    let fileList = [];
    if (fs.existsSync(OPENROUTER_MODELS_FILE)) {
      try {
        const raw = fs.readFileSync(OPENROUTER_MODELS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        // Support both array format and OpenAI-style format with data array
        if (Array.isArray(parsed)) {
          fileList = parsed.filter(x => typeof x === 'string' && x.trim());
        } else if (parsed.data && Array.isArray(parsed.data)) {
          fileList = parsed.data
            .filter(item => item && typeof item.id === 'string')
            .map(item => item.id.trim())
            .filter(Boolean);
        }
      } catch (e) {
        console.warn('[OpenRouter] Failed to read models file:', e.message);
      }
    }
    const combined = [...envCsv, ...fileList];
    // De-duplicate
    const seen = new Set();
    return combined.filter(m => { if (!m || seen.has(m)) return false; seen.add(m); return true; });
  } catch {
    return [];
  }
}

async function openRouterChat(system, user, { temperature = 0, timeout = ORCH_GRISHA_TIMEOUT_MS, models = null } = {}) {
  if (!ORCH_ENABLE_OPENROUTER_FALLBACK || !OPENROUTER_API_KEY) throw new Error('OpenRouter fallback disabled or API key missing');
  const url = `${OPENROUTER_API_URL}/chat/completions`;
  const candidates = Array.isArray(models) && models.length ? models : loadOpenRouterModels();
  if (!candidates.length) throw new Error('No OpenRouter models configured');
  const headers = {
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json'
  };
  let lastErr = null;
  for (const model of candidates) {
    try {
      if (process.env.DEBUG) console.log(`[OpenRouter] Trying model: ${model}`);
      const payload = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature
      };
      const { data } = await axios.post(url, payload, { headers, timeout });
      const text = data?.choices?.[0]?.message?.content;
      if (text && typeof text === 'string') return text;
      // If empty or unexpected, continue to next
      lastErr = new Error('Empty response');
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const msg = e?.response?.data?.error?.message || e?.message || '';
      if (process.env.DEBUG) console.warn(`[OpenRouter] Model ${model} failed (${status || 'ERR'}: ${msg}). Trying next...`);
      // continue
    }
  }
  throw lastErr || new Error('OpenRouter failed for all candidates');
}

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
  if (!state) {
    return { 
      mode: "normal", 
      msps: [], 
      tools: [], 
      reason: "Нова сесія - повний доступ до ресурсів" 
    };
  }

  if (currentCycle === 3) {
    // Цикл 3: Обмеження до конкретних MSP (топ-3 найбільш використовуваних)
    const topMSPs = Array.from(state.usedMSPs).slice(0, 3);
    return {
      mode: "msp_specific",
      msps: topMSPs,
      tools: [],
      reason: `Цикл 3: Обмеження до найчастіше використовуваних MSP: ${topMSPs.join(', ')}`
    };
  } else if (currentCycle === 6) {
    // Цикл 6: Обмеження до конкретних інструментів (останні 3 використані)
    const recentTools = Array.from(state.usedTools).slice(-3);
    return {
      mode: "tool_specific",
      msps: [],
      tools: recentTools,
      reason: `Цикл 6: Обмеження до останніх використовуваних інструментів: ${recentTools.join(', ')}`
    };
  } else {
    // Стандартні цикли: рекомендації на основі попереднього використання
    const suggestedMSPs = Array.from(state.usedMSPs).slice(0, 5);
    const suggestedTools = Array.from(state.usedTools).slice(-5);
    return {
      mode: "normal",
      msps: suggestedMSPs,
      tools: suggestedTools,
      reason: "Рекомендації на основі попереднього використання"
    };
  }
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

// --- Goose provider detection (with simple cache) ---
let __cachedGooseProvider = null;
let __cachedGooseProviderAt = 0;
async function resolveGooseProvider() {
  try {
    // 1) Env override wins
    if (ORCH_GOOSE_PROVIDER) return ORCH_GOOSE_PROVIDER;
    // Cache for 30s
    const now = Date.now();
    if (__cachedGooseProvider && (now - __cachedGooseProviderAt < 30000)) return __cachedGooseProvider;
    const base = GOOSE_BASE_URL.replace(/\/$/, '');
    const url = `${base}/config/read`;
    const secret = process.env.GOOSE_SECRET_KEY;
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Secret-Key'] = secret;
    try {
      const { data } = await axios.post(url, { key: 'GOOSE_PROVIDER', is_secret: false }, { headers, timeout: 4000 });
      const prov = (typeof data === 'string' ? data : (data?.value || data)) || '';
      if (prov) {
        __cachedGooseProvider = String(prov);
        __cachedGooseProviderAt = now;
        return __cachedGooseProvider;
      }
    } catch (_) {
      // Fallback to local config file if present
      try {
        const cfgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../goose/config.yaml');
        if (fs.existsSync(cfgPath)) {
          const raw = fs.readFileSync(cfgPath, 'utf8');
          const m = raw.match(/\bGOOSE_PROVIDER\s*:\s*([\w\-]+)/);
          if (m && m[1]) {
            __cachedGooseProvider = m[1];
            __cachedGooseProviderAt = now;
            return __cachedGooseProvider;
          }
        }
      } catch {}
    }
  } catch {}
  return null;
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

async function mistralChat(system, user, { temperature = 0, timeout = ORCH_GRISHA_TIMEOUT_MS, model = null, models = null } = {}) {
  const url = 'https://api.mistral.ai/v1/chat/completions';
  const makePayload = (m) => ({ model: m, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], temperature });
  // Build candidate list: explicit models -> single model -> global candidates
  const baseCandidates = Array.isArray(models) && models.length
    ? models
    : (model ? [model, ...MISTRAL_MODEL_CANDIDATES.filter(x => x !== model)] : MISTRAL_MODEL_CANDIDATES);

  let lastErr = null;
  for (const m of baseCandidates) {
    try {
      if (process.env.DEBUG) console.log(`[Grisha] Calling Mistral model: ${m}`);
      const { data } = await axios.post(url, makePayload(m), { headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` }, timeout });
      return data?.choices?.[0]?.message?.content || '';
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const msg = e?.response?.data?.error?.message || e?.message || '';
      const tokenLimit = status === 400 && /model_max_prompt_tokens_exceeded|prompt token count/i.test(msg);
      const retriable = status === 429 || (status >= 500 && status < 600) || tokenLimit;
      if (process.env.DEBUG) console.warn(`[Grisha] Model ${m} failed (${status || 'ERR'}: ${msg}). ${retriable ? 'Trying next candidate...' : 'Not retriable.'}`);
      if (!retriable) break; // don't cascade on non-retriable errors
      // else continue to next model
    }
  }
  // If Mistral candidates exhausted, try local fallback API on port 3010
  try {
    if (process.env.DEBUG) console.warn('[Grisha] Mistral candidates exhausted. Switching to local API fallback...');
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
    return await callFallbackAPI(messages, FALLBACK_MODELS.grisha, { temperature, timeout });
  } catch (e) {
    lastErr = e;
    if (process.env.DEBUG) console.warn('[Grisha] Local API fallback also failed:', e.message);
  }
  
  // If local API also fails, try OpenRouter as final resort (if enabled)
  if (ORCH_ENABLE_OPENROUTER_FALLBACK && OPENROUTER_API_KEY) {
    try {
      if (process.env.DEBUG) console.warn('[Grisha] Local API failed. Trying OpenRouter as final resort...');
      return await openRouterChat(system, user, { temperature, timeout });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Mistral/Local API/OpenRouter call failed for all fallback options');
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
  // Try fallback model on next attempt by reducing system size and letting mistralChat fallback path handle model switch
  sys = capHead(sys, Math.floor(ORCH_MAX_MISTRAL_SYSTEM_CHARS * 0.8));
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

// Diagnostics: show detected Goose provider and routing preference
app.get('/health/goose', async (_, res) => {
  try {
    const provider = (await resolveGooseProvider()) || 'unknown';
    const base = GOOSE_BASE_URL.replace(/\/$/, '');
    const isWeb = await isGooseWeb(base);
    const forcedSse = ORCH_FORCE_GOOSE_REPLY || (ORCH_SSE_FOR_GITHUB_COPILOT && String(provider).toLowerCase() === 'github_copilot');

    // NEW: короткий префлайт токена для діагностики
    let tokenInfo = { ok: null, source: null, reason: null };
    if (String(provider).toLowerCase() === 'github_copilot') {
      try {
        const t = await hasCopilotTokenLocalCached();
        tokenInfo = { ok: !!t.ok, source: t.source || null, reason: t.reason || null };
      } catch (e) {
        tokenInfo = { ok: false, source: null, reason: e?.message || 'token preflight error' };
      }
    }

    res.json({
      base,
      provider,
      uiDetected: isWeb,
      willUseSSE: forcedSse || !isWeb,
      forcedSse,
      token: tokenInfo,
      notes: forcedSse ? 'SSE forced for provider/rule' : 'Auto-detect'
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'failed' });
  }
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
    // Keep-alive heartbeat every 15s to avoid client-side timeouts during long operations
    const __heartbeat = setInterval(() => {
      try { sseSend(res, { type: 'heartbeat', ts: Date.now() }); } catch (_) {}
    }, 15000);
    const __end = () => { try { clearInterval(__heartbeat); } catch (_) {} };
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
    // Логуємо помилку для діагностики
    console.error('[Atlas] Error during Atlas call:', e.message);
    
    // Показуємо, що використовуємо fallback
    sseSend(res, { type: 'info', agent: 'Atlas', content: `[ATLAS] Помилка основного сервісу: ${e.message}. Спробую fallback...` });
    
    // Повертаємо мінімальну відповідь, якщо всі fallback не спрацювали
    sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] Всі сервіси недоступні. Спробуйте пізніше або перевірте налаштування.' });
    sseSend(res, { type: 'complete', agent: 'system' });
    __end();
    return res.end();
  }
  // ВИВІД ВІДПОВІДІ АТЛАСА ПЕРЕНЕСЕНО НИЖЧЕ, щоб уникнути дублювання у chat-режимі
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
      // Віддаємо відповідь Атласа у чат і завершуємо стрім без запуску виконання (ОДИН РАЗ)
      const reply = atlasOut.user_reply || politeFallbackReply(message);
      if (reply && reply.trim()) {
        sseSend(res, { type: 'agent_message', agent: 'Atlas', content: `[ATLAS] ${reply}` });
      }
      sseSend(res, { type: 'info', agent: 'system', content: 'Режим розмови: виконання не запускається.' });
      sseSend(res, { type: 'complete', agent: 'system' });
      __end();
      return res.end();
    } else {
      // Режим виконання: показуємо відповідь Атласа один раз перед перевіркою Гриші
      const reply = atlasOut.user_reply || '';
      if (reply && reply.trim()) {
        sseSend(res, { type: 'agent_message', agent: 'Atlas', content: `[ATLAS] ${reply}` });
      }
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
  __end();
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

  // 3.5) Check Tetyana's completion status before starting verification
  const completionStatus = await checkTetianaCompletionStatus(execText, sessionId);
  if (completionStatus.isComplete && !ORCH_FORCE_VERIFICATION) {
  sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: '[ТЕТЯНА] Задача виконана успішно!' });
  sseSend(res, { type: 'complete', agent: 'system' });
  __end();
  return res.end();
  } else if (completionStatus.isComplete && ORCH_FORCE_VERIFICATION) {
    sseSend(res, { type: 'info', agent: 'Grisha', content: '[ГРИША] Форсована перевірка: навіть при заявленому завершенні виконую незалежну верифікацію.' });
  }
  
  if (!completionStatus.canContinue) {
    sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: '[ТЕТЯНА] Не можу продовжити виконання задачі.' });
    sseSend(res, { type: 'info', agent: 'Grisha', content: '[ГРИША] Tetyana не може продовжити. Переходжу до аналізу проблем.' });
  }

  // 4) Grisha independent verification sessions (requires Grisha API key)
  if (MISTRAL_API_KEY) {
    let maxCycles = ORCH_MAX_REFINEMENT_CYCLES;
    let currentCycle = 1;
    
    while (currentCycle <= maxCycles) {
      // Адаптивна логіка на основі циклу
      const mode = getExecutionMode(sessionId, currentCycle);
      const recommended = getRecommendedResources(sessionId, currentCycle);
      
      sseSend(res, { type: 'info', agent: 'Grisha', content: `[ГРИША] Створюю незалежну сесію перевірки (цикл ${currentCycle}/${maxCycles}) - ${mode.description}` });
      
      // Grisha створює цільові завдання для перевірки
      const verificationTasks = await grishaCreateTargetedVerificationTasks(
        atlasOut.task_spec, 
        execText, 
        msps, 
        { cycle: currentCycle, mode: mode.mode, recommended, sessionId }
      );
      
      if (!verificationTasks || verificationTasks.length === 0) {
        sseSend(res, { type: 'info', agent: 'Grisha', content: '[ГРИША] Немає специфічних завдань для перевірки.' });
        break;
      }
      
      // Виконуємо кожне цільове завдання через окремі сесії з Tetiana
      let allVerificationResults = [];
      for (let i = 0; i < verificationTasks.length; i++) {
        const task = verificationTasks[i];
        const taskSession = `${sessionId || `sess-${Date.now()}`}-verify-${currentCycle}-task-${i}`;
        
        sseSend(res, { type: 'info', agent: 'Grisha', content: `[ГРИША] Завдання ${i + 1}/${verificationTasks.length}: ${task.description}` });
        sseSend(res, { type: 'info', agent: 'Tetiana', content: '[ТЕТЯНА] Виконую цільове завдання перевірки…' });
        
        const taskResult = await streamTetianaMessage(
          task.prompt,
          taskSession,
          res,
          { expectSpecificOutput: true }
        );
        
        allVerificationResults.push({
          task: task.description,
          prompt: task.prompt,
          result: taskResult,
          session: taskSession
        });
      }
      
      // Grisha аналізує всі результати і дає вердикт
      const grishaVerdict = await grishaAnalyzeVerificationResults(
        atlasOut.task_spec, 
        execText, 
        allVerificationResults,
        { cycle: currentCycle, mode: mode.mode }
      );
      
      if (grishaVerdict.isComplete) {
        sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `[ГРИША] Вердикт: Завдання виконано повністю. ${grishaVerdict.reasoning}` });
        
        // Context Summarization: Process completed interaction
        try {
          if (sessionId) {
            await contextSummarizer.processNewInteraction(
              message, 
              `${atlasOut.user_reply}\n${execText}\n[VERIFICATION]\n${allVerificationResults.map(r => r.result).join('\n')}`, 
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
  try { __end?.(); } catch (_) {}
  res.end();
        return;
      }
      
      // Завдання не завершене - Grisha передає проблеми Atlas для планування доопрацювання
      const issues = grishaVerdict.issues || [];
      const issuesText = issues.join('; ');
      sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `[ГРИША] Виявлено проблеми: ${issuesText}` });
      
      if (grishaVerdict?.detailed_feedback) {
        sseSend(res, { type: 'agent_message', agent: 'Grisha', content: `[ГРИША] Детальний аналіз: ${grishaVerdict.detailed_feedback}` });
      }
      // Atlas створює план доопрацювання з урахуванням циклу та режиму
      let refinePrompt = `Задача виконана неповністю. Проблеми: ${issuesText}.
Цикл: ${currentCycle}/${maxCycles}. Режим: ${mode.description}.
Сформуй *план виправлення* для доопрацювання:`;
      
      if (currentCycle === 3) {
        refinePrompt += `\n\nОБОВ'ЯЗКОВО: Використовуй тільки ці MSP сервери (не рекомендації, а вимоги): ${JSON.stringify(recommended.msps || [])}`;
      } else if (currentCycle === 6) {
        refinePrompt += `\n\nОБОВ'ЯЗКОВО: Використовуй тільки ці інструменти step-by-step (формальні інструкції): ${JSON.stringify(recommended.tools || [])}`;
      }
      
      if (grishaVerdict?.atlas_refinement_hint) {
        refinePrompt += `\n\nПідказка від Гріші: ${grishaVerdict.atlas_refinement_hint}`;
      }
      
      const atlasRefine = await callAtlas(refinePrompt, sessionId);
      sseSend(res, { type: 'agent_message', agent: 'Atlas', content: `[ATLAS] ${atlasRefine.user_reply || 'Доопрацьовую план.'}` });
      sseSend(res, { type: 'info', agent: 'Tetiana', content: '[ТЕТЯНА] Продовжую доопрацювання…' });
      
      // Отримуємо адаптивний контекст для циклу доопрацювання з правильним застосуванням обмежень
      const refinementContext = getExecutionMode(sessionId, currentCycle);
      const refinementResources = await getRecommendedResources(sessionId, refinementContext.mode);
      
      // Для циклів 3 та 6 застосовуємо жорсткі обмеження
      if (currentCycle === 3 || currentCycle === 6) {
        refinementContext.enforced = true; // позначаємо як обов'язкові, не рекомендації
      }
      
      const extraText = await streamTetianaExecute(
        atlasRefine.task_spec, 
        sessionId, 
        res, 
        refinementContext, 
        refinementResources
      );
      
      execText = `${execText}\n\n[REFINEMENT ${currentCycle}]\n${extraText}`;
      
      // Оновлюємо стан сесії після кожного циклу доопрацювання
      updateSessionState(sessionId, currentCycle + 1);
      currentCycle++;
    }
    
    // Після всіх циклів все ще не завершено
    sseSend(res, { type: 'agent_message', agent: 'Grisha', content: '[ГРИША] Після всіх спроб: завдання не вдалося довиконати. Потрібне ручне втручання або додаткові ресурси.' });
    sseSend(res, { type: 'complete', agent: 'system' });
    try { __end?.(); } catch (_) {}
    res.end();
  } else {
    sseSend(res, { type: 'error', agent: 'Grisha', content: 'Відсутній ключ Mistral: неможливо провести перевірку/аудит.' });
    try { __end?.(); } catch (_) {}
    res.end();
  }
  } catch (err) {
    console.error('orchestrator error', err);
    try {
      sseSend(res, { type: 'error', error: err.message || String(err) });
      try { __end?.(); } catch (_) {}
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
  
  // Fallback to Mistral if Gemini is not available
  if (candidateKeys.length === 0 || !candidateKeys[0]) {
    console.log('[Atlas] Gemini API key not configured, falling back to Mistral');
    return await callAtlasViaMistral(userMessage, sessionId, { msps, instruction, sys });
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
    console.warn('Gemini call failed, falling back...', lastErr?.message);
    
    // First try Mistral if available
    if (MISTRAL_API_KEY) {
      try {
        console.log('[Atlas] Trying Mistral fallback');
        return await callAtlasViaMistral(userMessage, sessionId, { msps, instruction: sys, mspsContext });
      } catch (mistralErr) {
        console.error('Mistral fallback failed:', mistralErr.message);
      }
    }
    
    // If Mistral fails or isn't available, try local fallback API
    try {
      console.log('[Atlas] Trying local fallback API');
      const fallbackMessages = [
        { 
          role: 'system', 
          content: sys + '\n\n' + instruction + mspsContext
        },
        { 
          role: 'user', 
          content: userMessage 
        }
      ];
      
      const fallbackResponse = await callFallbackAPI(fallbackMessages, FALLBACK_MODELS.atlas, {
        max_tokens: 2048,
        temperature: 0.7
      });
      
      // Parse the response similar to the original format
      const lines = fallbackResponse.split('\n');
      let userReply = '';
      let jsonStart = -1;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('{') || line.includes('"task_spec"') || line.includes('"intent"')) {
          jsonStart = i;
          break;
        }
        if (jsonStart === -1) {
          userReply += line + ' ';
        }
      }
      
      let taskSpec = {};
      if (jsonStart >= 0) {
        const jsonText = lines.slice(jsonStart).join('\n');
        try {
          taskSpec = JSON.parse(jsonText);
        } catch (jsonErr) {
          console.warn('[Atlas Fallback] Failed to parse JSON, using default task spec');
          taskSpec = {
            intent: 'chat',
            do_not_execute: true,
            description: userMessage,
            tools_needed: [],
            msps_needed: []
          };
        }
      }
      
      return {
        user_reply: (userReply && userReply.trim()) || politeFallbackReply(userMessage),
        task_spec: taskSpec,
        _attemptsUsed: usedAttempts,
        _fallbackUsed: 'local_api',
        _keyUsed: 'fallback'
      };
      
    } catch (fallbackErr) {
      console.error('Local fallback API also failed:', fallbackErr.message);
      
      // Final fallback - return a minimal response
      return {
        user_reply: 'Вибачте, зараз всі системи планування недоступні. Спробуйте пізніше.',
        task_spec: {
          intent: 'chat',
          do_not_execute: true,
          description: userMessage,
          tools_needed: [],
          msps_needed: []
        },
        _attemptsUsed: usedAttempts,
        _fallbackUsed: 'minimal',
        _keyUsed: null
      };
    }
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
  user_reply: userReply || politeFallbackReply(userMessage),
    task_spec: taskSpec || {
      title: 'Задача', summary: userMessage, inputs: [userMessage], steps: [], constraints: [], success_criteria: [], tool_hints: {}
    },
    _attemptsUsed: usedAttempts,
    _keyUsed: keyUsed ? (keyUsed === process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : keyUsed === process.env.GOOGLE_API_KEY ? 'GOOGLE_API_KEY' : 'GENERATIVE_LANGUAGE_API_KEY') : null
  };
}

// Enhanced fallback system using local OpenAI-compatible API
const FALLBACK_API_BASE = process.env.FALLBACK_API_BASE || 'http://localhost:3010/v1';
const FALLBACK_MODELS = {
  atlas: process.env.FALLBACK_ATLAS_MODEL || 'openai/gpt-4o-mini',
  grisha: process.env.FALLBACK_GRISHA_MODEL || 'microsoft/Phi-3.5-mini-instruct'
};

async function callFallbackAPI(messages, model, options = {}) {
  const requestBody = {
    model: model,
    messages: messages,
    max_tokens: options.max_tokens || 2048,
    temperature: options.temperature || 0.7
  };

  const postOnce = async (base) => {
    const url = `${base.replace(/\/$/, '')}/chat/completions`;
    return axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer dummy-key'
      },
      timeout: 45000
    });
  };

  console.log(`[Fallback] Using local API with model: ${model}`);
  try {
    const response = await postOnce(FALLBACK_API_BASE);
    if (response.data?.choices?.[0]) {
      const content = response.data.choices[0].message.content;
      console.log(`[Fallback] Received response from ${model}: ${content.substring(0, 100)}...`);
      return content;
    }
  } catch (error) {
    const status = error?.response?.status;
    const base = String(FALLBACK_API_BASE);
    // Auto-switch between /v1 and /api if a 404 occurs (external providers may expose /api)
    if (status === 404) {
      let altBase = base.includes('/v1') ? base.replace('/v1', '/api') : base.includes('/api') ? base.replace('/api', '/v1') : base + '/v1';
      try {
        console.warn(`[Fallback] ${base} returned 404. Retrying with ${altBase}...`);
        const response = await postOnce(altBase);
        if (response.data?.choices?.[0]) {
          const content = response.data.choices[0].message.content;
          console.log(`[Fallback] Received response from ${model} (alt base): ${content.substring(0, 100)}...`);
          return content;
        }
      } catch (e2) {
        console.error(`[Fallback] Alt base failed:`, e2?.response?.status || e2.message);
        throw e2;
      }
    }
    console.error(`[Fallback] Error calling local API with ${model}:`, error.message);
    throw error;
  }
}

// Fallback function to use Mistral when Gemini fails
async function callAtlasViaMistral(userMessage, sessionId, options = {}) {
  console.log('[Atlas] Using Mistral as Atlas fallback');
  const { msps = [], instruction, sys, mspsContext = '' } = options;
  
  if (!MISTRAL_API_KEY) {
    throw new Error('Mistral API key not configured for Atlas fallback');
  }

  const systemPrompt = sys || prompts.atlas?.system || 'You are Atlas, an AI assistant.';
  const userPrompt = `${instruction}\n\n${mspsContext}\n\nUser: ${userMessage}`;

  try {
    const response = await mistralJsonOnly(
      systemPrompt,
      userPrompt,
      { 
        maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS || 5, 
        temperature: 0.3, 
        sessionId,
        model: MISTRAL_MODEL || 'mistral-small-latest'
      }
    );

    // Parse response similar to Gemini
    let text = '';
    if (typeof response === 'string') {
      text = response;
    } else if (response && response.content) {
      text = response.content;
    } else {
      text = JSON.stringify(response);
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
  user_reply: userReply || politeFallbackReply(userMessage),
      task_spec: taskSpec || {
        title: 'Задача', summary: userMessage, inputs: [userMessage], steps: [], constraints: [], success_criteria: [], tool_hints: {}
      },
      _attemptsUsed: 1,
      _keyUsed: 'MISTRAL_API_KEY (fallback)'
    };
  } catch (error) {
    console.error('[Atlas] Mistral fallback failed:', error.message);
    throw error;
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
  
  // Додаємо MSP контекст, якщо є
  const msps = taskSpec._msps || [];
  let mspsContext = '';
  if (msps.length) {
    const s = JSON.stringify(msps);
    mspsContext = `\n\nДоступні MSP сервери: ${capHead(s, ORCH_MAX_MSPS_CHARS)}`;
  }
  
  // First try Mistral if available
  if (MISTRAL_API_KEY) {
    try {
      console.log('[Grisha] Using primary Mistral API');
      const tsSummary = summarizeTaskSpec(taskSpec);
      const userMessage = `TaskSpecSummary JSON:\n${JSON.stringify(tsSummary)}${mspsContext}`;
      const out = await mistralJsonOnly(sys, userMessage, { maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, temperature: 0, sessionId });
      if (typeof out.isSafe !== 'boolean') out.isSafe = true;
      if (!Array.isArray(out.flagged)) out.flagged = [];
      return out;
    } catch (e) {
      console.warn('Primary Mistral policy check failed:', e.message);
    }
  }
  
  // Fallback to local API
  try {
    console.log('[Grisha] Using local fallback API');
    const tsSummary = summarizeTaskSpec(taskSpec);
    const fallbackMessages = [
      { 
        role: 'system', 
        content: sys
      },
      { 
        role: 'user', 
        content: `TaskSpecSummary JSON:\n${JSON.stringify(tsSummary)}${mspsContext}`
      }
    ];
    
    const fallbackResponse = await callFallbackAPI(fallbackMessages, FALLBACK_MODELS.grisha, {
      max_tokens: 1024,
      temperature: 0.1
    });
    
    // Try to parse JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(fallbackResponse);
    } catch (jsonErr) {
      // If not JSON, create a safe response based on content analysis
      const lowerResponse = fallbackResponse.toLowerCase();
      const containsUnsafe = lowerResponse.includes('unsafe') || 
                           lowerResponse.includes('dangerous') || 
                           lowerResponse.includes('harmful') ||
                           lowerResponse.includes('небезпечн') ||
                           lowerResponse.includes('шкідлив');
      
      parsedResponse = {
        isSafe: !containsUnsafe,
        rationale: fallbackResponse.length > 200 ? fallbackResponse.substring(0, 200) + '...' : fallbackResponse,
        flagged: containsUnsafe ? ['content_analysis'] : [],
        _fallbackUsed: 'local_api'
      };
    }
    
    // Ensure required fields
    if (typeof parsedResponse.isSafe !== 'boolean') parsedResponse.isSafe = true;
    if (!Array.isArray(parsedResponse.flagged)) parsedResponse.flagged = [];
    parsedResponse._fallbackUsed = 'local_api';
    
    return parsedResponse;
    
  } catch (fallbackErr) {
    console.error('Grisha local fallback also failed:', fallbackErr.message);
    
    // Final fallback - safe default (allow with warning)
    console.log('[Grisha] Using safe default response');
    return {
      isSafe: true,
      rationale: 'Системи безпеки тимчасово недоступні. Запит оброблено з базовими правилами.',
      flagged: ['system_unavailable'],
      inter_agent_note_ua: 'Увага: системи безпеки недоступні, використано базову перевірку.',
      _fallbackUsed: 'safe_default'
    };
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
    const out = await mistralJsonOnly(sys, user, { maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, temperature: 0, sessionId });
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

// Check Tetyana's completion status from her execution output
async function checkTetianaCompletionStatus(execText, sessionId) {
  // Якщо execText не визначено, повернути стан за замовчуванням
  if (typeof execText !== 'string') {
    console.warn('[checkTetianaCompletionStatus] execText is undefined or not a string. Returning default status.');
    return { isComplete: false, canContinue: true, reason: 'Executor output was not captured, assuming continuation is possible.' };
  }

  if (!MISTRAL_API_KEY) {
    // Without Mistral, we assume task needs verification
    return { isComplete: false, canContinue: true, reason: 'No AI available to assess completion' };
  }
  
  const sys = `Ти - аналітик завершеності задач. Проаналізуй вивід виконавця (Тетяна) і визнач:
1. isComplete: чи явно сказала Тетяна, що завдання ЗАВЕРШЕНО
2. canContinue: чи може Тетяна продовжити роботу, чи сказала що НЕ МОЖЕ
3. reason: коротке пояснення твого рішення

Відповідь тільки у форматі JSON: {"isComplete": boolean, "canContinue": boolean, "reason": "string"}`;

  const userMessage = `Проаналізуй вивід Тетяни на предмет завершеності:\n\n${execText.slice(-2000)}`;
  
  try {
    const result = await mistralJsonOnly(sys, userMessage, { 
      maxAttempts: 3, 
      temperature: 0.1, 
      sessionId 
    });
    
    return {
      isComplete: result.isComplete || false,
      canContinue: result.canContinue !== false, // default true unless explicitly false
      reason: result.reason || 'Аналіз завершено'
    };
  } catch (e) {
    console.warn('Failed to assess completion status:', e.message);
    return { isComplete: false, canContinue: true, reason: 'Помилка аналізу завершеності' };
  }
}

// Grisha: створює цільові завдання для незалежної перевірки
async function grishaCreateTargetedVerificationTasks(taskSpec, execText, msps = [], context = {}) {
  if (!MISTRAL_API_KEY) throw new Error('Grisha targeted verification requires Mistral API key');
  
  const sys = `Ти - Гріша, експерт з безпеки та верифікації. 
Створи список цільових завдань для перевірки виконання через окремі сесії з виконавцем (Тетяна).
Кожне завдання має бути конкретним і спрямованим на отримання специфічної інформації.

Приклади цільових завдань:
- "Покажи мені скріншоти всіх екранів"
- "Виконай в командному рядку цю команду і скажи вивід"
- "Перевір стан конкретного сервісу"
- "Підтверди наявність конкретного файлу або значення"

Відповідь у JSON: {"tasks": [{"description": "опис завдання", "prompt": "точний промпт для Тетяни"}]}`;

  const tsSummary = summarizeTaskSpec(taskSpec);
  const execTail = capTail(execText || '', ORCH_MAX_EXEC_REPORT_CHARS);
  let userMessage = `TaskSpec: ${JSON.stringify(tsSummary)}\n\nВивід виконавця:\n${execTail}`;
  
  // Додаємо контекст циклу та режиму
  if (context.cycle && context.mode) {
    userMessage += `\n\nЦикл: ${context.cycle}, Режим: ${context.mode}`;
    if (context.recommended) {
      userMessage += `\nРекомендовані ресурси: ${JSON.stringify(context.recommended)}`;
    }
  }
  
  try {
    const result = await mistralJsonOnly(sys, userMessage, { 
      maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, 
      temperature: 0.2, 
      sessionId: context.sessionId 
    });
    
    return Array.isArray(result.tasks) ? result.tasks : [];
  } catch (e) {
    console.warn('Failed to create verification tasks:', e.message);
    return [];
  }
}

// Grisha: аналізує результати всіх верифікаційних завдань і дає вердикт
async function grishaAnalyzeVerificationResults(taskSpec, execText, verificationResults, context = {}) {
  if (!MISTRAL_API_KEY) throw new Error('Grisha verdict requires Mistral API key');
  
  const sys = `Ти - Гріша, суддя завершеності завдань. 
Проаналізуй результати всіх верифікаційних завдань і дай фінальний вердикт.

Відповідь у JSON: {
  "isComplete": boolean,
  "issues": "список проблем",
  "reasoning": "пояснення рішення",
  "detailed_feedback": "детальний аналіз",
  "atlas_refinement_hint": "підказка для Atlas щодо доопрацювання"
}`;

 
  const tsSummary = summarizeTaskSpec(taskSpec);
  const execTail = capTail(execText || '', ORCH_MAX_EXEC_REPORT_CHARS);
  
  let verificationSummary = verificationResults.map((vr, i) => {
    const resultText = (typeof vr.result === 'string') ? vr.result.slice(-500) : '[немає результату]';
    return `Завдання ${i + 1}: ${vr.task}\nРезультат: ${resultText}`;
  }).join('\n\n');
  
  let userMessage = `TaskSpec: ${JSON.stringify(tsSummary)}\n\nОригінальний вивід:\n${execTail}\n\nРезультати верифікації:\n${verificationSummary}`;
  
  if (context.cycle && context.mode) {
    userMessage += `\n\nКонтекст: Цикл ${context.cycle}, Режим ${context.mode}`;
  }
  
  try {
    const result = await mistralJsonOnly(sys, userMessage, { 
      maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, 
      temperature: 0.1, 
      sessionId: context.sessionId 
    });
    
    return {
      isComplete: result.isComplete || false,
      issues: Array.isArray(result.issues) ? result.issues : [],
      reasoning: result.reasoning || 'Аналіз завершено',
      detailed_feedback: result.detailed_feedback || '',
      atlas_refinement_hint: result.atlas_refinement_hint || ''
    };
  } catch (e) {
    console.warn('Failed to analyze verification results:', e.message);
    return { 
      isComplete: false, 
      issues: ['Помилка аналізу верифікації: ' + (e.message || 'невідома помилка')],
      reasoning: 'Технічна помилка під час аналізу'
    };
  }
}

// Tetiana: универсальный стрим произвольного повідомлення
async function streamTetianaMessage(messageText, sessionId, res, options = {}) {
  const secret = process.env.GOOSE_SECRET_KEY;
  const gooseBase = GOOSE_BASE_URL.replace(/\/$/, '');
  const gooseProvider = (await resolveGooseProvider() || '').toLowerCase();

  // FIX: використовуємо локальний префлайт info.json + secrets.yaml
  if (gooseProvider === 'github_copilot') {
    try {
      const tokenCheck = await hasCopilotTokenLocalCached();
      if (!tokenCheck.ok) {
        sseSend(res, { type: 'agent_message', agent: 'Atlas', content: `[ATLAS] Провайдер Tetiana = GitHub Copilot: токен не знайдено/недійсний (${tokenCheck.reason || 'невідомо'}). Переконайтесь, що у ${getGooseConfigDir()}/githubcopilot/info.json є валідний токен або додайте його у secrets.yaml, потім перезапустіть стек.` });
        sseSend(res, { type: 'complete' });
        return '';
      } else {
        console.log(`[Tetiana] Copilot token OK via ${tokenCheck.source}`);
      }
    } catch (e) {
      console.warn('[Preflight][github_copilot] Token check failed:', e?.message || e);
      sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] Не вдалося перевірити GITHUB_COPILOT_TOKEN (помилка префлайту). Перевірте Goose. Запит до Tetiana пропущено.' });
      sseSend(res, { type: 'complete' });
      return '';
    }
  }

  // Автовизначення режиму Goose: web (ws) чи goosed (/reply)
  const isWebDetected = await isGooseWeb(gooseBase);
  // If provider is GitHub Copilot and the flag is enabled, force SSE to avoid WS tool/tool_calls sequencing issues
  const providerForcesSse = ORCH_SSE_FOR_GITHUB_COPILOT && gooseProvider === 'github_copilot';
  const isWeb = (ORCH_FORCE_GOOSE_REPLY || providerForcesSse) ? false : isWebDetected;

  // Guard prompt size to avoid 400 from upstream providers
  const safeMessageText = ensurePromptBounds(messageText, ORCH_MAX_MISTRAL_USER_CHARS, 'Tetiana prompt');
  try {
    const est = estimateTokens(safeMessageText);
  console.log(`[CONTEXT_LIMIT] Tetiana prompt size: chars=${safeMessageText.length}, estTokens=${est}, mode=${isWeb ? 'websocket' : 'sse'}${providerForcesSse ? ' (forced for github_copilot)' : ''}`);
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

    // Add Copilot-Vision-Request header if this is a GitHub Copilot request with potential visual content
    if (gooseProvider === 'github_copilot') {
      // Check if the message contains visual content indicators
      const hasVisualContent = text.toLowerCase().includes('image') ||
                              text.toLowerCase().includes('picture') ||
                              text.toLowerCase().includes('photo') ||
                              text.toLowerCase().includes('screenshot') ||
                              text.toLowerCase().includes('diagram') ||
                              text.includes('data:image') ||
                              text.includes('http') && (text.includes('.png') || text.includes('.jpg') || text.includes('.jpeg') || text.includes('.gif'));

      if (hasVisualContent) {
        headers['Copilot-Vision-Request'] = 'true';
        console.log('[Tetiana][SSE] Added Copilot-Vision-Request header for potential visual content');
      }
    }

    let response;
    try {
      response = await axios.post(url, ssePayload, { headers, responseType: 'stream', timeout: 0 });
    } catch (e) {
      const status = e?.response?.status;
      const msg = `[Tetiana][SSE] POST ${url} failed: ${status || e.message}`;
  const err = new Error(msg);
  // Attach status for upper-level handlers
  err.status = status;
  throw err;
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
      const rawMsg = e?.message || '';
      // Normalize whitespace/newlines so errors split across lines are detectable
      const msg = String(rawMsg).replace(/\s+/g, ' ');
      const tooLong = /model_max_prompt_tokens_exceeded|prompt token count/i.test(msg);
      const notFound = /404|not\s*found/i.test(msg);
      // Robust detection of Copilot tool/tool_calls sequencing error regardless of line breaks
      const toolCallsSeq = /tool_calls.*must\s*be\s*followed\s*by\s*tool\s*messages|tool\s*messages\s*responding\s*to\s*each\s*tool_call_id|messages?\s*with\s*role\s*['"]tool['"][^]*?must\s*be\s*a\s*prece?e?d(?:ing|ent)\s*message\s*with\s*['"]?t\s*o\s*o\s*l\s*_\s*c\s*a\s*l\s*l\s*s['"]/i.test(msg);
      if (tooLong) {
        console.log('[CONTEXT_LIMIT] Goose Web reported token overflow. Falling back to SSE with extra compression...');
        const fallbackMax = Math.max(2000, Math.floor(ORCH_MAX_MISTRAL_USER_CHARS * 0.5));
        const compressed = ensurePromptBounds(messageText, fallbackMax, 'Tetiana prompt (fallback)');
        try {
          const est2 = estimateTokens(compressed);
          console.log(`[CONTEXT_LIMIT] Fallback prompt size: chars=${compressed.length}, estTokens=${est2}`);
        } catch {}
        try {
          return await sendViaSse(compressed);
        } catch (err) {
          if (err?.status === 404) {
            console.log('[SSE_404_NO_FALLBACK] /reply not available on Goose Web. Local fallback disabled; notifying chat...');
            try {
              sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] Не вдалося підключитися до Tetiana через Goose: endpoint /reply недоступний (404) для провайдера GitHub Copilot. Імовірна причина — відсутній або некоректний GITHUB_COPILOT_TOKEN. Локальний фолбек вимкнено. Перевірте токен у Goose Configurator та перезапустіть стек.' });
            } catch (_) {}
            try { sseSend(res, { type: 'complete', agent: 'system' }); } catch (_) {}
            return '';
          }
          throw err;
        }
      } else if (toolCallsSeq) {
        // Goose Web (provider github_copilot) вимагає клієнтських tool messages; переходимо на /reply SSE, який керує інструментами на боці агента
        console.log('[WS_TOOLCALL_FALLBACK] Goose Web reported tool_calls sequencing requirement. Falling back to SSE /reply...');
        try {
          return await sendViaSse();
        } catch (err) {
          if (err?.status === 404) {
            console.log('[SSE_404_NO_FALLBACK] /reply not available on Goose Web. Local fallback disabled; notifying chat...');
            try {
              sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] Для Tetiana потрібен Goose /reply, але він недоступний (404) з провайдером GitHub Copilot. Локальний режим вимкнено. Будь ласка, задайте дійсний GITHUB_COPILOT_TOKEN у Goose Configurator і перезапустіть.' });
            } catch (_) {}
            try { sseSend(res, { type: 'complete', agent: 'system' }); } catch (_) {}
            return '';
          }
          throw err;
        }
      } else if (notFound) {
        console.log('[ROUTE_FALLBACK] Goose Web /ws returned 404; trying /reply SSE...');
        try {
          return await sendViaSse();
        } catch (err) {
          if (err?.status === 404) {
            console.log('[SSE_404_NO_FALLBACK] /reply not available on Goose Web. Local fallback disabled; notifying chat...');
            try {
              sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] Goose Web повернув 404 для /reply. Фолбек на локальну Тетяну відключено. Перевірте доступність Goose і коректність GITHUB_COPILOT_TOKEN.' });
            } catch (_) {}
            try { sseSend(res, { type: 'complete', agent: 'system' }); } catch (_) {}
            return '';
          }
          throw err;
        }
      }
      throw e;
    }
  } else {
    // Потік через goosed /reply (SSE)
    try {
      return await sendViaSse();
    } catch (err) {
      if (err?.status === 404) {
        if (providerForcesSse) {
          // For github_copilot we avoid WS to prevent tool/tool_calls 400; go straight to local fallback
          console.log('[SSE_404_NO_FALLBACK] /reply not available; provider=github_copilot. Local fallback disabled; notifying chat...');
          try {
            sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] /reply недоступний для провайдера GitHub Copilot (404). Локальний фолбек вимкнено. Задайте GITHUB_COPILOT_TOKEN у Goose та перезапустіть стек.' });
          } catch (_) {}
          try { sseSend(res, { type: 'complete', agent: 'system' }); } catch (_) {}
          return '';
        } else {
          // If /reply is missing (common on Goose Web UI), try WebSocket /ws once before local fallback
          console.log('[SSE_404_FALLBACK] /reply 404 on Goose. Trying WebSocket /ws...');
          try {
            return await streamTetianaWs(gooseBase, payload, res, sessionId);
          } catch (wsErr) {
            console.log('[WS_FALLBACK_FAIL_NO_LOCAL] WebSocket path also failed. Local fallback disabled; notifying chat...', wsErr?.message || wsErr);
            try {
              sseSend(res, { type: 'agent_message', agent: 'Atlas', content: '[ATLAS] Не вдалося підключитися до Tetiana ні через /reply, ні через /ws. Локальний фолбек вимкнено. Перевірте роботу Goose та наявність валідного GITHUB_COPILOT_TOKEN.' });
            } catch (_) {}
            try { sseSend(res, { type: 'complete', agent: 'system' }); } catch (_) {}
            return '';
          }
        }
      }
      throw err;
    }
  }
}

// Локальний fallback для Тетяни без Goose: використовує Mistral (якщо є ключ) або локальний OpenAI-сумісний API
async function streamLocalTetianaDirect(messageText, res) {
  try {
    // sseSend(res, { type: 'info', agent: 'Tetiana', content: '[ТЕТЯНА] Працюю в локальному режимі без Goose…' });
    let full = '';
    if (MISTRAL_API_KEY) {
      const sys = 'Ти — Тетяна, практична виконавиця завдань та практикуюча спеціалістка.';
      const out = await mistralChat(sys, ensurePromptBounds(messageText, ORCH_MAX_MISTRAL_USER_CHARS, 'Tetiana prompt (direct)'), { temperature: 0.2 });
      full = String(out || '');
    } else {
      const msgs = [
        { role: 'system', content: 'Ти — Тетяна, практична виконавиця завдань та практикуюча спеціалістка.' },
        { role: 'user', content: ensurePromptBounds(messageText, ORCH_MAX_MISTRAL_USER_CHARS, 'Tetiana prompt (direct)') }
      ];
      full = await callFallbackAPI(msgs, FALLBACK_MODELS.atlas, { max_tokens: 1200, temperature: 0.3 });
    }
    // Стрімімо квазіріалтайм: розбиваємо по абзацах/реченнях
    const chunks = String(full).split(/(?<=[.!?])\s+|\n+/);
    for (const ch of chunks) {
      if (!ch) continue;
      sseSend(res, { type: 'agent_message', agent: 'Tetiana', content: ch });
      await sleep(40);
    }
    return full.trim();
  } catch (err) {
    console.error('[LocalTetiana] Fallback failed:', err.message);
    sseSend(res, { type: 'error', agent: 'Tetiana', content: 'Локальний режим тимчасово недоступний' });
    throw err;
  }
}

// Tetiana: виконання по TaskSpec
async function streamTetianaExecute(taskSpec, sessionId, res, adaptiveContext = {}, recommendedResources = {}) {
  // Гріша перевіряє активні MSP перед виконанням
  let liveMsps = await getAvailableMsps();
  
  // Адаптивна логіка: обмеження MSP на основі циклу та режиму
  if (adaptiveContext.mode === "msp_specific" && recommendedResources?.msps?.length) {
    const isEnforced = adaptiveContext.enforced || adaptiveContext.cycle === 3;
    
    liveMsps = liveMsps.filter(msp => 
      recommendedResources.msps.some(rec => 
        msp.name && msp.name.toLowerCase().includes(rec.toLowerCase())
      )
    );
    
    if (liveMsps.length === 0 && !isEnforced) {
      liveMsps = await getAvailableMsps(); // fallback тільки якщо не обов'язково
    }
  }
  
  let mspsContext = '';
  if (liveMsps.length) {
    const s = JSON.stringify(liveMsps);
    mspsContext = `\n\nАктивні MSP сервери (перевірено Гришею): ${capHead(s, ORCH_MAX_MSPS_CHARS)}`;
    
    if (adaptiveContext.mode === "msp_specific") {
      const enforcementLevel = (adaptiveContext.enforced || adaptiveContext.cycle === 3) ? "ОБОВ'ЯЗКОВО" : "рекомендується";
      mspsContext += `\n\n[АДАПТИВНИЙ РЕЖИМ] Цикл ${adaptiveContext.cycle || 'поточний'}: ${enforcementLevel} використовувати тільки ці MSP сервери: ${recommendedResources?.msps?.join(', ') || 'всі доступні'}.`;
      if (enforcementLevel === "ОБОВ'ЯЗКОВО") {
        mspsContext += ` Не використовуй інші сервери.`;
      }
    } else if (adaptiveContext.mode === "tool_specific") {
      const enforcementLevel = (adaptiveContext.enforced || adaptiveContext.cycle === 6) ? "ОБОВ'ЯЗКОВО виконати step-by-step" : "рекомендується";
      mspsContext += `\n\n[АДАПТИВНИЙ РЕЖИМ] Цикл ${adaptiveContext.cycle || 'поточний'}: ${enforcementLevel} використовувати тільки ці інструменти: ${recommendedResources?.tools?.join(', ') || 'найкращі доступні'}.`;
      if (enforcementLevel.includes("ОБОВ'ЯЗКОВО")) {
        mspsContext += ` Виконуй формальні покрокові інструкції без відхилень.`;
      }
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
      if (err) reject(err); else resolve(collected.trim());
    };

    ws.on('open', () => {
      const content = chatPayload.messages?.[0]?.content?.[0]?.text || '';

      // Check if the message contains visual content indicators for GitHub Copilot
      const hasVisualContent = content.toLowerCase().includes('image') ||
                              content.toLowerCase().includes('picture') ||
                              content.toLowerCase().includes('photo') ||
                              content.toLowerCase().includes('screenshot') ||
                              content.toLowerCase().includes('diagram') ||
                              content.includes('data:image') ||
                              content.includes('http') && (content.includes('.png') || content.includes('.jpg') || content.includes('.jpeg') || content.includes('.gif'));

      const payload = {
        type: 'message',
        content: content,
        session_id: chatPayload.session_id,
        timestamp: Date.now()
      };

      // Add vision request flag if visual content is detected
      if (hasVisualContent) {
        payload.vision_request = true;
        console.log('[Tetiana][WS] Detected potential visual content, added vision_request flag');
      }

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
            // Автовідповідь тимчасово відключена у WS-режимі через можливі конфлікти з провайдером
            // maybeAutoAnswerFromAtlasText(String(content), answeredQuestions, sessionId, res, baseUrl, null, ws).catch(() => {});
            collected += String(content) + '\n';
          }
        } else if (t === 'question' || t === 'frontendToolRequest') {
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
      try { analyzeExecutionOutput(collected, sessionId); } catch {}
      finish();
    });
  });
}

// Автовідповідь Атласа на уточнення Тетяни (використовується у SSE-режимі)
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

    // Показати в UI, що Атлас відповів на уточнення (для прозорості)
    sseSend(res, { type: 'agent_message', agent: 'Atlas', content: reply });
  } catch (_) {
    // тихо ігноруємо збої авто-відповіді
  }
}

// Визначаємо, чи текст є уточнюючим питанням; якщо так — авто-відповідь Атласа
async function maybeAutoAnswerFromAtlasText(text, answeredSet, sessionId, res, gooseBase, secret, wsOpt) {
  try {
    const snippet = String(text || '').trim();
    if (!snippet || snippet.length < 3) return;
    // Антидедуплікація
    const key = snippet.toLowerCase().slice(0, 160);
    if (answeredSet.has(key)) return;

    // Класифікація через Atlas: питання-уточнення чи ні
    const classifierSystem = prompts.atlas?.classifier_system || 'You are a concise classifier. Answer strictly yes or no.';
    const classificationPrompt = `${classifierSystem}\nВизнач: чи є цей текст уточнюючим питанням (yes/no): "${snippet}". Виведи лише yes або no.`;
    const ans = await callAtlas(classificationPrompt, sessionId);
    const label = String(ans?.user_reply || '').trim().toLowerCase();
    if (label !== 'yes') return;
    answeredSet.add(key);

    // Автовідповідь від Атласа
    await autoAnswerFromAtlas(snippet, sessionId, res, gooseBase, secret, wsOpt);
  } catch (_) {
    // мовчазно ігноруємо помилки
  }
}

// === Goose/Copilot token preflight (file-based) ===
let __copilotTokenCache = { ok: null, ts: 0, reason: '', source: '' };

function getGooseConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  // Support both layouts:
  // 1) XDG/goose (when XDG_CONFIG_HOME points to ~/.config or repo/goose)
  // 2) repo-local goose/.config/goose (common in this repo)
  const candidates = [];
  // If XDG already ends with '.config', prefer <XDG>/goose
  if (/\.config\/?$/.test(xdg)) {
    candidates.push(path.join(xdg, 'goose'));
  }
  // If XDG points to repo/goose, our older scripts expected <XDG>/goose
  candidates.push(path.join(xdg, 'goose'));
  // Repo-local fallback: <repo>/goose/.config/goose
  try {
    const repoRoot = process.cwd();
    candidates.push(path.join(repoRoot, 'goose', '.config', 'goose'));
  } catch {}

  for (const dir of candidates) {
    try { if (fs.existsSync(dir)) return dir; } catch {}
  }
  // Fallback to <XDG>/goose
  return path.join(xdg, 'goose');
}

function readCopilotInfoJson() {
  try {
    const primary = path.join(getGooseConfigDir(), 'githubcopilot', 'info.json');
    const alt = (() => {
      try { const repoRoot = process.cwd(); return path.join(repoRoot, 'goose', '.config', 'goose', 'githubcopilot', 'info.json'); } catch { return null; }
    })();
    const p = fs.existsSync(primary) ? primary : (alt && fs.existsSync(alt) ? alt : null);
    if (!p) return { ok: false, reason: 'info.json not found' };
    const raw = fs.readFileSync(p, 'utf-8');
    const j = JSON.parse(raw);

    // Більш толерантний парсер: допускаємо token/expires_at як у root, так і в info{}
    const token = (j && (j.token || j?.info?.token)) || null;
    if (!token || typeof token !== 'string' || token.trim().length < 16) {
      return { ok: false, reason: 'token missing in info.json' };
    }
    // epoch (число) або ISO-рядок у root/info
    let expEpoch = Number(j?.info?.expires_at);
    if (!Number.isFinite(expEpoch)) expEpoch = Number(j?.expires_at);
    if (!Number.isFinite(expEpoch)) {
      const iso = j?.expires_at || j?.info?.expires_at_iso || j?.info?.expires_at_str || null;
      if (!iso) return { ok: false, reason: 'expires_at missing' };
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return { ok: false, reason: 'expires_at invalid' };
      expEpoch = Math.floor(t / 1000);
    }
    const now = Math.floor(Date.now() / 1000);
    if (expEpoch <= now + 60) return { ok: false, reason: 'token expired in info.json' };
    return { ok: true, source: 'info.json' };
  } catch (e) {
    return { ok: false, reason: `info.json error: ${e.message}` };
  }
}

function readCopilotTokenFromSecretsYaml() {
  try {
    const primary = path.join(getGooseConfigDir(), 'secrets.yaml');
    const alt = (() => {
      try { const repoRoot = process.cwd(); return path.join(repoRoot, 'goose', '.config', 'goose', 'secrets.yaml'); } catch { return null; }
    })();
    const p = fs.existsSync(primary) ? primary : (alt && fs.existsSync(alt) ? alt : null);
    if (!p) return { ok: false, reason: 'secrets.yaml not found' };
    const raw = fs.readFileSync(p, 'utf-8');
    // простий парсер YAML-рядка ключа (без зовнішніх залежностей)
    const m = raw.match(/^\s*GITHUB_COPILOT_TOKEN\s*:\s*(.+)\s*$/m);
    if (!m) return { ok: false, reason: 'GITHUB_COPILOT_TOKEN not in secrets.yaml' };
    let v = m[1].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (!v || v.toLowerCase() === 'null') return { ok: false, reason: 'empty token in secrets.yaml' };
    return { ok: true, source: 'secrets.yaml' };
  } catch (e) {
    return { ok: false, reason: `secrets.yaml error: ${e.message}` };
  }
}

async function hasCopilotTokenLocalCached() {
  const now = Date.now();
  if (now - __copilotTokenCache.ts < 4000 && __copilotTokenCache.ok !== null) {
    return __copilotTokenCache;
  }
  // 1) пріоритет — info.json
  let res = readCopilotInfoJson();
  if (!res.ok) {
    // 2) fallback — secrets.yaml (GOOSE_DISABLE_KEYRING=1)
    const res2 = readCopilotTokenFromSecretsYaml();
    res = res2.ok ? res2 : res; // якщо yaml ок — беремо його; інакше зберігаємо причину з info.json
  }
  __copilotTokenCache = { ...res, ts: now };
  return __copilotTokenCache;
}

// Десь у вході стріму Тетяни, ДО будь-яких запитів до Goose:
/*
if (provider === 'github_copilot') {
  const tokenCheck = await hasCopilotTokenLocalCached();
  if (!tokenCheck.ok) {
    log.warn(`[Tetiana] Copilot token preflight failed: ${tokenCheck.reason}`);
    // надіслати SSE у чат і завершити
    sendSseAgentMessage('Atlas', 
      `Провайдер Tetiana = GitHub Copilot: токен не знайдено/прострочено (${tokenCheck.reason}). ` +
      `Переконайтесь, що у ${getGooseConfigDir()}/githubcopilot/info.json є чинний токен або додайте його у secrets.yaml, ` +
      `потім перезапустіть стек.`);
    sendSseComplete();
    return;
  } else {
    log.info(`[Tetiana] Copilot token OK via ${tokenCheck.source}`);
  }
}
*/

// Helper function to clean user reply
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

// Helper for polite short fallback reply in Ukrainian
function politeFallbackReply(userMessage) {
  const msg = String(userMessage || '').trim();
  if (!msg) return 'Дякую, прийняв запит. Зараз підготую відповідь.';
  // коротка ввічлива відповідь без зайвих префіксів
  const maxLen = 320;
  const echo = msg.length > maxLen ? msg.slice(0, maxLen) + '…' : msg;
  return `Коротко по суті: ${echo}`;
}

// Запуск сервера
app.listen(ORCH_PORT, () => {
  console.log(`Orchestrator running on http://127.0.0.1:${ORCH_PORT}`);
  console.log(`Smart Context Summarization: ${contextSummarizer.maxContextTokens} max tokens, ${Math.round(contextSummarizer.summaryRatio * 100)}% summary ratio`);
});
