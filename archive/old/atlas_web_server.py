#!/usr/bin/env python3
"""
ATLAS Web Server - New Implementation
Integrates 3-Agent Backend with Preserved Web Interface

Serves the preserved web interface and provides API endpoints
for interacting with the Atlas/Tetiana/Grisha agent system.
"""

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_from_directory
from atlas_backend import AtlasSystem, AgentRole

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('atlas.web')

class AtlasWebServer:
    """Flask web server for ATLAS system"""
    
    def __init__(self, host='127.0.0.1', port=5001):
        self.host = host
        self.port = port
        self.app = Flask(
            __name__,
            template_folder='frontend_new/app/templates',
            static_folder='frontend_new/app/static'
        )
        
        # Initialize ATLAS backend system
        self.atlas_system = AtlasSystem()
        self.setup_routes()
        
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/')
        def index():
            """Serve main interface"""
            return render_template('index.html')
            
        @self.app.route('/api/health')
        def health():
            """Health check endpoint"""
            return jsonify({
                'status': 'ok',
                'system': 'ATLAS 3-Agent System',
                'agents': ['atlas', 'tetiana', 'grisha'],
                'timestamp': time.time()
            })
            
        @self.app.route('/api/tasks', methods=['POST'])
        def create_task():
            """Create new task"""
            try:
                data = request.get_json()
                if not data or 'description' not in data:
                    return jsonify({'error': 'Task description required'}), 400
                    
                user_id = data.get('user_id', 'web_user')
                description = data['description']
                
                # Create task in backend
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    task_id = loop.run_until_complete(
                        self.atlas_system.create_task(user_id, description)
                    )
                    return jsonify({
                        'task_id': task_id,
                        'description': description,
                        'status': 'created',
                        'timestamp': time.time()
                    })
                finally:
                    loop.close()
                    
            except Exception as e:
                logger.error(f"Error creating task: {e}")
                return jsonify({'error': str(e)}), 500
                
        @self.app.route('/api/tasks/<task_id>')
        def get_task(task_id):
            """Get task status"""
            try:
                status = self.atlas_system.get_task_status(task_id)
                if not status:
                    return jsonify({'error': 'Task not found'}), 404
                return jsonify(status)
            except Exception as e:
                logger.error(f"Error getting task {task_id}: {e}")
                return jsonify({'error': str(e)}), 500
                
        @self.app.route('/api/tasks')
        def list_tasks():
            """List all tasks"""
            try:
                tasks = []
                for task_id, task in self.atlas_system.tasks.items():
                    tasks.append(self.atlas_system.get_task_status(task_id))
                return jsonify({'tasks': tasks})
            except Exception as e:
                logger.error(f"Error listing tasks: {e}")
                return jsonify({'error': str(e)}), 500
                
        @self.app.route('/api/veto/resolve', methods=['POST'])
        def resolve_veto():
            """Resolve Grisha's veto"""
            try:
                data = request.get_json()
                user_id = data.get('user_id', 'web_user')
                command = data.get('command', 'continue')
                
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    resolved = loop.run_until_complete(
                        self.atlas_system.resolve_veto(user_id, command)
                    )
                    return jsonify({
                        'resolved': resolved,
                        'command': command,
                        'timestamp': time.time()
                    })
                finally:
                    loop.close()
                    
            except Exception as e:
                logger.error(f"Error resolving veto: {e}")
                return jsonify({'error': str(e)}), 500
                
        @self.app.route('/api/system/status')
        def system_status():
            """Get system status"""
            return jsonify({
                'running': self.atlas_system.running,
                'veto_active': self.atlas_system.veto_active,
                'total_tasks': len(self.atlas_system.tasks),
                'agents': {
                    'atlas': {'role': 'curator_strategist', 'active': True},
                    'tetiana': {'role': 'goose_executor', 'active': True},
                    'grisha': {'role': 'controller_validator', 'active': True}
                },
                'timestamp': time.time()
            })
            
        # Chat endpoint for streaming communication
        @self.app.route('/api/chat', methods=['POST'])
        def chat():
            """Handle chat messages (simplified implementation)"""
            try:
                data = request.get_json()
                message = data.get('message', '')
                
                if not message:
                    return jsonify({'error': 'Message required'}), 400
                
                # For now, create task from chat message
                user_id = data.get('user_id', 'web_chat_user')
                
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    task_id = loop.run_until_complete(
                        self.atlas_system.create_task(user_id, message)
                    )
                    
                    return jsonify({
                        'response': f'Task created: {task_id}',
                        'task_id': task_id,
                        'type': 'task_created',
                        'timestamp': time.time()
                    })
                finally:
                    loop.close()
                    
            except Exception as e:
                logger.error(f"Error in chat: {e}")
                return jsonify({'error': str(e)}), 500
                
    async def start_backend(self):
        """Start the backend ATLAS system"""
        await self.atlas_system.start()
        
    def run(self, debug=False):
        """Run the Flask server"""
        logger.info(f"Starting ATLAS Web Server on {self.host}:{self.port}")
        
        # Start backend system in background
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self.start_backend())
        
        # Start Flask server
        self.app.run(host=self.host, port=self.port, debug=debug, threaded=True)

def main():
    """Main entry point"""
    server = AtlasWebServer()
    try:
        server.run()
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")

if __name__ == "__main__":
    main()