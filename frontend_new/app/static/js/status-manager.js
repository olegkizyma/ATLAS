/**
 * Atlas Status Manager
 * Відстеження статусу системи без перевантажень
 */
class AtlasStatusManager {
    constructor() {
        this.apiBase = window.location.origin;
        this.refreshInterval = 5000; // 5 секунд
        this.lastRefresh = 0;
        
        this.init();
    }
    
    init() {
        this.statusPanel = document.getElementById('statusPanel');
        this.processStatus = document.getElementById('processStatus');
        this.serviceStatus = document.getElementById('serviceStatus');
        this.networkStatus = document.getElementById('networkStatus');
        this.resourceStatus = document.getElementById('resourceStatus');
        
        if (!this.statusPanel) {
            console.warn('Status panel not found - status monitoring disabled (logs-only mode)');
            return;
        }
        
        this.startStatusMonitoring();
        this.log('Atlas Status Manager initialized');
    }
    
    startStatusMonitoring() {
        // Початкове оновлення
        this.updateStatus();
        
        // Періодичне оновлення
        setInterval(() => {
            this.updateStatus();
        }, this.refreshInterval);
    }
    
    async updateStatus() {
        const now = Date.now();
        if (now - this.lastRefresh < this.refreshInterval - 1000) {
            return; // Запобігаємо занадто частим запитам
        }
        
        this.lastRefresh = now;
        
        try {
            const response = await fetch(`${this.apiBase}/api/status`);
            if (!response.ok) return;
            
            const status = await response.json();
            this.renderStatus(status);
            
        } catch (error) {
            this.renderStatus({
                error: 'Connection failed',
                timestamp: new Date().toISOString()
            });
        }
    }
    
    renderStatus(status) {
        try {
            // Процеси
            if (status.processes && this.processStatus) {
                const processHTML = Object.entries(status.processes).map(([type, info]) => {
                    const count = info.count || 0;
                    const statusClass = count > 0 ? 'online' : 'warning';
                    return `<div class="status-item ${statusClass}">${type}: ${count}</div>`;
                }).join('');
                this.processStatus.innerHTML = processHTML;
            }
            
            // Сервіси
            if (status.services && this.serviceStatus) {
                const serviceHTML = Object.entries(status.services).map(([name, serviceStatus]) => {
                    let statusClass = 'warning';
                    const statusValue = typeof serviceStatus === 'object' ? serviceStatus.status : serviceStatus;
                    
                    if (statusValue === 'running' || statusValue === 'online' || statusValue === 'operational') {
                        statusClass = 'online';
                    } else if (statusValue === 'offline' || statusValue === 'error') {
                        statusClass = 'error';
                    }
                    
                    return `<div class="status-item ${statusClass}">${name}: ${statusValue}</div>`;
                }).join('');
                this.serviceStatus.innerHTML = serviceHTML;
            }
            
            // Мережа
            if (status.network && this.networkStatus) {
                const connCount = status.network.connections?.count || 0;
                const statusClass = connCount > 0 ? 'online' : 'warning';
                this.networkStatus.innerHTML = `<div class="status-item ${statusClass}">Connections: ${connCount}</div>`;
            }
            
            // Ресурси
            if (this.resourceStatus) {
                let resourceHTML = '';
                
                if (status.resources) {
                    if (status.resources.cpu?.usage_line) {
                        const cpuInfo = status.resources.cpu.usage_line.substring(0, 30) + '...';
                        resourceHTML += `<div class="status-item online">CPU: ${cpuInfo}</div>`;
                    }
                    
                    if (status.resources.disk?.usage_percent) {
                        const diskUsage = status.resources.disk.usage_percent;
                        const usageNum = parseInt(diskUsage);
                        const statusClass = usageNum > 90 ? 'error' : usageNum > 70 ? 'warning' : 'online';
                        resourceHTML += `<div class="status-item ${statusClass}">Disk: ${diskUsage}</div>`;
                    }
                }
                
                // Atlas Core статус
                if (status.services?.atlas_core_available) {
                    resourceHTML += `<div class="status-item online">🧠 Atlas Core: Ready</div>`;
                } else {
                    resourceHTML += `<div class="status-item warning">🧠 Atlas Core: Unavailable</div>`;
                }
                
                this.resourceStatus.innerHTML = resourceHTML;
            }
            
        } catch (error) {
            this.log(`Status rendering error: ${error.message}`, 'error');
        }
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`[${timestamp}] [STATUS] ${message}`);
        
        if (window.atlasLogger) {
            window.atlasLogger.addLog(message, level, 'status');
        }
    }
}

// Експортуємо для глобального використання
window.AtlasStatusManager = AtlasStatusManager;
