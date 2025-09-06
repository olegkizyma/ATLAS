// Circuit Breaker Metrics HUD (Phase 2 completion)
class CircuitBreakerHUD {
    constructor() {
        this.metricsEndpoint = window.CONFIG?.ORCHESTRATOR_URL + '/metrics/pipeline' || 'http://localhost:5101/metrics/pipeline';
        this.updateInterval = 5000; // 5 seconds
        this.isVisible = false;
        this.metrics = null;
        
        this.createHUD();
        this.startPolling();
    }

    createHUD() {
        // Create HUD container
        this.hudElement = document.createElement('div');
        this.hudElement.className = 'circuit-breaker-hud';
        this.hudElement.innerHTML = `
            <div class="hud-header">
                <span class="hud-title">Circuit Breaker</span>
                <button class="hud-toggle" onclick="circuitBreakerHUD.toggle()">−</button>
            </div>
            <div class="hud-content">
                <div class="metric">
                    <span class="metric-label">Status:</span>
                    <span class="metric-value" id="cb-status">Closed</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Failures:</span>
                    <span class="metric-value" id="cb-failures">0</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Cooldown:</span>
                    <span class="metric-value" id="cb-cooldown">0s</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Fallback Rate:</span>
                    <span class="metric-value" id="cb-fallback-rate">0%</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Avg Confidence:</span>
                    <span class="metric-value" id="cb-confidence">0.000</span>
                </div>
            </div>
        `;
        
        // Add CSS styles
        this.addStyles();
        
        // Append to body
        document.body.appendChild(this.hudElement);
        
        // Hide initially
        this.hudElement.style.display = 'none';
        
        // Show on development or when metrics are interesting
        if (window.CONFIG?.DEBUG || window.location.hostname === 'localhost') {
            this.show();
        }
    }

    addStyles() {
        if (document.getElementById('circuit-breaker-hud-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'circuit-breaker-hud-styles';
        style.textContent = `
            .circuit-breaker-hud {
                position: fixed;
                top: 10px;
                right: 10px;
                width: 250px;
                background: rgba(0, 0, 0, 0.85);
                border: 1px solid #00ff00;
                border-radius: 5px;
                font-family: 'Courier New', monospace;
                font-size: 11px;
                color: #00ff00;
                z-index: 10000;
                backdrop-filter: blur(5px);
                box-shadow: 0 2px 10px rgba(0, 255, 0, 0.3);
            }

            .hud-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 10px;
                background: rgba(0, 255, 0, 0.1);
                border-bottom: 1px solid #00ff00;
            }

            .hud-title {
                font-weight: bold;
                text-transform: uppercase;
            }

            .hud-toggle {
                background: none;
                border: none;
                color: #00ff00;
                cursor: pointer;
                font-size: 14px;
                padding: 0;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .hud-toggle:hover {
                background: rgba(0, 255, 0, 0.2);
                border-radius: 3px;
            }

            .hud-content {
                padding: 8px 10px;
            }

            .metric {
                display: flex;
                justify-content: space-between;
                margin: 3px 0;
            }

            .metric-label {
                opacity: 0.7;
            }

            .metric-value {
                font-weight: bold;
            }

            .metric-value.status-open {
                color: #ff4444;
                animation: pulse 1s infinite;
            }

            .metric-value.status-closed {
                color: #00ff00;
            }

            .metric-value.high-failures {
                color: #ffaa00;
            }

            .metric-value.cooldown-active {
                color: #ff4444;
                animation: countdown 1s infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }

            @keyframes countdown {
                0% { transform: scale(1); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }

            .circuit-breaker-hud.collapsed .hud-content {
                display: none;
            }

            @media (max-width: 768px) {
                .circuit-breaker-hud {
                    width: 200px;
                    font-size: 10px;
                }
            }
        `;
        
        document.head.appendChild(style);
    }

    async fetchMetrics() {
        try {
            const response = await fetch(this.metricsEndpoint);
            if (response.ok) {
                const data = await response.json();
                this.metrics = data.pipeline;
                this.updateDisplay();
            }
        } catch (error) {
            console.warn('[Circuit Breaker HUD] Failed to fetch metrics:', error);
        }
    }

    updateDisplay() {
        if (!this.metrics) return;

        const cb = this.metrics.circuitBreaker || {};
        
        // Status
        const statusEl = document.getElementById('cb-status');
        if (statusEl) {
            const isOpen = cb.isOpen;
            statusEl.textContent = isOpen ? 'OPEN' : 'CLOSED';
            statusEl.className = 'metric-value ' + (isOpen ? 'status-open' : 'status-closed');
        }

        // Failures
        const failuresEl = document.getElementById('cb-failures');
        if (failuresEl) {
            const total = cb.failuresTotal || 0;
            const consecutive = cb.consecutiveFailures || 0;
            failuresEl.textContent = `${consecutive}/${total}`;
            failuresEl.className = 'metric-value ' + (consecutive >= 2 ? 'high-failures' : '');
        }

        // Cooldown
        const cooldownEl = document.getElementById('cb-cooldown');
        if (cooldownEl) {
            const remaining = cb.cooldownRemaining || 0;
            const seconds = Math.ceil(remaining / 1000);
            cooldownEl.textContent = remaining > 0 ? `${seconds}s` : '0s';
            cooldownEl.className = 'metric-value ' + (remaining > 0 ? 'cooldown-active' : '');
        }

        // Fallback Rate
        const fallbackEl = document.getElementById('cb-fallback-rate');
        if (fallbackEl) {
            fallbackEl.textContent = this.metrics.fallbackRate || '0%';
        }

        // Average Confidence
        const confidenceEl = document.getElementById('cb-confidence');
        if (confidenceEl) {
            confidenceEl.textContent = this.metrics.avgVerificationConfidence || '0.000';
        }
    }

    startPolling() {
        this.fetchMetrics(); // Initial fetch
        this.pollInterval = setInterval(() => {
            this.fetchMetrics();
        }, this.updateInterval);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    show() {
        this.hudElement.style.display = 'block';
        this.isVisible = true;
    }

    hide() {
        this.hudElement.style.display = 'none';
        this.isVisible = false;
    }

    toggle() {
        const content = this.hudElement.querySelector('.hud-content');
        const toggleBtn = this.hudElement.querySelector('.hud-toggle');
        
        if (this.hudElement.classList.contains('collapsed')) {
            this.hudElement.classList.remove('collapsed');
            toggleBtn.textContent = '−';
        } else {
            this.hudElement.classList.add('collapsed');
            toggleBtn.textContent = '+';
        }
    }

    destroy() {
        this.stopPolling();
        if (this.hudElement && this.hudElement.parentNode) {
            this.hudElement.parentNode.removeChild(this.hudElement);
        }
    }
}

// Initialize HUD when DOM is ready
let circuitBreakerHUD;

document.addEventListener('DOMContentLoaded', () => {
    // Only create HUD if we're in development or explicitly enabled
    const shouldShowHUD = 
        window.location.hostname === 'localhost' ||
        window.location.search.includes('debug=true') ||
        localStorage.getItem('atlas_debug_hud') === 'true';
        
    if (shouldShowHUD) {
        circuitBreakerHUD = new CircuitBreakerHUD();
    }
});

// Global function to toggle HUD visibility
window.toggleCircuitBreakerHUD = function() {
    if (!circuitBreakerHUD) {
        circuitBreakerHUD = new CircuitBreakerHUD();
    } else if (circuitBreakerHUD.isVisible) {
        circuitBreakerHUD.hide();
    } else {
        circuitBreakerHUD.show();
    }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CircuitBreakerHUD };
}
