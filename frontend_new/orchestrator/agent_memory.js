// Agent memory persistence (lightweight) using SQLite (better-sqlite3)
// Stores per-agent key/value facts with recency & simple TTL pruning.
import Database from 'better-sqlite3';
import crypto from 'crypto';
import axios from 'axios';

const DB_PATH = process.env.ATLAS_MEMORY_DB || './agent_memory.db';
const MAX_FACTS_PER_AGENT = parseInt(process.env.ATLAS_MEMORY_MAX_FACTS || '200', 10);
const DEFAULT_TTL_MS = parseInt(process.env.ATLAS_MEMORY_TTL_MS || (1000*60*60*24*3).toString(), 10); // 3 days
const FACT_VALUE_MAX_LEN = parseInt(process.env.ATLAS_MEMORY_VALUE_MAX || '800', 10); // safeguard to avoid huge prompt injections
const DEFAULT_HALF_LIFE_MIN = parseInt(process.env.ATLAS_MEMORY_HALFLIFE_MIN || '180', 10); // configurable for summarizeRanked
const EMBEDDINGS_ENABLED = process.env.ATLAS_MEMORY_EMBEDDINGS === '1';
const EMBED_MODEL = process.env.ATLAS_EMBED_MODEL || 'text-embedding-3-small';
const EMBED_BASE = (process.env.ATLAS_EMBED_BASE || process.env.FALLBACK_API_BASE || 'http://127.0.0.1:3010/v1').replace(/\/$/,'');
const EMBED_DIM = parseInt(process.env.ATLAS_MEMORY_EMBED_DIM || '384', 10);
const EMBED_HASH_FALLBACK_DIM = 128;
const OPTIMIZE_INTERVAL_MS = parseInt(process.env.ATLAS_MEMORY_OPTIMIZE_INTERVAL_MS || (10*60*1000).toString(), 10);
const AUTO_VACUUM = process.env.ATLAS_MEMORY_AUTO_VACUUM === '1';

// Simple in-process recent hash dedup (key+hash -> ts)
const recentHashes = new Map();
const RECENT_HASH_WINDOW_MS = 60_000; // 60s

let db;
function init() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS agent_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_facts_agent_key ON agent_facts(agent,fact_key);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_facts_agent_time ON agent_facts(agent,updated_at);`);
  if (EMBEDDINGS_ENABLED) {
    db.exec(`CREATE TABLE IF NOT EXISTS agent_fact_embeddings (
      fact_id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      fact_key TEXT NOT NULL,
      embedding TEXT NOT NULL, -- JSON array of floats
      dim INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(fact_id) REFERENCES agent_facts(id) ON DELETE CASCADE
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fact_embed_agent ON agent_fact_embeddings(agent);`);
  }
  return db;
}

export function remember(agent, key, value) {
  init();
  const now = Date.now();
  if (typeof value === 'string' && value.length > FACT_VALUE_MAX_LEN) {
    value = value.slice(0, FACT_VALUE_MAX_LEN) + '…';
  }
  // Hash-based dedup: if exact same (agent,key,value) seen very recently skip
  try {
    const h = crypto.createHash('sha1').update(agent+'\0'+key+'\0'+value).digest('hex');
    const prev = recentHashes.get(h);
    if (prev && (now - prev) < RECENT_HASH_WINDOW_MS) return; // skip duplicate
    recentHashes.set(h, now);
  } catch {}
  const up = db.prepare('UPDATE agent_facts SET fact_value=?, updated_at=? WHERE agent=? AND fact_key=?');
  const result = up.run(value, now, agent, key);
  if (result.changes === 0) {
    db.prepare('INSERT INTO agent_facts(agent,fact_key,fact_value,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(agent, key, value, now, now);
  try { globalThis.PIPELINE_METRICS && (globalThis.PIPELINE_METRICS.memoryFactsWritten++); } catch(_) {}
  } else {
    // treat update as activity write if wanting full activity metric (optional):
    try { if (process.env.ATLAS_MEMORY_COUNT_UPDATES === '1') globalThis.PIPELINE_METRICS && (globalThis.PIPELINE_METRICS.memoryFactsWritten++); } catch {}
  }
  if (EMBEDDINGS_ENABLED) {
    try { upsertEmbedding(agent, key, value); } catch {}
  }
  prune(agent);
}

export function recall(agent, pattern = null, limit = 20) {
  init();
  if (pattern) {
    return db.prepare('SELECT fact_key,fact_value,updated_at FROM agent_facts WHERE agent=? AND fact_key LIKE ? ORDER BY updated_at DESC LIMIT ?')
      .all(agent, `%${pattern}%`, limit);
  }
  return db.prepare('SELECT fact_key,fact_value,updated_at FROM agent_facts WHERE agent=? ORDER BY updated_at DESC LIMIT ?')
    .all(agent, limit);
}

export function forget(agent, key) {
  init();
  db.prepare('DELETE FROM agent_facts WHERE agent=? AND fact_key=?').run(agent, key);
}

export function prune(agent) {
  init();
  const total = db.prepare('SELECT COUNT(1) as c FROM agent_facts WHERE agent=?').get(agent)?.c || 0;
  if (total > MAX_FACTS_PER_AGENT) {
    const excess = total - MAX_FACTS_PER_AGENT;
    db.prepare(`DELETE FROM agent_facts WHERE id IN (
      SELECT id FROM agent_facts WHERE agent=? ORDER BY updated_at ASC LIMIT ?
    )`).run(agent, excess);
    try { globalThis.PIPELINE_METRICS && (globalThis.PIPELINE_METRICS.memoryFactsPruned += excess); } catch(_) {}
  }
  const cutoff = Date.now() - DEFAULT_TTL_MS;
  const staleDel = db.prepare('DELETE FROM agent_facts WHERE agent=? AND updated_at < ?').run(agent, cutoff);
  if (staleDel.changes) { try { globalThis.PIPELINE_METRICS && (globalThis.PIPELINE_METRICS.memoryFactsPruned += staleDel.changes); } catch(_) {} }
}

export function summarizeRecent(agent, limit = 10) {
  const rows = recall(agent, null, limit);
  if (!rows.length) return '';
  return rows.map(r => `- ${r.fact_key}: ${r.fact_value}`).join('\n');
}

export function initMemory() { init(); }

// Ranked summarization: recency decay + pseudo-frequency (same key updates)
export function summarizeRanked(agent, { limit = 10, halfLifeMinutes = DEFAULT_HALF_LIFE_MIN } = {}) {
  init();
  // Pull more than needed, then score
  const rows = recall(agent, null, limit * 4);
  if (!rows.length) return '';
  const now = Date.now();
  const halfLifeMs = halfLifeMinutes * 60 * 1000;
  // Group by key to approximate frequency
  const grouped = {};
  for (const r of rows) {
    grouped[r.fact_key] = grouped[r.fact_key] || { key: r.fact_key, latest: r.updated_at, samples: [] };
    grouped[r.fact_key].samples.push(r);
    if (r.updated_at > grouped[r.fact_key].latest) grouped[r.fact_key].latest = r.updated_at;
  }
  const scored = Object.values(grouped).map(g => {
    const ageMs = now - g.latest;
    const recencyWeight = Math.pow(0.5, ageMs / halfLifeMs); // exponential decay
    const freq = g.samples.length; // simple frequency
    const score = recencyWeight * (1 + Math.log2(freq + 1));
    return { key: g.key, score, latest: g.latest, freq, sample: g.samples[0] };
  }).sort((a,b) => b.score - a.score).slice(0, limit);
  return scored.map(s => `- ${s.key} (f=${s.freq},score=${s.score.toFixed(2)}): ${s.sample.fact_value}`).join('\n');
}

// Higher level helper to produce memory block respecting approx token target
// Assumes ~4 chars per token heuristic.
export function summarizeForPrompt(agent, { targetTokens = 400, halfLifeMinutes = DEFAULT_HALF_LIFE_MIN } = {}) {
  init();
  const approxChars = targetTokens * 4;
  const baseLimit = Math.min(50, Math.max(5, Math.floor(targetTokens / 20))); // heuristic mapping
  let block = summarizeRanked(agent, { limit: baseLimit, halfLifeMinutes });
  if (block.length > approxChars) {
    // trim lines from the end until meets size
    const lines = block.split(/\n/);
    while (lines.join('\n').length > approxChars && lines.length > 3) lines.pop();
    block = lines.join('\n');
  }
  try { globalThis.PIPELINE_METRICS && (globalThis.PIPELINE_METRICS.memoryContextTokens += Math.round(block.length/4)); } catch {}
  try { globalThis.PIPELINE_METRICS && (globalThis.PIPELINE_METRICS.memoryContextInjections++); } catch {}
  return block;
}

// Safe remember (moved from server.js for reuse)
const __recentMemoryCache = new Map(); // key -> {v, ts}
export function rememberSafe(agent, key, value) {
  try {
    const cacheKey = agent+':'+key;
    const prev = __recentMemoryCache.get(cacheKey);
    if (prev && prev.v === value && (Date.now()-prev.ts) < 60_000) return; // skip duplicate within 60s
    remember(agent, key, value);
    __recentMemoryCache.set(cacheKey, { v: value, ts: Date.now() });
  } catch {}
}

export function memoryHealth() {
  init();
  const perAgent = {};
  const agents = db.prepare('SELECT DISTINCT agent FROM agent_facts').all().map(r=>r.agent);
  const now = Date.now();
  for (const a of agents) {
    const row = db.prepare('SELECT COUNT(*) as c, MIN(updated_at) as oldest, MAX(updated_at) as newest FROM agent_facts WHERE agent=?').get(a);
    let embedCount = null;
    if (EMBEDDINGS_ENABLED) {
      try { embedCount = db.prepare('SELECT COUNT(*) as c FROM agent_fact_embeddings WHERE agent=?').get(a)?.c || 0; } catch {}
    }
    perAgent[a] = {
      count: row.c,
      oldestMsAgo: row.oldest ? now - row.oldest : null,
      newestMsAgo: row.newest ? now - row.newest : null,
      embeddings: embedCount
    };
  }
  return { perAgent, maxFacts: MAX_FACTS_PER_AGENT, ttlMs: DEFAULT_TTL_MS, embeddingsEnabled: EMBEDDINGS_ENABLED };
}

// ---------------- Embeddings Support ----------------
async function fetchRemoteEmbedding(text) {
  const apiKey = process.env.OPENAI_COMPAT_API_KEY || process.env.FALLBACK_API_KEY || '';
  const url = `${EMBED_BASE}/embeddings`;
  const payload = { model: EMBED_MODEL, input: text };
  const headers = { 'Content-Type':'application/json', ...(apiKey ? { 'Authorization':`Bearer ${apiKey}` }: {}) };
  const resp = await axios.post(url, payload, { headers, timeout: 15000 });
  const arr = resp.data?.data?.[0]?.embedding;
  if (Array.isArray(arr)) return arr.map(Number);
  throw new Error('invalid embedding response');
}

function hashFallbackEmbedding(text) {
  // Simple hashing to fixed dim when remote embeddings not available; not true semantic but stable.
  const dim = EMBED_HASH_FALLBACK_DIM;
  const vec = new Array(dim).fill(0);
  const words = String(text).toLowerCase().split(/[^a-z0-9а-яіїєёґ]+/i).filter(Boolean);
  for (const w of words) {
    const h = crypto.createHash('sha1').update(w).digest();
    // take first two bytes as index
    const idx = (h[0] << 8 | h[1]) % dim;
    vec[idx] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s,v)=>s+v*v,0)) || 1;
  return vec.map(v=>v/norm);
}

function cosine(a,b) {
  let s=0; for (let i=0;i<Math.min(a.length,b.length);i++) s += a[i]*b[i];
  return s;
}

function upsertEmbedding(agent, key, value) {
  init();
  const fact = db.prepare('SELECT id, fact_value FROM agent_facts WHERE agent=? AND fact_key=?').get(agent, key);
  if (!fact) return;
  const now = Date.now();
  let emb = null;
  if (EMBEDDINGS_ENABLED) {
    try {
      if (process.env.ATLAS_MEMORY_EMBED_REMOTE === '1') {
        // remote
        // Note: caller not awaited (fire & forget) if remote to avoid blocking main path
        fetchRemoteEmbedding(fact.fact_value).then(vec => {
          const stmt = db.prepare('REPLACE INTO agent_fact_embeddings(fact_id,agent,fact_key,embedding,dim,updated_at) VALUES (?,?,?,?,?,?)');
          stmt.run(fact.id, agent, key, JSON.stringify(vec), vec.length, now);
        }).catch(()=>{
          const vec = hashFallbackEmbedding(fact.fact_value);
          db.prepare('REPLACE INTO agent_fact_embeddings(fact_id,agent,fact_key,embedding,dim,updated_at) VALUES (?,?,?,?,?,?)')
            .run(fact.id, agent, key, JSON.stringify(vec), vec.length, now);
        });
        return;
      } else {
        emb = hashFallbackEmbedding(fact.fact_value);
      }
    } catch {
      emb = hashFallbackEmbedding(fact.fact_value);
    }
    if (emb) {
      db.prepare('REPLACE INTO agent_fact_embeddings(fact_id,agent,fact_key,embedding,dim,updated_at) VALUES (?,?,?,?,?,?)')
        .run(fact.id, agent, key, JSON.stringify(emb), emb.length, now);
    }
  }
}

export function semanticSearch(agent, query, { topK = 5 } = {}) {
  if (!EMBEDDINGS_ENABLED) return [];
  init();
  let queryVec;
  try {
    if (process.env.ATLAS_MEMORY_EMBED_REMOTE === '1') {
      // synchronous remote may block; keep small timeout by wrapping promise with de-sync attempt
      // NOTE: to keep sync API we fallback to hash here
      queryVec = hashFallbackEmbedding(query);
    } else {
      queryVec = hashFallbackEmbedding(query);
    }
  } catch { return []; }
  const rows = db.prepare('SELECT e.embedding, f.fact_key, f.fact_value FROM agent_fact_embeddings e JOIN agent_facts f ON f.id = e.fact_id WHERE e.agent=?').all(agent);
  if (!rows.length) return [];
  const scored = [];
  for (const r of rows) {
    try {
      const vec = JSON.parse(r.embedding);
      const score = cosine(queryVec, vec);
      scored.push({ key: r.fact_key, value: r.fact_value, score });
    } catch {}
  }
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0, topK);
}

export function semanticContext(agent, query, { topK=5, maxChars=800 }={}) {
  const res = semanticSearch(agent, query, { topK });
  if (!res.length) return '';
  let lines = res.map(r=>`- ${r.key} (sim=${r.score.toFixed(2)}): ${r.value}`);
  let txt = lines.join('\n');
  if (txt.length > maxChars) {
    while (txt.length > maxChars && lines.length > 2) { lines.pop(); txt = lines.join('\n'); }
  }
  return txt;
}

let maintenanceStarted = false;
export function startMemoryMaintenance() {
  if (maintenanceStarted) return;
  maintenanceStarted = true;
  if (OPTIMIZE_INTERVAL_MS <= 0) return;
  setInterval(()=>{
    try {
      if (!db) return;
      db.pragma('optimize');
      if (AUTO_VACUUM) db.exec('VACUUM');
    } catch {}
  }, OPTIMIZE_INTERVAL_MS).unref();
}
