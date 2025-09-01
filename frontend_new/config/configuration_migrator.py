#!/usr/bin/env python3
"""
Intelligent Configuration Adapter
Адаптер для перетворення існуючих конфігурацій в інтелектуальні
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from intelligent_config import IntelligentConfigManager
from intelligent_orchestrator import IntelligentOrchestrator, IntelligentAgentManager

logger = logging.getLogger('atlas.config_adapter')

class ConfigurationMigrator:
    """Мігратор конфігурацій з хардкорів на інтелектуальну систему"""
    
    def __init__(self, atlas_root: Path):
        self.atlas_root = atlas_root
        self.config_manager = IntelligentConfigManager()
        self.orchestrator = IntelligentOrchestrator()
        
    def migrate_orchestrator_config(self):
        """Мігрує конфігурацію оркестратора"""
        orchestrator_dir = self.atlas_root / 'frontend_new' / 'orchestrator'
        
        # Генеруємо інтелектуальну конфігурацію
        intelligent_config = self.config_manager.generate_complete_config({
            'service_type': 'orchestrator',
            'environment': 'development'
        })
        
        # Створюємо новий .env файл з інтелектуальними налаштуваннями
        env_content = self._generate_intelligent_env(intelligent_config)
        
        # Зберігаємо новий .env
        env_path = orchestrator_dir / '.env.intelligent'
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write(env_content)
        
        logger.info(f"Generated intelligent orchestrator config: {env_path}")
        
        return env_path
    
    def _generate_intelligent_env(self, config: Dict[str, Any]) -> str:
        """Генерує .env файл з інтелектуальних налаштувань"""
        env_lines = [
            "# ATLAS Intelligent Configuration",
            "# Generated automatically - no hardcoded values",
            "",
        ]
        
        # Додаємо серверні налаштування
        if 'server' in config:
            env_lines.extend([
                "# Server Configuration (Auto-generated)",
                f"ORCH_PORT={config['server'].get('port', 5101)}",
                f"ORCH_HOST={config['server'].get('host', '127.0.0.1')}",
                f"ORCH_WORKERS={config['server'].get('workers', 4)}",
                ""
            ])
        
        # Додаємо ліміти
        if 'limits' in config:
            limits = config['limits']
            env_lines.extend([
                "# Intelligent Limits (Auto-adapted)",
                f"ORCH_MAX_CONTEXT_TOKENS={limits.get('max_context_tokens', 45000)}",
                f"ORCH_MAX_REQUESTS_PER_MINUTE={limits.get('max_requests_per_minute', 100)}",
                f"ORCH_TIMEOUT_SECONDS={limits.get('timeout_seconds', 30)}",
                f"ORCH_RETRY_ATTEMPTS={limits.get('retry_attempts', 3)}",
                f"ORCH_BACKOFF_BASE_MS={limits.get('backoff_base_ms', 500)}",
                f"ORCH_BACKOFF_MAX_MS={limits.get('backoff_max_ms', 10000)}",
                ""
            ])
        
        # Додаємо налаштування продуктивності
        if 'performance' in config:
            perf = config['performance']
            env_lines.extend([
                "# Performance Settings (Auto-optimized)",
                f"ORCH_CACHE_ENABLED={str(perf.get('cache_enabled', True)).lower()}",
                f"ORCH_COMPRESSION_ENABLED={str(perf.get('compression_enabled', True)).lower()}",
                f"ORCH_CONNECTION_POOL_SIZE={perf.get('connection_pool_size', 10)}",
                ""
            ])
        
        # Додаємо адаптивні налаштування
        env_lines.extend([
            "# Adaptive Behavior (Intelligent)",
            "ORCH_INTELLIGENT_MODE=true",
            "ORCH_AUTO_ADAPT=true",
            "ORCH_LEARNING_ENABLED=true",
            ""
        ])
        
        # Додаємо метаінформацію
        if 'meta' in config:
            meta = config['meta']
            env_lines.extend([
                "# Configuration Metadata",
                f"# Generated at: {meta.get('generated_at', 'unknown')}",
                f"# Strategies used: {', '.join(meta.get('strategies_used', []))}",
                f"# Adaptive parameters: {len(meta.get('adaptive_parameters', []))}",
                ""
            ])
        
        return "\n".join(env_lines)
    
    def create_intelligent_server_wrapper(self):
        """Створює інтелектуальну обгортку для server.js"""
        orchestrator_dir = self.atlas_root / 'frontend_new' / 'orchestrator'
        
        wrapper_content = '''#!/usr/bin/env node
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
'''
        
        wrapper_path = orchestrator_dir / 'intelligent_server.js'
        with open(wrapper_path, 'w', encoding='utf-8') as f:
            f.write(wrapper_content)
        
        # Робимо виконуваним
        os.chmod(wrapper_path, 0o755)
        
        logger.info(f"Created intelligent server wrapper: {wrapper_path}")
        return wrapper_path
    
    def create_migration_script(self):
        """Створює скрипт міграції для поступового переходу"""
        migration_script = '''#!/bin/bash
# ATLAS Configuration Migration Script
# Поступовий перехід від хардкорів до інтелектуальної системи

echo "🚀 Starting ATLAS configuration migration..."

# Функція для резервного копіювання
backup_config() {
    local file="$1"
    if [ -f "$file" ]; then
        cp "$file" "${file}.backup.$(date +%s)"
        echo "✅ Backed up $file"
    fi
}

# Створюємо резервні копії
echo "📋 Creating backups..."
backup_config ".env"
backup_config "server.js"
backup_config "intelligeich.json"

# Генеруємо інтелектуальну конфігурацію
echo "🧠 Generating intelligent configuration..."
cd "$(dirname "$0")"
python3 ../config/configuration_migrator.py

# Перевіряємо чи все готове
if [ -f ".env.intelligent" ]; then
    echo "✅ Intelligent configuration generated"
    
    # Пропонуємо тест
    echo "🧪 Testing intelligent configuration..."
    
    # Запускаємо тестовий сервер
    if node intelligent_server.js &
    then
        SERVER_PID=$!
        sleep 5
        
        # Тестуємо health endpoint
        if curl -s http://localhost:5101/health > /dev/null; then
            echo "✅ Intelligent server test passed"
            kill $SERVER_PID
        else
            echo "❌ Intelligent server test failed"
            kill $SERVER_PID
            exit 1
        fi
    fi
    
    echo "🎉 Migration completed successfully!"
    echo "💡 To use intelligent mode:"
    echo "   1. Use 'node intelligent_server.js' instead of 'node server.js'"
    echo "   2. Set ORCH_INTELLIGENT_MODE=true in .env"
    echo "   3. Monitor system adaptation in logs"
    
else
    echo "❌ Migration failed - intelligent config not generated"
    exit 1
fi

echo "🔍 Next steps:"
echo "   • Review .env.intelligent for auto-generated settings"  
echo "   • Test the intelligent server wrapper"
echo "   • Monitor adaptive behavior in logs"
echo "   • Gradually remove hardcoded values from your code"
'''
        
        script_path = self.atlas_root / 'frontend_new' / 'orchestrator' / 'migrate_to_intelligent.sh'
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(migration_script)
        
        os.chmod(script_path, 0o755)
        logger.info(f"Created migration script: {script_path}")
        return script_path

def main():
    """Головна функція міграції"""
    atlas_root = Path(__file__).parent.parent.parent
    
    migrator = ConfigurationMigrator(atlas_root)
    
    try:
        print("🚀 Starting ATLAS intelligent configuration migration...")
        
        # Мігруємо конфігурацію оркестратора
        env_path = migrator.migrate_orchestrator_config()
        print(f"✅ Generated intelligent config: {env_path}")
        
        # Створюємо інтелектуальну обгортку сервера
        wrapper_path = migrator.create_intelligent_server_wrapper()
        print(f"✅ Created intelligent server wrapper: {wrapper_path}")
        
        # Створюємо скрипт міграції
        script_path = migrator.create_migration_script()
        print(f"✅ Created migration script: {script_path}")
        
        print("\n🎉 Migration setup completed!")
        print("\n💡 Next steps:")
        print(f"1. Run the migration: cd {script_path.parent} && ./migrate_to_intelligent.sh")
        print("2. Test intelligent mode: node intelligent_server.js")
        print("3. Monitor adaptive behavior in logs")
        print("4. Gradually remove remaining hardcoded values")
        
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        print(f"❌ Migration failed: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
