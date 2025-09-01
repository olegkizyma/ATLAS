
// ATLAS Recovery System Integration
// Додайте цей код до server.js для інтеграції з Python системою відновлення

const WebSocket = require('ws');

class RecoverySystemBridge {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.pendingRequests = new Map();
        
        this.connect();
    }
    
    connect() {
        try {
            this.ws = new WebSocket('ws://127.0.0.1:5102');
            
            this.ws.on('open', () => {
                console.log('[RecoveryBridge] Connected to Python recovery system');
                this.reconnectAttempts = 0;
            });
            
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                } catch (e) {
                    console.error('[RecoveryBridge] Failed to parse message:', e);
                }
            });
            
            this.ws.on('close', () => {
                console.log('[RecoveryBridge] Connection closed');
                this.scheduleReconnect();
            });
            
            this.ws.on('error', (error) => {
                console.error('[RecoveryBridge] WebSocket error:', error);
            });
            
        } catch (e) {
            console.error('[RecoveryBridge] Connection failed:', e);
            this.scheduleReconnect();
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            console.log(`[RecoveryBridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            console.error('[RecoveryBridge] Max reconnection attempts reached');
        }
    }
    
    handleMessage(message) {
        const { type, payload, request_id } = message;
        
        if (request_id && this.pendingRequests.has(request_id)) {
            const { resolve, reject } = this.pendingRequests.get(request_id);
            this.pendingRequests.delete(request_id);
            
            if (type === 'error') {
                reject(new Error(payload.error));
            } else {
                resolve(payload);
            }
        }
    }
    
    sendRequest(type, payload) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Recovery system not connected'));
                return;
            }
            
            const request_id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            this.pendingRequests.set(request_id, { resolve, reject });
            
            this.ws.send(JSON.stringify({
                type,
                payload,
                request_id
            }));
            
            // Timeout після 30 секунд
            setTimeout(() => {
                if (this.pendingRequests.has(request_id)) {
                    this.pendingRequests.delete(request_id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }
    
    async requestRecovery(failureData) {
        try {
            const result = await this.sendRequest('recovery_request', failureData);
            return result;
        } catch (e) {
            console.error('[RecoveryBridge] Recovery request failed:', e);
            return null;
        }
    }
    
    async getHealthStatus() {
        try {
            const health = await this.sendRequest('health_check', {});
            return health;
        } catch (e) {
            console.error('[RecoveryBridge] Health check failed:', e);
            return null;
        }
    }
    
    async getStats() {
        try {
            const stats = await this.sendRequest('stats_request', {});
            return stats;
        } catch (e) {
            console.error('[RecoveryBridge] Stats request failed:', e);
            return null;
        }
    }
}

// Глобальний екземпляр
const recoveryBridge = new RecoverySystemBridge();

// Функція для інтеграції з існуючою логікою обробки помилок
async function handleExecutionFailure(executionResult, context) {
    try {
        const failureData = {
            error_message: executionResult.error || 'Execution failed',
            agent_name: executionResult.agent || 'unknown',
            attempt_count: executionResult.attempts || 1,
            partial_success: executionResult.partialSuccess || false,
            user_request: context.userRequest || '',
            task_spec: context.taskSpec || {},
            context: context,
            session_id: context.sessionId || 'unknown',
            metadata: executionResult.metadata || {}
        };
        
        const recoveryResult = await recoveryBridge.requestRecovery(failureData);
        
        if (recoveryResult && recoveryResult.success) {
            console.log('[RecoverySystem] Recovery plan generated:', recoveryResult.recovery_result);
            return recoveryResult.recommendations;
        } else {
            console.error('[RecoverySystem] Recovery failed:', recoveryResult?.error);
            return null;
        }
    } catch (e) {
        console.error('[RecoverySystem] Recovery handling error:', e);
        return null;
    }
}

// Експортуємо для використання
module.exports = {
    recoveryBridge,
    handleExecutionFailure
};
