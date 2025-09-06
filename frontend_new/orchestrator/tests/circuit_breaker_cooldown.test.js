// Circuit Breaker Cooldown Tests (Phase 2 completion)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// Mock the pipeline metrics
const mockMetrics = {
  circuitBreaker: {
    failuresTotal: 0,
    cooldownRemaining: 0,
    isOpen: false,
    lastFailureTime: 0,
    consecutiveFailures: 0
  },
  
  recordFailure() {
    this.circuitBreaker.failuresTotal++;
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    // Open circuit after 3 consecutive failures
    if (this.circuitBreaker.consecutiveFailures >= 3) {
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.cooldownRemaining = 30000; // 30 seconds
    }
  },
  
  recordSuccess() {
    this.circuitBreaker.consecutiveFailures = 0;
    this.circuitBreaker.isOpen = false;
    this.circuitBreaker.cooldownRemaining = 0;
  },
  
  updateCooldown() {
    if (this.circuitBreaker.isOpen) {
      const elapsed = Date.now() - this.circuitBreaker.lastFailureTime;
      this.circuitBreaker.cooldownRemaining = Math.max(0, 30000 - elapsed);
      
      if (this.circuitBreaker.cooldownRemaining === 0) {
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.consecutiveFailures = 0;
      }
    }
  },
  
  reset() {
    this.circuitBreaker = {
      failuresTotal: 0,
      cooldownRemaining: 0,
      isOpen: false,
      lastFailureTime: 0,
      consecutiveFailures: 0
    };
  }
};

describe('Circuit Breaker Cooldown', () => {
  beforeEach(() => {
    mockMetrics.reset();
  });

  it('should remain closed with no failures', () => {
    assert.strictEqual(mockMetrics.circuitBreaker.isOpen, false);
    assert.strictEqual(mockMetrics.circuitBreaker.cooldownRemaining, 0);
  });

  it('should open circuit after 3 consecutive failures', () => {
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    assert.strictEqual(mockMetrics.circuitBreaker.isOpen, false);
    
    mockMetrics.recordFailure();
    assert.strictEqual(mockMetrics.circuitBreaker.isOpen, true);
    assert(mockMetrics.circuitBreaker.cooldownRemaining > 0);
  });

  it('should reset consecutive failures on success', () => {
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    mockMetrics.recordSuccess();
    
    assert.strictEqual(mockMetrics.circuitBreaker.consecutiveFailures, 0);
    assert.strictEqual(mockMetrics.circuitBreaker.isOpen, false);
  });

  it('should track total failures separately from consecutive', () => {
    mockMetrics.recordFailure();
    mockMetrics.recordSuccess();
    mockMetrics.recordFailure();
    
    assert.strictEqual(mockMetrics.circuitBreaker.failuresTotal, 2);
    assert.strictEqual(mockMetrics.circuitBreaker.consecutiveFailures, 1);
  });

  it('should decrease cooldown over time', async () => {
    // Force circuit open
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    
    const initialCooldown = mockMetrics.circuitBreaker.cooldownRemaining;
    assert(initialCooldown > 0);
    
    // Simulate time passing
    await new Promise(resolve => setTimeout(resolve, 100));
    mockMetrics.updateCooldown();
    
    assert(mockMetrics.circuitBreaker.cooldownRemaining < initialCooldown);
  });

  it('should close circuit when cooldown expires', () => {
    // Force circuit open
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    
    assert.strictEqual(mockMetrics.circuitBreaker.isOpen, true);
    
    // Simulate cooldown expiry
    mockMetrics.circuitBreaker.lastFailureTime = Date.now() - 35000; // 35 seconds ago
    mockMetrics.updateCooldown();
    
    assert.strictEqual(mockMetrics.circuitBreaker.isOpen, false);
    assert.strictEqual(mockMetrics.circuitBreaker.cooldownRemaining, 0);
  });

  it('should provide accurate metrics for monitoring', () => {
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    mockMetrics.recordSuccess();
    mockMetrics.recordFailure();
    mockMetrics.recordFailure();
    mockMetrics.recordFailure(); // This opens circuit
    
    const metrics = mockMetrics.circuitBreaker;
    
    assert.strictEqual(metrics.failuresTotal, 5);
    assert.strictEqual(metrics.consecutiveFailures, 3);
    assert.strictEqual(metrics.isOpen, true);
    assert(metrics.cooldownRemaining > 0);
    assert(metrics.lastFailureTime > 0);
  });
});
