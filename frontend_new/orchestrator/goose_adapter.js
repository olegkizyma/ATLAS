// Goose Adapter (Phase 2)
// Unified execution interface for Tetyana & Grisha verification flows
// Abstracts WebSocket + SSE fallback and tool enable flags
import axios from 'axios';
import WebSocket from 'ws';
import os from 'os';
import path from 'path';

const DEFAULT_BASE = (process.env.GOOSE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const SECRET = process.env.GOOSE_SECRET_KEY || 'test';

export async function runExecution(message, sessionId, { enableTools = false, systemInstruction, workingDirHint } = {}) {
  const baseUrl = DEFAULT_BASE;
  const workingDir = workingDirHint ? resolveWorkingDir(workingDirHint) : process.cwd();
  // Prefer tools via SSE when enableTools true
  if (enableTools) {
    const sse = await callSSE(baseUrl, message, sessionId, { enableTools: true, systemInstruction, workingDir });
    if (sse) return sse;
  }
  // WebSocket path (no tools)
  const ws = await callWS(baseUrl, message, sessionId);
  if (ws) return ws;
  // Fallback SSE without tools
  return await callSSE(baseUrl, message, sessionId, { enableTools: false, systemInstruction, workingDir });
}

function resolveWorkingDir(hint) {
  if (!hint) return process.cwd();
  const lower = hint.toLowerCase();
  if (/desktop|робоч(ий|ому) стол/.test(lower)) {
    return path.join(os.homedir(), 'Desktop');
  }
  return process.cwd();
}

async function callWS(baseUrl, message, sessionId) {
  return new Promise((resolve) => {
    try {
      const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
      const ws = new WebSocket(wsUrl);
      let collected = '';
      let timeout = setTimeout(() => { try { ws.close(); } catch{} resolve(null); }, 15000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'message', content: message, session_id: sessionId, timestamp: Date.now() }));
      });
      ws.on('message', data => {
        try {
          const obj = JSON.parse(data.toString());
          if (obj.type === 'response' && obj.content) collected += String(obj.content);
          if (obj.type === 'complete' || obj.type === 'cancelled') { clearTimeout(timeout); ws.close(); resolve(collected.trim() || ''); }
          if (obj.type === 'error') { clearTimeout(timeout); ws.close(); resolve(null); }
        } catch { /* ignore */ }
      });
      ws.on('error', () => { clearTimeout(timeout); resolve(null); });
      ws.on('close', () => { clearTimeout(timeout); if (collected.trim()) resolve(collected.trim()); else resolve(null); });
    } catch { resolve(null); }
  });
}

async function callSSE(baseUrl, message, sessionId, { enableTools, systemInstruction, workingDir }) {
  try {
    const url = baseUrl + '/reply';
    const headers = { 'Accept': 'text/event-stream', 'Content-Type': 'application/json', 'X-Secret-Key': SECRET };
    const messages = [];
    if (systemInstruction) messages.push({ role: 'system', created: ts(), content: [{ type: 'text', text: systemInstruction }] });
    messages.push({ role: 'user', created: ts(), content: [{ type: 'text', text: message }] });
    const payload = { messages, session_id: sessionId, session_working_dir: workingDir, ...(enableTools ? { tool_choice: 'auto' } : {}) };
    const response = await axios.post(url, payload, { headers, timeout: 20000, responseType: 'stream' });
    if (response.status !== 200) return null;
    return await new Promise(resolve => {
      let collected = '';
      response.data.on('data', chunk => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
            try {
              const obj = JSON.parse(dataStr);
              if (obj.type === 'Message' && obj.message?.content) {
                for (const c of obj.message.content) if (c.type === 'text' && c.text) collected += c.text;
              } else if (obj.text) collected += obj.text;
            } catch { if (dataStr && !dataStr.startsWith('[')) collected += dataStr; }
        }
      });
      response.data.on('end', () => resolve(collected.trim() || ''));
      response.data.on('error', () => resolve(collected.trim() || null));
    });
  } catch { return null; }
}

const ts = () => Math.floor(Date.now()/1000);

// Enhanced evidence extractor (Phase 2)
export function extractEvidence(rawText) {
  if (!rawText) return { files: [], commands: [], outputs: [], summary: '' };
  const text = String(rawText);
  // File path heuristics (absolute or relative with extension)
  const fileRe = /(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})(?=\b)/g;
  const files = Array.from(new Set(Array.from(text.matchAll(fileRe)).map(m => m[1])).values()).slice(0,8);
  // Commands inside backticks or lines starting with $ or >
  const inlineCmd = /`([^`\n]{2,120})`/g;
  const lineCmd = /^(?:\s*[>$] )([^\n]{2,160})$/gm;
  const commands = Array.from(new Set([
    ...Array.from(text.matchAll(inlineCmd)).map(m=>m[1].trim()),
    ...Array.from(text.matchAll(lineCmd)).map(m=>m[1].trim())
  ].filter(Boolean))).slice(0,8);
  // Outputs = fenced code blocks content (truncate)
  const fence = /```[a-zA-Z0-9]*\n([\s\S]*?)```/g;
  const outputs = Array.from(text.matchAll(fence)).map(m => m[1].trim().slice(0,500)).slice(0,5);
  // Summary: first РЕЗЮМЕ section or first 2 sentences
  let summary = '';
  const resumeMatch = text.match(/РЕЗЮМЕ[:\-]?\s*([\s\S]{0,400}?)(?:\n\n|КРОКИ:|$)/i);
  if (resumeMatch) summary = resumeMatch[1].trim();
  if (!summary) summary = text.split(/\n+/).slice(0,3).join(' ').slice(0,300);
  return { files, commands, outputs, summary };
}

export default { runExecution, extractEvidence };