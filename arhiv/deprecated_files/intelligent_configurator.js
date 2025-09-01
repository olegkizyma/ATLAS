#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class IntelligentConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
    this.runtime = {
      discoveredServices: new Map(),
      availableProviders: new Map(),
      performanceMetrics: new Map(),
      adaptiveSettings: new Map()
    };
  }

  loadConfig() {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Failed to load intelligent config:', error);
      return this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    return {
      system: { intelligence_level: "full_autonomous" },
      adaptive_configuration: { auto_detect_resources: true },
      services: { auto_discovery: { enabled: true } },
      providers: { auto_detection: { enabled: true } }
    };
  }

  async discoverServices() {
    if (!this.config.services?.auto_discovery?.enabled) return;

    console.log('🔍 Розумне виявлення сервісів...');
    const scanPorts = this.config.services.auto_discovery.scan_ports || [3000, 3001, 5000, 5001, 5101];
    const discoveredServices = new Map();

    for (const port of scanPorts) {
      try {
        const service = await this.identifyServiceOnPort(port);
        if (service) {
          discoveredServices.set(port, service);
          console.log(`✅ Знайдено ${service.name} на порті ${port}`);
        }
      } catch (error) {
        // Port not in use, which is fine
      }
    }

    this.runtime.discoveredServices = discoveredServices;
    return discoveredServices;
  }

  async identifyServiceOnPort(port) {
    try {
      const { stdout } = await execAsync(`lsof -ti tcp:${port}`);
      if (!stdout.trim()) return null;

      // Try to identify service by checking its responses
      const response = await this.probeService(port);
      return this.classifyService(port, response);
    } catch {
      return null;
    }
  }

  async probeService(port) {
    const probes = [
      { path: '/', expected: 'html' },
      { path: '/health', expected: 'json' },
      { path: '/api/status', expected: 'json' },
      { path: '/ws', expected: 'websocket' }
    ];

    for (const probe of probes) {
      try {
        const response = await this.httpProbe(port, probe.path);
        if (response) return response;
      } catch {
        continue;
      }
    }
    return null;
  }

  async httpProbe(port, path) {
    return new Promise((resolve) => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: 1000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => resolve(null));
    });
  }

  classifyService(port, response) {
    const patterns = this.config.services?.auto_discovery?.service_patterns || [];
    
    if (response?.data?.includes('Goose') || response?.data?.includes('goose') || port === 3000) {
      return { name: 'goose', type: 'ai_agent', port, priority: 1 };
    }
    
    if (response?.data?.includes('orchestrator') || response?.data?.includes('Atlas') || port === 5101) {
      return { name: 'orchestrator', type: 'coordinator', port, priority: 2 };
    }
    
    if (response?.headers?.['content-type']?.includes('text/html') || port === 5001) {
      return { name: 'frontend', type: 'ui', port, priority: 3 };
    }

    return { name: 'unknown', type: 'service', port, priority: 10 };
  }

  async detectProviders() {
    console.log('🔍 Розумне виявлення провайдерів...');
    const providers = new Map();

    // Check environment variables for API keys
    const providerPatterns = [
      { name: 'github_copilot', env: ['GITHUB_COPILOT_TOKEN'], priority: 1 },
      { name: 'openai', env: ['OPENAI_API_KEY'], priority: 2 },
      { name: 'openrouter', env: ['OPENROUTER_API_KEY'], priority: 3 },
      { name: 'mistral', env: ['MISTRAL_API_KEY'], priority: 4 },
      { name: 'gemini', env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], priority: 5 }
    ];

    for (const provider of providerPatterns) {
      const hasToken = provider.env.some(envVar => process.env[envVar]);
      if (hasToken) {
        providers.set(provider.name, {
          name: provider.name,
          priority: provider.priority,
          available: true,
          performance: this.getProviderPerformance(provider.name)
        });
        console.log(`✅ Провайдер ${provider.name} доступний`);
      }
    }

    this.runtime.availableProviders = providers;
    return providers;
  }

  getProviderPerformance(providerName) {
    // In a real system, this would track actual performance metrics
    const defaultPerformance = {
      response_time_avg: 2000,
      error_rate: 0.05,
      reliability_score: 0.9
    };
    
    return this.runtime.performanceMetrics.get(providerName) || defaultPerformance;
  }

  async generateAdaptiveConfig() {
    const services = await this.discoverServices();
    const providers = await this.detectProviders();

    const adaptiveConfig = {
      timestamp: new Date().toISOString(),
      discovered: {
        services: Array.from(services.values()),
        providers: Array.from(providers.values())
      },
      adaptive_ports: this.generatePortConfig(services),
      provider_selection: this.generateProviderConfig(providers),
      context_limits: this.generateContextLimits(),
      execution_strategy: this.generateExecutionStrategy()
    };

    return adaptiveConfig;
  }

  generatePortConfig(services) {
    const portConfig = {};
    for (const [port, service] of services) {
      portConfig[service.name.toUpperCase() + '_PORT'] = port;
    }
    return portConfig;
  }

  generateProviderConfig(providers) {
    if (providers.size === 0) return { strategy: 'none' };

    const sortedProviders = Array.from(providers.values())
      .sort((a, b) => {
        const scoreA = a.priority + (a.performance?.error_rate || 0) * 10;
        const scoreB = b.priority + (b.performance?.error_rate || 0) * 10;
        return scoreA - scoreB;
      });

    return {
      primary: sortedProviders[0]?.name,
      fallback: sortedProviders.slice(1).map(p => p.name),
      strategy: 'performance_based'
    };
  }

  generateContextLimits() {
    const baseTokens = this.config.context_management?.limits?.base_tokens || 45000;
    const availableMemory = this.getAvailableMemory();
    const scalingFactor = Math.min(2.0, availableMemory / (1024 * 1024 * 1024)); // Scale by GB of RAM

    return {
      max_tokens: Math.floor(baseTokens * scalingFactor),
      compression_ratio: this.config.context_management?.limits?.compression_ratio || 0.7,
      adaptive_scaling: true
    };
  }

  getAvailableMemory() {
    // Simple memory check - in production would be more sophisticated
    try {
      const os = require('os');
      return os.freemem();
    } catch {
      return 4 * 1024 * 1024 * 1024; // 4GB fallback
    }
  }

  generateExecutionStrategy() {
    const serviceCount = this.runtime.discoveredServices.size;
    const providerCount = this.runtime.availableProviders.size;

    if (providerCount === 0) {
      return { mode: 'offline', description: 'Робота без AI провайдерів' };
    }

    if (serviceCount >= 3 && providerCount >= 2) {
      return { mode: 'full_stack', description: 'Повна екосистема з розподіленим навантаженням' };
    }

    if (providerCount >= 2) {
      return { mode: 'redundant', description: 'Багаторівневий AI з резервуванням' };
    }

    return { mode: 'single_provider', description: 'Робота з одним AI провайдером' };
  }

  async saveAdaptiveConfig(config) {
    const outputPath = path.resolve(path.dirname(this.configPath), 'runtime_config.json');
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log(`💾 Збережено адаптивну конфігурацію: ${outputPath}`);
    return outputPath;
  }
}

// Export for use as module
export { IntelligentConfigManager };

// CLI usage
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const configPath = process.argv[2] || path.resolve(process.cwd(), 'intelligent_config.json');
  
  async function main() {
    console.log('🚀 Запуск інтелектуального конфігуратора ATLAS...');
    
    const manager = new IntelligentConfigManager(configPath);
    const adaptiveConfig = await manager.generateAdaptiveConfig();
    const savedPath = await manager.saveAdaptiveConfig(adaptiveConfig);
    
    console.log('\n📊 Результати інтелектуального аналізу:');
    console.log(`Знайдено сервісів: ${adaptiveConfig.discovered.services.length}`);
    console.log(`Доступно провайдерів: ${adaptiveConfig.discovered.providers.length}`);
    console.log(`Стратегія виконання: ${adaptiveConfig.execution_strategy.mode}`);
    console.log(`Збережено в: ${savedPath}`);
  }

  main().catch(console.error);
}
