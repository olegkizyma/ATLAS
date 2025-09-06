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

// Enhanced evidence extractor (Phase 2) with weighting and structured parsing
export function extractEvidence(rawText) {
  if (!rawText) return { files: [], commands: [], outputs: [], summary: '', score: 0 };
  
  const text = String(rawText);
  let evidenceScore = 0;
  
  // Weighted evidence extraction with priority markers
  
  // 1. Structured evidence markers (highest weight)
  const structuredEvidence = extractStructuredEvidence(text);
  evidenceScore += structuredEvidence.score;
  
  // 2. File paths with different weights
  const fileEvidence = extractFileEvidence(text);
  evidenceScore += fileEvidence.score;
  
  // 3. Commands with execution indicators  
  const commandEvidence = extractCommandEvidence(text);
  evidenceScore += commandEvidence.score;
  
  // 4. Outputs and results
  const outputEvidence = extractOutputEvidence(text);
  evidenceScore += outputEvidence.score;
  
  // 5. Summary extraction with priority
  const summary = extractSummary(text);
  evidenceScore += summary.score;
  
  // Combine and deduplicate
  const files = deduplicateArray([
    ...structuredEvidence.files,
    ...fileEvidence.files
  ]).slice(0, 8);
  
  const commands = deduplicateArray([
    ...structuredEvidence.commands,
    ...commandEvidence.commands
  ]).slice(0, 8);
  
  const outputs = deduplicateArray([
    ...structuredEvidence.outputs,
    ...outputEvidence.outputs
  ]).slice(0, 6);
  
  return { 
    files, 
    commands, 
    outputs, 
    summary: summary.text,
    score: Math.min(100, Math.round(evidenceScore))
  };
}

function extractStructuredEvidence(text) {
  let score = 0;
  const files = [];
  const commands = [];
  const outputs = [];
  
  // Look for structured markers (ФАЙЛИ:, КОМАНДИ:, РЕЗУЛЬТАТИ:, etc.)
  const structuredMarkers = [
    { re: /(?:ФАЙЛИ|FILES|СТВОРЕНО|ЗМІНЕНО)[:\-]?\s*([^\n\r]+)/gi, type: 'files', weight: 10 },
    { re: /(?:КОМАНДИ|COMMANDS|ВИКОНАНО)[:\-]?\s*([^\n\r]+)/gi, type: 'commands', weight: 8 },
    { re: /(?:РЕЗУЛЬТАТИ|RESULTS|OUTPUTS|ВИВІД)[:\-]?\s*([\s\S]{1,300}?)(?:\n\n|\n[А-ЯЇІЄ]|$)/gi, type: 'outputs', weight: 6 }
  ];
  
  structuredMarkers.forEach(({ re, type, weight }) => {
    const matches = Array.from(text.matchAll(re));
    matches.forEach(match => {
      score += weight;
      const content = match[1].trim();
      
      if (type === 'files') {
        const fileMatches = content.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}/g) || [];
        files.push(...fileMatches);
      } else if (type === 'commands') {
        const cmdMatches = content.split(/[,;]/).map(s => s.trim()).filter(Boolean);
        commands.push(...cmdMatches);
      } else if (type === 'outputs') {
        outputs.push(content.slice(0, 400));
      }
    });
  });
  
  return { files, commands, outputs, score };
}

function extractFileEvidence(text) {
  let score = 0;
  const files = [];
  
  // High confidence: full paths and common project files
  const highConfidenceFiles = text.match(/(?:\/[A-Za-z0-9_./-]+|src\/|app\/|config\/|\.\/)[A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,8}/g) || [];
  files.push(...highConfidenceFiles);
  score += highConfidenceFiles.length * 5;
  
  // Medium confidence: relative paths
  const mediumConfidenceFiles = text.match(/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}/g) || [];
  files.push(...mediumConfidenceFiles);
  score += mediumConfidenceFiles.length * 3;
  
  // Low confidence: simple filenames
  const lowConfidenceFiles = text.match(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}\b/g) || [];
  files.push(...lowConfidenceFiles.filter(f => !f.includes('http') && f.length > 3));
  score += Math.min(lowConfidenceFiles.length, 3) * 1;
  
  return { files: Array.from(new Set(files)), score };
}

function extractCommandEvidence(text) {
  let score = 0;
  const commands = [];
  
  // Commands in backticks (high confidence)
  const backtickCommands = text.match(/`([^`\n]{2,120})`/g) || [];
  backtickCommands.forEach(cmd => {
    const clean = cmd.slice(1, -1).trim();
    commands.push(clean);
    score += 4;
  });
  
  // Command lines with $ or > prefix (medium confidence)
  const prefixCommands = text.match(/^(?:\s*[>$] )([^\n]{2,160})$/gm) || [];
  prefixCommands.forEach(line => {
    const clean = line.replace(/^\s*[>$]\s*/, '').trim();
    commands.push(clean);
    score += 3;
  });
  
  // Common CLI patterns (lower confidence)
  const cliPatterns = text.match(/\b(?:npm|pip|git|node|python|curl|wget|chmod|mkdir)\s+[^\n]{1,100}/gi) || [];
  cliPatterns.forEach(cmd => {
    commands.push(cmd.trim());
    score += 2;
  });
  
  return { commands: Array.from(new Set(commands)), score };
}

function extractOutputEvidence(text) {
  let score = 0;
  const outputs = [];
  
  // Fenced code blocks (high confidence)
  const fencedBlocks = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/g) || [];
  fencedBlocks.forEach(block => {
    const content = block.replace(/```[a-zA-Z0-9]*\n?/, '').replace(/```$/, '').trim();
    if (content.length > 10) {
      outputs.push(content.slice(0, 500));
      score += 6;
    }
  });
  
  // Output indicators (medium confidence)
  const outputIndicators = text.match(/(?:Output|Result|Вивід|Результат)[:\-]?\s*([\s\S]{1,200}?)(?:\n\n|\n[А-ЯЇІЄ]|$)/gi) || [];
  outputIndicators.forEach(match => {
    const content = match.replace(/^[^:]+[:\-]?\s*/, '').trim();
    outputs.push(content);
    score += 4;
  });
  
  // Status indicators (lower confidence)
  const statusIndicators = text.match(/(?:Status|Статус|Success|Error|Failed)[:\-]?\s*([^\n]{1,100})/gi) || [];
  statusIndicators.forEach(match => {
    const content = match.replace(/^[^:]+[:\-]?\s*/, '').trim();
    outputs.push(content);
    score += 2;
  });
  
  return { outputs: Array.from(new Set(outputs)), score };
}

function extractSummary(text) {
  let score = 0;
  let summary = '';
  
  // Priority 1: РЕЗЮМЕ section
  const resumeMatch = text.match(/РЕЗЮМЕ[:\-]?\s*([\s\S]{1,400}?)(?:\n\n|КРОКИ:|РЕЗУЛЬТАТИ:|$)/i);
  if (resumeMatch) {
    summary = resumeMatch[1].trim();
    score += 10;
  }
  
  // Priority 2: First paragraph with action indicators  
  if (!summary) {
    const actionParagraph = text.match(/^[^\n]*(?:створ|виконав|встанов|запуск|тестув|розроб|імплемент)[^\n]*$/mi);
    if (actionParagraph) {
      summary = actionParagraph[0].trim().slice(0, 300);
      score += 6;
    }
  }
  
  // Priority 3: First substantial paragraph
  if (!summary) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    if (paragraphs.length > 0) {
      summary = paragraphs[0].trim().slice(0, 300);
      score += 3;
    }
  }
  
  // Fallback: first few sentences
  if (!summary) {
    const sentences = text.split(/[.!?]+/).slice(0, 3).join('. ').slice(0, 200);
    summary = sentences;
    score += 1;
  }
  
  return { text: summary, score };
}

function deduplicateArray(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

export default { runExecution, extractEvidence };