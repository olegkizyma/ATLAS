#!/usr/bin/env node
/**
 * ATLAS Intelligent Server Wrapper
 * Automatically adapts server behavior without hardcoded values
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Завантажуємо інтелектуальну конфігурацію якщо існує
const intelligentEnvPath = path.join(process.cwd(), '.env.intelligent');
if (existsSync(intelligentEnvPath)) {
    console.log('Loading intelligent configuration...');
    dotenv.config({ path: intelligentEnvPath });
} else {
    console.log('Using standard configuration (consider migrating to intelligent)');
    dotenv.config();
}

// Перевіряємо чи увімкнений інтелектуальний режим
const intelligentMode = process.env.ORCH_INTELLIGENT_MODE === 'true';

if (intelligentMode) {
    console.log('🧠 ATLAS Intelligent Mode Activated');
    console.log('📊 Adaptive configuration loaded');
    console.log('🔄 Auto-optimization enabled');
} else {
    console.log('⚠️  Standard mode - consider enabling intelligent configuration');
}

// Запускаємо основний сервер
const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: process.env
});

server.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
    process.exit(code);
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.kill('SIGINT');
});

process.on('SIGTERM', () => {
    console.log('Terminating server...');
    server.kill('SIGTERM');
});
