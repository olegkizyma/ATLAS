// Agent memory persistence (lightweight) using SQLite (better-sqlite3)
// Stores per-agent key/value facts with recency & simple TTL pruning.
import Database from 'better-sqlite3';

const DB_PATH = process.env.ATLAS_MEMORY_DB || './agent_memory.db';
const MAX_FACTS_PER_AGENT = parseInt(process.env.ATLAS_MEMORY_MAX_FACTS || '200', 10);
const DEFAULT_TTL_MS = parseInt(process.env.ATLAS_MEMORY_TTL_MS || (1000*60*60*24*3).toString(), 10); // 3 days

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
  return db;
}

export function remember(agent, key, value) {
  init();
  const now = Date.now();
  const up = db.prepare('UPDATE agent_facts SET fact_value=?, updated_at=? WHERE agent=? AND fact_key=?');
  const result = up.run(value, now, agent, key);
  if (result.changes === 0) {
    db.prepare('INSERT INTO agent_facts(agent,fact_key,fact_value,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(agent, key, value, now, now);
  try { globalThis.PIPELINE_METRICS && (globalThis.PIPELINE_METRICS.memoryFactsWritten++); } catch(_) {}
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
export function summarizeRanked(agent, { limit = 10, halfLifeMinutes = 180 } = {}) {
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
