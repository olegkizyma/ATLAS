// utils.js - Utility functions extracted from server.js
import axios from 'axios';

// Cap string to head N characters
export function capHead(str, maxLen) {
  if (!str || typeof str !== 'string') return '';
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '…';
}

// Cap string to tail N characters  
export function capTail(str, maxLen) {
  if (!str || typeof str !== 'string') return '';
  return str.length <= maxLen ? str : '…' + str.slice(-maxLen);
}

// Token estimation (rough approximation)
export function estimateTokens(text) {
  if (!text) return 0;
  // Rough approximation: 1 token ≈ 4 characters for most languages
  return Math.ceil(text.length / 4);
}

// Ensure prompt bounds
export function ensurePromptBounds(text, maxChars, label = 'prompt') {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= maxChars) return text;
  
  const truncated = text.slice(0, maxChars - 20) + '\n[TRUNCATED...]';
  console.log(`[BOUNDS] ${label} truncated: ${text.length} -> ${truncated.length} chars`);
  return truncated;
}

// Sleep utility
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Backoff delay calculation
export function backoffDelay(attempt, baseMs = 400, maxMs = 8000, jitterMs = 400) {
  const delay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  const jitter = Math.random() * jitterMs;
  return delay + jitter;
}

// TaskSpec summarization
export function summarizeTaskSpec(ts) {
  if (!ts || typeof ts !== 'object') return ts;
  
  return {
    title: capHead(ts.title || 'Untitled', 100),
    summary: capHead(ts.summary || '', 300),
    inputs: Array.isArray(ts.inputs) ? ts.inputs.map(i => capHead(String(i), 200)) : [],
    steps: Array.isArray(ts.steps) ? ts.steps.slice(0, 10).map(s => capHead(String(s), 200)) : [],
    constraints: Array.isArray(ts.constraints) ? ts.constraints.slice(0, 5).map(c => capHead(String(c), 150)) : [],
    success_criteria: Array.isArray(ts.success_criteria) ? ts.success_criteria.slice(0, 8).map(sc => capHead(String(sc), 200)) : [],
    tool_hints: ts.tool_hints || {},
    intent: ts.intent || 'task',
    do_not_execute: ts.do_not_execute || false
  };
}

// Clean user reply
export function cleanUserReply(reply) {
  if (!reply || typeof reply !== 'string') return '';
  return reply
    .replace(/^(user_reply:\s*|відповідь:\s*)/i, '')
    .replace(/\n*$/, '')
    .trim();
}

// Mistral JSON-only call
export async function mistralJsonOnly(systemPrompt, userPrompt, options = {}) {
  const { maxAttempts = 3, temperature = 0, sessionId } = options;
  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest';
  
  if (!MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY not configured');
  }

  const payload = {
    model: MISTRAL_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: temperature
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post('https://api.mistral.ai/v1/chat/completions', payload, {
        headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` },
        timeout: 45000
      });

      const text = response.data?.choices?.[0]?.message?.content || '';
      if (!text) {
        throw new Error('Empty response from Mistral');
      }

      // Try to parse JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          parsed._attemptsUsed = attempt;
          return parsed;
        } catch (parseErr) {
          throw new Error(`Invalid JSON in response: ${parseErr.message}`);
        }
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      
      // Exponential backoff for retryable errors
      if (status === 429 || status >= 500) {
        if (attempt < maxAttempts) {
          const delay = backoffDelay(attempt);
          await sleep(delay);
          continue;
        }
      }
      
      // Don't retry for client errors (4xx except 429)
      if (status >= 400 && status < 500 && status !== 429) {
        break;
      }
    }
  }
  throw new Error(`Failed to obtain valid JSON from Mistral after ${maxAttempts} attempts: ${lastErr?.message || 'unknown error'}`);
}