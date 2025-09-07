/**
 * GitHub Goose Fallback Adapter
 * Fallback mechanism when local Goose API is unavailable
 * Implements intelligent routing and failover like Tetyana's setup
 */

import axios from 'axios';
import { extractEvidence } from './goose_adapter.js';

// GitHub Copilot/Goose endpoint configuration
const GITHUB_GOOSE_BASE = process.env.GITHUB_GOOSE_BASE || 'https://api.github.com/copilot';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_COPILOT_TOKEN;

// Fallback configuration
const FALLBACK_CONFIG = {
    maxRetries: 3,
    timeoutMs: 15000,
    retryDelayMs: 1000,
    healthCheckInterval: 30000, // Check local availability every 30s
    preferLocal: true
};

let localGooseAvailable = true;
let lastHealthCheck = 0;

/**
 * Main execution function with intelligent fallback
 */
export async function executeWithFallback(message, sessionId, options = {}) {
    const { enableTools = false, systemInstruction, workingDirHint, preferGitHub = false } = options;
    
    // Check local Goose availability
    await checkLocalGooseHealth();
    
    // Route to appropriate executor
    if (localGooseAvailable && !preferGitHub) {
        try {
            const { runExecution } = await import('./goose_adapter.js');
            const result = await runExecution(message, sessionId, options);
            
            if (result && result.trim()) {
                console.log('[GOOSE_FALLBACK] Local execution successful');
                return { 
                    content: result, 
                    source: 'local_goose',
                    evidence: extractEvidence(result)
                };
            } else {
                throw new Error('Local Goose returned empty result');
            }
        } catch (error) {
            console.warn(`[GOOSE_FALLBACK] Local execution failed: ${error.message}`);
            localGooseAvailable = false;
            return await executeWithGitHubGoose(message, sessionId, options);
        }
    } else {
        console.log('[GOOSE_FALLBACK] Using GitHub Goose fallback');
        return await executeWithGitHubGoose(message, sessionId, options);
    }
}

/**
 * Execute using GitHub Goose/Copilot
 */
async function executeWithGitHubGoose(message, sessionId, options = {}) {
    if (!GITHUB_TOKEN) {
        throw new Error('GitHub token not configured for fallback');
    }

    const { systemInstruction, enableTools } = options;
    
    try {
        // Prepare messages for GitHub Copilot Chat
        const messages = [];
        
        if (systemInstruction) {
            messages.push({
                role: 'system',
                content: systemInstruction
            });
        }

        // Add enhanced system prompt for Tetyana/Grisha style execution
        messages.push({
            role: 'system', 
            content: getEnhancedSystemPrompt(enableTools)
        });

        messages.push({
            role: 'user',
            content: message
        });

        const payload = {
            messages: messages,
            model: 'gpt-4o',
            max_tokens: 4000,
            temperature: 0.1,
            stream: false
        };

        const response = await axios.post(
            `${GITHUB_GOOSE_BASE}/chat/completions`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ATLAS-System/1.0'
                },
                timeout: FALLBACK_CONFIG.timeoutMs
            }
        );

        if (response.data && response.data.choices && response.data.choices[0]) {
            const content = response.data.choices[0].message.content;
            
            console.log('[GOOSE_FALLBACK] GitHub execution successful');
            
            return {
                content: content,
                source: 'github_goose',
                evidence: extractEvidence(content),
                metadata: {
                    model: response.data.model,
                    usage: response.data.usage
                }
            };
        } else {
            throw new Error('Invalid response from GitHub Goose');
        }
        
    } catch (error) {
        console.error(`[GOOSE_FALLBACK] GitHub execution failed: ${error.message}`);
        
        // If GitHub also fails, return a structured error response
        return {
            content: generateFallbackResponse(message, error),
            source: 'fallback_error',
            evidence: { files: [], commands: [], outputs: [], summary: 'Execution failed', score: 0 },
            error: error.message
        };
    }
}

/**
 * Check local Goose health periodically
 */
async function checkLocalGooseHealth() {
    const now = Date.now();
    if (now - lastHealthCheck < FALLBACK_CONFIG.healthCheckInterval) {
        return;
    }
    
    lastHealthCheck = now;
    
    try {
        const localBase = process.env.GOOSE_BASE_URL || 'http://localhost:3000';
        const response = await axios.get(`${localBase}/health`, { timeout: 3000 });
        localGooseAvailable = response.status === 200;
        
        console.log(`[GOOSE_FALLBACK] Local health check: ${localGooseAvailable ? 'OK' : 'Failed'}`);
    } catch (error) {
        localGooseAvailable = false;
        console.log('[GOOSE_FALLBACK] Local Goose unavailable, will use GitHub fallback');
    }
}

/**
 * Enhanced system prompt for GitHub Goose execution
 */
function getEnhancedSystemPrompt(enableTools) {
    const basePrompt = `You are Tetyana, an AI execution agent in the ATLAS multi-agent system. 
Your role is to execute tasks precisely and provide structured reports.

REPORT FORMAT:
[ТЕТЯНА] РЕЗЮМЕ: [Brief summary of what was accomplished]
КРОКИ: [Numbered list of steps taken]
РЕЗУЛЬТАТИ: [Specific outcomes and results]
ДОКАЗИ: [Evidence of completion - files created, commands run, outputs received]
ПЕРЕВІРКА: [How Grisha can verify this work]

EXECUTION GUIDELINES:
- Be precise and methodical
- Provide concrete evidence of work completed
- Include specific file paths, command outputs, or measurable results
- Think step-by-step
- If something cannot be done, explain why and suggest alternatives`;

    if (enableTools) {
        return basePrompt + `

TOOLS AVAILABLE:
- File operations (create, read, modify files)
- Command line execution
- Web browsing and research
- Code analysis and generation

Use tools when necessary to complete the task effectively.`;
    }

    return basePrompt + `

NOTE: This is a planning/analysis mode. Provide detailed steps but do not execute actual system commands.`;
}

/**
 * Generate fallback response when all systems fail
 */
function generateFallbackResponse(message, error) {
    return `[ТЕТЯНА] РЕЗЮМЕ: Неможливо виконати завдання через технічні проблеми.
КРОКИ: 1) Спроба виконання через локальний Goose - невдала
2) Спроба виконання через GitHub Goose - невдала
3) Активація режиму аварійного реагування
РЕЗУЛЬТАТИ: Завдання не виконано через відсутність доступних виконавчих систем.
ДОКАЗИ: Помилка: ${error.message}
ПЕРЕВІРКА: Гріша може перевірити статус системи та спробувати відновити з'єднання.

РЕКОМЕНДАЦІЇ:
- Перевірити статус локального Goose на порту 3000
- Перевірити налаштування GitHub токена
- Розглянути ручне виконання завдання
- Звернутися до системного адміністратора`;
}

/**
 * Get fallback status information
 */
export function getFallbackStatus() {
    return {
        localGooseAvailable,
        githubConfigured: !!GITHUB_TOKEN,
        lastHealthCheck: new Date(lastHealthCheck).toISOString(),
        config: FALLBACK_CONFIG
    };
}

/**
 * Force health check
 */
export async function forceHealthCheck() {
    lastHealthCheck = 0;
    await checkLocalGooseHealth();
    return getFallbackStatus();
}

export default { executeWithFallback, getFallbackStatus, forceHealthCheck };