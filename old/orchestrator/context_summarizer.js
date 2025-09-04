/**
 * Smart Context Summarization System for ATLAS
 * Implements progressive context summarization to manage token limits efficiently
 */

import fs from 'fs';
import path from 'path';

class ContextSummarizer {
    constructor(maxContextTokens = 45000, summaryRatio = 0.3) {
        this.maxContextTokens = maxContextTokens;
        this.summaryRatio = summaryRatio; // 30% of original context
        this.conversationState = {
            currentSession: [],
            summarizedHistory: "",
            lastSummaryTimestamp: null,
            tokenCountEstimate: 0
        };
        
        // State file path
        this.stateFile = path.resolve(process.cwd(), '../logs/context_state.json');
        
        // Load existing state if available
        this.loadState();
    }
    
    /**
     * Rough token estimation: ~4 chars per token for most languages
     * More accurate for Ukrainian/Russian: ~3.5 chars per token
     */
    estimateTokens(text) {
        return text ? Math.ceil(text.length / 4) : 0;
    }
    
    /**
     * Determine if we need to summarize context
     */
    shouldSummarize(newContent) {
        const estimatedTokens = this.conversationState.tokenCountEstimate + this.estimateTokens(newContent);
        return estimatedTokens > this.maxContextTokens;
    }
    
    /**
     * Create a focused summary prompt for the AI
     */
    createSummaryPrompt(contextToSummarize) {
        let contextText = "";
        for (const item of contextToSummarize) {
            if (typeof item === 'object' && item !== null) {
                const role = item.role || "unknown";
                const content = item.content || "";
                contextText += `\n${role.toUpperCase()}: ${content}\n`;
            } else {
                contextText += `\n${item}\n`;
            }
        }
        
        const targetLength = Math.floor(contextText.length * this.summaryRatio);
        
        return `
Створи стислий, але інформативний підсумок наступної розмови, зберігаючи:
1. Ключові технічні деталі та рішення
2. Важливі помилки та їх виправлення  
3. Стан системи та налаштування
4. Основні досягнення та результати

Контекст для підсумовування:
${contextText}

Підсумок повинен бути структурованим та займати не більше ${targetLength} символів.
`;
    }
    
    /**
     * Generate summary using AI client
     */
    async summarizeContext(contextToSummarize, aiClient) {
        try {
            const summaryPrompt = this.createSummaryPrompt(contextToSummarize);
            
            const response = await aiClient.generateResponse([{
                role: "system", 
                content: "Ти експерт з підсумовування технічних розмов. Створи точний та стислий підсумок."
            }, {
                role: "user", 
                content: summaryPrompt
            }], {
                maxTokens: 2000,
                temperature: 0.3
            });
            
            const summary = response.content || "";
            const originalLength = contextToSummarize.map(item => JSON.stringify(item)).join('').length;
            
            console.log(`[ContextSummarizer] Context summarized: ${originalLength} → ${summary.length} chars`);
            
            return summary;
            
        } catch (error) {
            console.error(`[ContextSummarizer] Failed to create summary:`, error);
            return this.createFallbackSummary(contextToSummarize);
        }
    }
    
    /**
     * Simple fallback summary when AI summarization fails
     */
    createFallbackSummary(context) {
        const summaryParts = [];
        
        // Take last 5 interactions
        const recentContext = context.slice(-5);
        
        for (const item of recentContext) {
            if (typeof item === 'object' && item !== null) {
                const role = item.role || "";
                const content = (item.content || "").substring(0, 200); // First 200 chars
                summaryParts.push(`${role}: ${content}...`);
            }
        }
        
        return `[АВТОПІДСУМОК] Останні взаємодії:\n${summaryParts.join('\n')}`;
    }
    
    /**
     * Process new interaction and return optimized context
     */
    async processNewInteraction(userInput, aiResponse, aiClient = null) {
        // Add new interaction
        const newInteraction = [
            { role: "user", content: userInput },
            { role: "assistant", content: aiResponse }
        ];
        
        this.conversationState.currentSession.push(...newInteraction);
        
        // Check if we need to summarize
        if (this.shouldSummarize(userInput + aiResponse)) {
            if (aiClient && this.conversationState.currentSession.length > 4) {
                // Keep last 2 interactions, summarize the rest
                const contextToSummarize = this.conversationState.currentSession.slice(0, -4);
                
                if (contextToSummarize.length > 0) {
                    const newSummary = await this.summarizeContext(contextToSummarize, aiClient);
                    
                    // Update conversation state
                    const timestamp = new Date().toISOString();
                    this.conversationState.summarizedHistory += `\n\n[ПІДСУМОК ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}]\n${newSummary}`;
                    this.conversationState.currentSession = this.conversationState.currentSession.slice(-4); // Keep last 2 interactions
                    this.conversationState.lastSummaryTimestamp = timestamp;
                    
                    console.log(`[ContextSummarizer] Created summary at ${timestamp}, current session reduced to ${this.conversationState.currentSession.length} items`);
                }
            }
        }
        
        // Update token estimate
        this.conversationState.tokenCountEstimate = 
            this.estimateTokens(this.conversationState.summarizedHistory) +
            this.estimateTokens(JSON.stringify(this.conversationState.currentSession));
        
        // Save state
        this.saveState();
        
        return this.getOptimizedContext();
    }
    
    /**
     * Return optimized context ready for AI
     */
    getOptimizedContext() {
        return {
            summarizedHistory: this.conversationState.summarizedHistory,
            currentSession: this.conversationState.currentSession,
            estimatedTokens: this.conversationState.tokenCountEstimate,
            lastSummary: this.conversationState.lastSummaryTimestamp
        };
    }
    
    /**
     * Format context for inclusion in AI prompt
     */
    formatForAiPrompt() {
        let formattedContext = "";
        
        if (this.conversationState.summarizedHistory) {
            formattedContext += `[ПОПЕРЕДНІЙ КОНТЕКСТ]\n${this.conversationState.summarizedHistory}\n\n`;
        }
        
        if (this.conversationState.currentSession.length > 0) {
            formattedContext += "[ПОТОЧНА СЕСІЯ]\n";
            for (const item of this.conversationState.currentSession) {
                if (typeof item === 'object' && item !== null) {
                    const role = (item.role || "").toUpperCase();
                    const content = item.content || "";
                    formattedContext += `${role}: ${content}\n\n`;
                }
            }
        }
        
        return formattedContext;
    }
    
    /**
     * Save conversation state to file
     */
    saveState() {
        try {
            // Ensure logs directory exists
            const logsDir = path.dirname(this.stateFile);
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            
            fs.writeFileSync(this.stateFile, JSON.stringify(this.conversationState, null, 2), 'utf8');
            console.log(`[ContextSummarizer] State saved to ${this.stateFile}`);
        } catch (error) {
            console.error(`[ContextSummarizer] Failed to save state:`, error);
        }
    }
    
    /**
     * Load conversation state from file
     */
    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const stateData = fs.readFileSync(this.stateFile, 'utf8');
                this.conversationState = JSON.parse(stateData);
                console.log(`[ContextSummarizer] State loaded from ${this.stateFile}`);
                return true;
            }
        } catch (error) {
            console.error(`[ContextSummarizer] Failed to load state:`, error);
        }
        return false;
    }
    
    /**
     * Clear conversation state (start fresh)
     */
    clearState() {
        this.conversationState = {
            currentSession: [],
            summarizedHistory: "",
            lastSummaryTimestamp: null,
            tokenCountEstimate: 0
        };
        this.saveState();
        console.log('[ContextSummarizer] State cleared');
    }
    
    /**
     * Get context statistics
     */
    getStats() {
        return {
            currentSessionLength: this.conversationState.currentSession.length,
            summarizedHistoryLength: this.conversationState.summarizedHistory.length,
            estimatedTokens: this.conversationState.tokenCountEstimate,
            lastSummary: this.conversationState.lastSummaryTimestamp
        };
    }
}

// Utility functions
export function createSmartContextManager(maxTokens = 45000) {
    return new ContextSummarizer(maxTokens);
}

export { ContextSummarizer };
export default ContextSummarizer;
