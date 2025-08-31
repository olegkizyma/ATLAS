#!/usr/bin/env python3
"""
ATLAS Frontend Server v2.0
Новий модульний сервер без проблем з перезавантаженням
"""

import os
import sys
import time
import logging
import signal
from pathlib import Path
from flask import Flask, render_template, send_from_directory, jsonify, request

# Додаємо шляхи до модулів
current_dir = Path(__file__).parent.absolute()
atlas_root = current_dir.parent
sys.path.insert(0, str(atlas_root))
sys.path.insert(0, str(current_dir / 'core'))

# Налаштування логування
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('atlas_server.log')
    ]
)

logger = logging.getLogger('atlas.server')

class AtlasServer:
    def __init__(self, host='127.0.0.1', port=5000):
        self.host = host
        self.port = port
        self.start_time = time.time()
        self.atlas_core = None
        
        # Створюємо Flask app
        self.app = Flask(
            __name__,
            template_folder='templates',
            static_folder='static'
        )
        
        # Налаштовуємо Flask
        self.app.config['SECRET_KEY'] = 'atlas-secret-key-2024'
        self.app.config['DEBUG'] = False
        
        # Ініціалізуємо компоненти
        self._init_atlas_core()
        self._register_routes()
        self._init_api()
        
        # Обробка сигналів
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        logger.info(f"Atlas Server initialized at {host}:{port}")
    
    def _init_atlas_core(self):
        """Ініціалізуємо Atlas Core"""
        try:
            # Імпортуємо Atlas Core з основної директорії
            atlas_core_path = atlas_root / 'frontend' / 'atlas_core'
            if atlas_core_path.exists():
                sys.path.insert(0, str(atlas_core_path))
                
                try:
                    from atlas_integration import AtlasCore
                    self.atlas_core = AtlasCore()
                    logger.info("Atlas Core loaded successfully")
                except ImportError as e:
                    logger.warning(f"Could not import AtlasCore: {e}")
                    logger.info("Running in test mode without Atlas Core")
            else:
                logger.warning("Atlas Core not found, running in test mode")
                
        except Exception as e:
            logger.error(f"Atlas Core initialization error: {e}")
            logger.info("Continuing without Atlas Core")
    
    def _register_routes(self):
        """Реєструємо основні маршрути"""
        
        @self.app.route('/')
        def index():
            """Main interface route"""
            from datetime import datetime
            current_time = datetime.now().strftime('%H:%M:%S')
            return render_template('index.html', current_time=current_time)
        
        @self.app.route('/static/<path:filename>')
        def static_files(filename):
            """Статичні файли"""
            return send_from_directory(self.app.static_folder, filename)
        
        @self.app.route('/logs')
        def get_logs():
            """Get system logs"""
            try:
                limit = request.args.get('limit', 100, type=int)
                from datetime import datetime
                current_time = datetime.now().strftime('%H:%M:%S')
                
                # Test logs
                logs = [
                    {
                        'timestamp': current_time,
                        'level': 'INFO',
                        'source': 'ATLAS',
                        'message': 'System initialized successfully'
                    },
                    {
                        'timestamp': current_time,
                        'level': 'INFO', 
                        'source': 'ATLAS',
                        'message': 'Waiting for Atlas Core connection...'
                    }
                ]
                
                return jsonify({
                    'status': 'success',
                    'logs': logs[:limit]
                })
            except Exception as e:
                logger.error(f"Error getting logs: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/health')
        def health():
            """Health check"""
            return {
                'status': 'ok',
                'uptime': time.time() - self.start_time,
                'atlas_core': self.atlas_core is not None,
                'timestamp': time.time()
            }
        
        # Обробка помилок
        @self.app.errorhandler(404)
        def not_found(error):
            logger.warning(f"404 error: {error}")
            return render_template('index.html')  # SPA fallback
        
        @self.app.errorhandler(500)
        def internal_error(error):
            logger.error(f"500 error: {error}")
            return {
                'error': 'Internal server error',
                'message': str(error),
                'timestamp': time.time()
            }, 500
    
    def _init_api(self):
        """Ініціалізуємо API"""
        try:
            # Додаємо поточну директорію до шляху
            sys.path.insert(0, str(current_dir / 'api'))
            from atlas_api import AtlasAPI
            self.api = AtlasAPI(self.app, self.atlas_core)
            self.api.set_start_time(self.start_time)
            logger.info("Atlas API initialized")
        except ImportError as e:
            logger.error(f"Could not import AtlasAPI: {e}")
            # Створюємо базову заглушку API
            self._create_basic_api()
    
    def _create_basic_api(self):
        """Створюємо базові API ендпойнти як заглушку"""
        logger.info("Creating basic API endpoints")
        
        @self.app.route('/api/status')
        def api_status():
            return {
                'status': 'ok', 
                'atlas_core_ready': self.atlas_core is not None,
                'timestamp': time.time(),
                'version': '2.0'
            }
        
        @self.app.route('/api/logs')  
        def api_logs():
            return {
                'logs': [
                    {'timestamp': time.time(), 'level': 'INFO', 'message': 'Atlas v2.0 running in basic mode'}
                ],
                'timestamp': time.time()
            }
            
        @self.app.route('/logs')
        def logs_fallback():
            """Fallback для старих запитів логів"""
            return api_logs()
    
    def run(self, debug=False):
        """Запускаємо сервер"""
        try:
            logger.info(f"Starting Atlas Server on {self.host}:{self.port}")
            logger.info(f"Atlas Core ready: {self.atlas_core is not None}")
            
            # Використовуємо Werkzeug сервер для розробки
            self.app.run(
                host=self.host,
                port=self.port,
                debug=debug,
                threaded=True,
                use_reloader=False,  # Важливо! Вимикаємо auto-reload
                use_debugger=debug
            )
            
        except KeyboardInterrupt:
            logger.info("Server stopped by user")
        except Exception as e:
            logger.error(f"Server error: {e}")
            raise
    
    def _signal_handler(self, signum, frame):
        """Обробка сигналів завершення"""
        logger.info(f"Received signal {signum}, shutting down...")
        
        # Закриваємо Atlas Core якщо є
        if self.atlas_core and hasattr(self.atlas_core, 'cleanup'):
            try:
                self.atlas_core.cleanup()
                logger.info("Atlas Core cleaned up")
            except Exception as e:
                logger.error(f"Atlas Core cleanup error: {e}")
        
        sys.exit(0)

def main():
    """Головна функція"""
    # Аргументи командного рядка
    host = os.getenv('ATLAS_HOST', '127.0.0.1')
    port = int(os.getenv('ATLAS_PORT', '5001'))
    debug = os.getenv('ATLAS_DEBUG', 'false').lower() == 'true'
    
    # Створюємо і запускаємо сервер
    server = AtlasServer(host=host, port=port)
    server.run(debug=debug)

if __name__ == '__main__':
    main()
