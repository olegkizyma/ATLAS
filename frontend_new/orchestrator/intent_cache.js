// Intent Router LRU Cache (Phase 2 completion)
// 64-item cache with TTL for intent classification results
export class IntentCache {
  constructor(maxSize = 64, ttlMs = 300000) { // 5min TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map(); // key -> { intent, reply, timestamp }
  }

  normalizeKey(message) {
    return String(message || '').trim().toLowerCase().slice(0, 200);
  }

  get(message) {
    const key = this.normalizeKey(message);
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // TTL check
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    
    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { intent: entry.intent, reply: entry.reply };
  }

  set(message, intent, reply) {
    const key = this.normalizeKey(message);
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      intent,
      reply,
      timestamp: Date.now()
    });
  }

  size() {
    return this.cache.size;
  }

  clear() {
    this.cache.clear();
  }
}
