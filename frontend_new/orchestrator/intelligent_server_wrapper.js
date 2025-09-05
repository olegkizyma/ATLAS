#!/usr/bin/env node
/**
 * ATLAS Intelligent Server Wrapper
 * Автоматично адаптує поведінку сервера без хардкорів
 * Інтегрується з Python інтелігентними системами
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import WebSocket from 'ws';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

class IntelligentServerWrapper {
    constructor() {
        this.configPath = path.join(__dirname, '.env.intelligent');
        this.standardConfigPath = path.join(__dirname, '.env');
        this.recoveryBridgeUrl = 'ws://127.0.0.1:5102';
        this.serverProcess = null;
        this.recoveryWs = null;
        this.intelligentMode = false;
        
        this.initialize();
    }
    
    async initialize() {
        console.log('🧠 ATLAS Intelligent Server Wrapper Starting...');
        
        // Спробуємо створити інтелігентну конфігурацію
        await this.generateIntelligentConfig();
        
        // Завантажуємо конфігурацію
        await this.loadConfiguration();
        
        // Підключаємося до Recovery Bridge
        await this.connectToRecoveryBridge();
        
        // Запускаємо основний сервер
        this.startMainServer();
        
        // Налаштовуємо обробники сигналів
        this.setupSignalHandlers();
    }
    
    async generateIntelligentConfig() {
        try {
            console.log('🔧 Generating intelligent configuration...');
            
            // Викликаємо Python конфігураційний мігратор
            const { spawn } = await import('child_process');
            const migrator = spawn('python', [
                'config/configuration_migrator.py',
                '--target', 'orchestrator'
            ], {
                cwd: path.join(__dirname, '..'),  // frontend_new directory
                stdio: 'pipe'
            });
            
            return new Promise((resolve, reject) => {
                let output = '';
                let errorOutput = '';
                
                migrator.stdout.on('data', (data) => {
                    output += data.toString();
                });
                
                migrator.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
                
                migrator.on('close', (code) => {
                    if (code === 0) {
                        console.log('✅ Intelligent configuration generated');
                        console.log(output);
                        resolve(true);
                    } else {
                        console.log('⚠️  Intelligent config generation failed, using standard config');
                        console.log('Error:', errorOutput);
                        resolve(false);
                    }
                });
                
                // Timeout after 30 seconds
                setTimeout(() => {
                    migrator.kill();
                    console.log('⚠️  Config generation timeout, using standard config');
                    resolve(false);
                }, 30000);
            });
        } catch (e) {
            console.log('⚠️  Config generation error, using standard config:', e.message);
            return false;
        }
    }
    
    async loadConfiguration() {
        // Спробуємо завантажити інтелігентну конфігурацію
        if (existsSync(this.configPath)) {
            console.log('🧠 Loading intelligent configuration...');
            dotenv.config({ path: this.configPath });
            this.intelligentMode = true;
            
            // Додаємо маркери інтелігентного режиму
            process.env.ORCH_INTELLIGENT_MODE = 'true';
            process.env.ORCH_AUTO_ADAPT = 'true';
            process.env.ORCH_LEARNING_ENABLED = 'true';
            
            console.log('✅ Intelligent mode activated');
        } else {
            console.log('📋 Loading standard configuration...');
            dotenv.config({ path: this.standardConfigPath });
            
            // Додаємо базові адаптивні налаштування
            process.env.ORCH_INTELLIGENT_MODE = 'false';
            process.env.ORCH_AUTO_ADAPT = 'false';
            
            console.log('⚠️  Standard mode - consider running config migration');
        }
        
        // Виводимо статус конфігурації
        this.logConfigStatus();
    }
    
    logConfigStatus() {
        console.log('\n📊 Configuration Status:');
        console.log(`   🧠 Intelligent Mode: ${this.intelligentMode ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`   🔄 Auto-Adaptation: ${process.env.ORCH_AUTO_ADAPT || 'false'}`);
        console.log(`   📚 Learning: ${process.env.ORCH_LEARNING_ENABLED || 'false'}`);
        console.log(`   🚪 Port: ${process.env.ORCH_PORT || '5101'}`);
        console.log(`   🎯 Max Context: ${process.env.ORCH_MAX_CONTEXT_TOKENS || '45000'}`);
        console.log('');
    }
    
    async connectToRecoveryBridge() {
        try {
            console.log('🔗 Connecting to Recovery Bridge...');
            
            this.recoveryWs = new WebSocket(this.recoveryBridgeUrl);
            
            this.recoveryWs.on('open', () => {
                console.log('✅ Connected to Recovery Bridge');
                
                // Відправляємо інформацію про статус
                this.recoveryWs.send(JSON.stringify({
                    type: 'orchestrator_status',
                    payload: {
                        intelligent_mode: this.intelligentMode,
                        config_source: this.intelligentMode ? 'intelligent' : 'standard',
                        timestamp: new Date().toISOString()
                    }
                }));
            });
            
            this.recoveryWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleRecoveryMessage(message);
                } catch (e) {
                    console.log('⚠️  Invalid recovery bridge message:', e);
                }
            });
            
            this.recoveryWs.on('error', (error) => {
                console.log('⚠️  Recovery Bridge connection error:', error.message);
            });
            
            this.recoveryWs.on('close', () => {
                console.log('🔗 Recovery Bridge disconnected');
                // Спробуємо перепідключитися через 5 секунд
                setTimeout(() => this.connectToRecoveryBridge(), 5000);
            });
            
        } catch (e) {
            console.log('⚠️  Failed to connect to Recovery Bridge:', e.message);
        }
    }
    
    handleRecoveryMessage(message) {
        const { type, payload } = message;
        
        switch (type) {
            case 'config_update':
                console.log('🔄 Received configuration update from Recovery Bridge');
                this.applyConfigUpdate(payload);
                break;
                
            case 'health_check':
                // Відповідаємо на health check
                if (this.recoveryWs && this.recoveryWs.readyState === WebSocket.OPEN) {
                    this.recoveryWs.send(JSON.stringify({
                        type: 'health_response',
                        payload: {
                            status: 'healthy',
                            intelligent_mode: this.intelligentMode,
                            server_running: this.serverProcess !== null,
                            timestamp: new Date().toISOString()
                        }
                    }));
                }
                break;
                
            case 'adaptation_request':
                console.log('🔄 Received adaptation request');
                this.handleAdaptationRequest(payload);
                break;
        }
    }
    
    applyConfigUpdate(config) {
        // Застосовуємо оновлення конфігурації без перезапуску
        for (const [key, value] of Object.entries(config)) {
            if (key.startsWith('ORCH_')) {
                process.env[key] = value;
                console.log(`🔄 Updated ${key} = ${value}`);
            }
        }
    }
    
    handleAdaptationRequest(adaptations) {
        console.log('🎯 Applying intelligent adaptations:', adaptations);
        
        // Применяем адаптации к переменным окружения
        if (adaptations.timeout_multiplier) {
            const currentTimeout = parseInt(process.env.ORCH_TIMEOUT_MS || '30000');
            process.env.ORCH_TIMEOUT_MS = Math.round(currentTimeout * adaptations.timeout_multiplier).toString();
            console.log(`⏱️  Adapted timeout: ${process.env.ORCH_TIMEOUT_MS}ms`);
        }
        
        if (adaptations.context_reduction_factor) {
            const currentContext = parseInt(process.env.ORCH_MAX_CONTEXT_TOKENS || '45000');
            process.env.ORCH_MAX_CONTEXT_TOKENS = Math.round(currentContext * adaptations.context_reduction_factor).toString();
            console.log(`📝 Adapted context limit: ${process.env.ORCH_MAX_CONTEXT_TOKENS} tokens`);
        }
        
        if (adaptations.conservative_mode) {
            process.env.ORCH_CONSERVATIVE_MODE = 'true';
            process.env.ORCH_MAX_REFINEMENT_CYCLES = '5'; // Reduced from default
            console.log('🛡️  Enabled conservative mode');
        }
    }
    
    startMainServer() {
        console.log('🚀 Starting main orchestrator server...');
        
        // Логируем переменные окружения перед запуском
        const envVars = Object.keys(process.env)
            .filter(key => key.startsWith('ORCH_'))
            .sort();
            
        console.log('🔧 Environment variables:');
        envVars.forEach(key => {
            console.log(`   ${key}=${process.env[key]}`);
        });
        
        this.serverProcess = spawn('node', ['server.js'], {
            stdio: 'inherit',
            env: process.env,
            cwd: __dirname
        });
        
        this.serverProcess.on('close', (code) => {
            console.log(`❌ Server exited with code ${code}`);
            if (code !== 0 && this.intelligentMode) {
                console.log('🔄 Intelligent mode detected failure, attempting recovery...');
                this.requestRecovery(code);
            }
            process.exit(code);
        });
        
        this.serverProcess.on('error', (error) => {
            console.log('❌ Server process error:', error);
            if (this.intelligentMode) {
                this.requestRecovery(error);
            }
        });
        
        console.log(`✅ Server started (PID: ${this.serverProcess.pid})`);
    }
    
    requestRecovery(errorInfo) {
        if (this.recoveryWs && this.recoveryWs.readyState === WebSocket.OPEN) {
            console.log('🆘 Requesting recovery assistance...');
            
            this.recoveryWs.send(JSON.stringify({
                type: 'recovery_request',
                payload: {
                    service: 'orchestrator',
                    error: errorInfo.toString(),
                    intelligent_mode: this.intelligentMode,
                    timestamp: new Date().toISOString(),
                    context: {
                        pid: this.serverProcess?.pid,
                        config_source: this.intelligentMode ? 'intelligent' : 'standard'
                    }
                }
            }));
        }
    }
    
    setupSignalHandlers() {
        const shutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
            
            if (this.serverProcess) {
                console.log('🔄 Stopping server process...');
                this.serverProcess.kill(signal);
            }
            
            if (this.recoveryWs) {
                console.log('🔗 Closing Recovery Bridge connection...');
                this.recoveryWs.close();
            }
            
            console.log('✅ Shutdown complete');
            process.exit(0);
        };
        
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.log('❌ Uncaught Exception:', error);
            if (this.intelligentMode) {
                this.requestRecovery(error);
            }
            process.exit(1);
        });
    }
}

// Запускаємо intelligent wrapper
const wrapper = new IntelligentServerWrapper();

console.log('🧠 ATLAS Intelligent Orchestrator Wrapper initialized');
