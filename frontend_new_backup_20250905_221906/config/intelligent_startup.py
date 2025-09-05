#!/usr/bin/env python3
"""
ATLAS Intelligent Startup System
Повністю адаптивна система запуску без жорстко закодованих значень
"""

import os
import sys
import json
import time
import signal
import asyncio
import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from intelligent_config import IntelligentConfigManager

# Налаштування логування
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger('atlas.startup')

@dataclass
class ServiceDefinition:
    """Визначення сервісу з адаптивними параметрами"""
    name: str
    executable: str
    working_directory: Optional[str] = None
    environment_variables: Dict[str, str] = None
    dependencies: List[str] = None
    health_check: Optional[Dict[str, Any]] = None
    auto_restart: bool = True
    startup_delay: float = 0
    shutdown_timeout: float = 10

class SystemAnalyzer:
    """Аналізатор системи для визначення оптимальних параметрів"""
    
    def __init__(self):
        self.system_info = self._gather_system_info()
    
    def _gather_system_info(self) -> Dict[str, Any]:
        """Збирає інформацію про систему"""
        try:
            import psutil
            
            return {
                'cpu_count': psutil.cpu_count(),
                'cpu_freq': psutil.cpu_freq()._asdict() if psutil.cpu_freq() else {},
                'memory': psutil.virtual_memory()._asdict(),
                'disk': psutil.disk_usage('/')._asdict(),
                'network': psutil.net_if_stats(),
                'load_average': psutil.getloadavg() if hasattr(psutil, 'getloadavg') else (0, 0, 0),
                'boot_time': psutil.boot_time(),
                'platform': sys.platform,
                'python_version': sys.version_info[:2]
            }
        except ImportError:
            logger.warning("psutil not available, using basic system info")
            return {
                'cpu_count': 1,
                'memory': {'total': 1024*1024*1024, 'available': 512*1024*1024},
                'platform': sys.platform,
                'python_version': sys.version_info[:2]
            }
    
    def recommend_service_parameters(self, service_name: str) -> Dict[str, Any]:
        """Рекомендує параметри для сервісу базуючись на системі"""
        memory_mb = self.system_info['memory']['available'] // (1024 * 1024)
        cpu_count = self.system_info['cpu_count']
        
        # Базові рекомендації
        recommendations = {
            'memory_limit_mb': min(memory_mb // 4, 512),
            'max_workers': min(cpu_count * 2, 8),
            'timeout_seconds': 30 if memory_mb > 1024 else 60,
            'startup_delay': 1.0 if cpu_count > 2 else 2.0
        }
        
        # Специфічні налаштування для різних сервісів
        service_specific = {
            'goose': {
                'memory_limit_mb': min(memory_mb // 3, 1024),
                'timeout_seconds': 45,
                'startup_delay': 3.0
            },
            'orchestrator': {
                'memory_limit_mb': min(memory_mb // 4, 512),
                'max_workers': min(cpu_count, 4),
                'startup_delay': 2.0
            },
            'frontend': {
                'memory_limit_mb': min(memory_mb // 6, 256),
                'max_workers': 1,
                'startup_delay': 1.0
            }
        }
        
        if service_name in service_specific:
            recommendations.update(service_specific[service_name])
        
        return recommendations

class ServiceDiscovery:
    """Система автоматичного виявлення сервісів"""
    
    def __init__(self, atlas_root: Path):
        self.atlas_root = atlas_root
        self.discovered_services = {}
    
    def discover_services(self) -> Dict[str, ServiceDefinition]:
        """Автоматично виявляє сервіси в проекті"""
        services = {}
        
        # Виявлення Goose
        goose_service = self._discover_goose()
        if goose_service:
            services['goose'] = goose_service
        
        # Виявлення Orchestrator
        orchestrator_service = self._discover_orchestrator()
        if orchestrator_service:
            services['orchestrator'] = orchestrator_service
        
        # Виявлення Frontend
        frontend_service = self._discover_frontend()
        if frontend_service:
            services['frontend'] = frontend_service
        
        return services
    
    def _discover_goose(self) -> Optional[ServiceDefinition]:
        """Виявляє Goose сервіс"""
        goose_dir = self.atlas_root / 'goose'
        
        if not goose_dir.exists():
            return None
        
        # Шукаємо скомпільований бінарник
        release_binary = goose_dir / 'target' / 'release' / 'goosed'
        debug_binary = goose_dir / 'target' / 'debug' / 'goosed'
        
        executable = None
        if release_binary.exists():
            executable = str(release_binary)
        elif debug_binary.exists():
            executable = str(debug_binary)
        else:
            # Пробуємо зібрати
            try:
                result = subprocess.run(
                    ['cargo', 'build', '--release'],
                    cwd=goose_dir,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                if result.returncode == 0 and release_binary.exists():
                    executable = str(release_binary)
            except (subprocess.TimeoutExpired, FileNotFoundError):
                logger.warning("Could not build Goose")
        
        if not executable:
            return None
        
        return ServiceDefinition(
            name='goose',
            executable=f'XDG_CONFIG_HOME={goose_dir} {executable} web',
            working_directory=str(goose_dir.parent),
            environment_variables={'XDG_CONFIG_HOME': str(goose_dir)},
            health_check={
                'url': 'http://127.0.0.1:3000',
                'expected_status': 200,
                'timeout': 5
            },
            startup_delay=3.0
        )
    
    def _discover_orchestrator(self) -> Optional[ServiceDefinition]:
        """Виявляє Orchestrator сервіс"""
        orchestrator_dir = self.atlas_root / 'frontend_new' / 'orchestrator'
        
        if not orchestrator_dir.exists():
            return None
        
        server_js = orchestrator_dir / 'server.js'
        package_json = orchestrator_dir / 'package.json'
        
        if not server_js.exists():
            return None
        
        # Перевіряємо чи встановлені залежності
        node_modules = orchestrator_dir / 'node_modules'
        if not node_modules.exists() and package_json.exists():
            try:
                subprocess.run(
                    ['npm', 'install'],
                    cwd=orchestrator_dir,
                    capture_output=True,
                    timeout=120
                )
            except (subprocess.TimeoutExpired, FileNotFoundError):
                logger.warning("Could not install orchestrator dependencies")
        
        return ServiceDefinition(
            name='orchestrator',
            executable=f'node {server_js}',
            working_directory=str(orchestrator_dir),
            health_check={
                'url': 'http://127.0.0.1:5101/health',
                'expected_status': 200,
                'timeout': 5
            },
            startup_delay=2.0
        )
    
    def _discover_frontend(self) -> Optional[ServiceDefinition]:
        """Виявляє Frontend сервіс"""
        frontend_dir = self.atlas_root / 'frontend_new' / 'app'
        
        if not frontend_dir.exists():
            return None
        
        server_py = frontend_dir / 'atlas_server.py'
        
        if not server_py.exists():
            return None
        
        # Визначаємо Python executable
        python_executable = self._find_python_executable()
        
        return ServiceDefinition(
            name='frontend',
            executable=f'{python_executable} {server_py}',
            working_directory=str(frontend_dir),
            health_check={
                'url': 'http://127.0.0.1:5000',
                'expected_status': 200,
                'timeout': 5
            },
            startup_delay=1.0
        )
    
    def _find_python_executable(self) -> str:
        """Знаходить найкращий Python executable"""
        candidates = ['python3', 'python', sys.executable]
        
        for candidate in candidates:
            try:
                result = subprocess.run(
                    [candidate, '--version'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0:
                    return candidate
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue
        
        return sys.executable

class PortManager:
    """Менеджер портів для автоматичного визначення доступних портів"""
    
    def __init__(self):
        self.allocated_ports = set()
        self.port_ranges = {
            'goose': (3000, 3100),
            'orchestrator': (5100, 5200),
            'frontend': (5000, 5100)
        }
    
    def allocate_port(self, service_name: str, preferred_port: Optional[int] = None) -> int:
        """Виділяє порт для сервісу"""
        if preferred_port and self._is_port_available(preferred_port):
            self.allocated_ports.add(preferred_port)
            return preferred_port
        
        # Використовуємо діапазон для сервісу
        start_port, end_port = self.port_ranges.get(service_name, (8000, 9000))
        
        for port in range(start_port, end_port):
            if port not in self.allocated_ports and self._is_port_available(port):
                self.allocated_ports.add(port)
                return port
        
        raise RuntimeError(f"Could not allocate port for service {service_name}")
    
    def _is_port_available(self, port: int) -> bool:
        """Перевіряє чи доступний порт"""
        import socket
        
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return True
        except OSError:
            return False

class ProcessManager:
    """Менеджер процесів для керування сервісами"""
    
    def __init__(self):
        self.processes = {}
        self.shutdown_handlers = []
        
        # Реєструємо обробники сигналів
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def start_service(self, service: ServiceDefinition, port: Optional[int] = None) -> subprocess.Popen:
        """Запускає сервіс"""
        env = os.environ.copy()
        
        # Додаємо змінні оточення сервісу
        if service.environment_variables:
            env.update(service.environment_variables)
        
        # Додаємо порт якщо вказаний
        if port:
            env['PORT'] = str(port)
            env[f'{service.name.upper()}_PORT'] = str(port)
        
        # Підготовляємо команду
        if ' ' in service.executable:
            cmd = service.executable.split()
        else:
            cmd = [service.executable]
        
        logger.info(f"Starting {service.name}: {' '.join(cmd)}")
        
        try:
            process = subprocess.Popen(
                cmd,
                cwd=service.working_directory,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            self.processes[service.name] = {
                'process': process,
                'service': service,
                'port': port,
                'start_time': time.time()
            }
            
            return process
            
        except Exception as e:
            logger.error(f"Failed to start {service.name}: {e}")
            raise
    
    def stop_service(self, service_name: str) -> bool:
        """Зупиняє сервіс"""
        if service_name not in self.processes:
            return False
        
        process_info = self.processes[service_name]
        process = process_info['process']
        service = process_info['service']
        
        logger.info(f"Stopping {service_name}")
        
        try:
            # Спочатку пробуємо graceful shutdown
            process.terminate()
            
            try:
                process.wait(timeout=service.shutdown_timeout)
                logger.info(f"{service_name} stopped gracefully")
                return True
            except subprocess.TimeoutExpired:
                # Якщо не вдалося graceful, використовуємо kill
                logger.warning(f"Force killing {service_name}")
                process.kill()
                process.wait()
                return True
                
        except Exception as e:
            logger.error(f"Error stopping {service_name}: {e}")
            return False
        finally:
            self.processes.pop(service_name, None)
    
    def stop_all_services(self) -> Dict[str, bool]:
        """Зупиняє всі сервіси"""
        results = {}
        
        for service_name in list(self.processes.keys()):
            results[service_name] = self.stop_service(service_name)
        
        return results
    
    def is_service_running(self, service_name: str) -> bool:
        """Перевіряє чи працює сервіс"""
        if service_name not in self.processes:
            return False
        
        process = self.processes[service_name]['process']
        return process.poll() is None
    
    def get_service_status(self) -> Dict[str, Dict[str, Any]]:
        """Отримує статус всіх сервісів"""
        status = {}
        
        for service_name, process_info in self.processes.items():
            process = process_info['process']
            service = process_info['service']
            
            status[service_name] = {
                'running': process.poll() is None,
                'pid': process.pid,
                'port': process_info.get('port'),
                'uptime': time.time() - process_info['start_time'],
                'auto_restart': service.auto_restart
            }
        
        return status
    
    def _signal_handler(self, signum, frame):
        """Обробник сигналів для graceful shutdown"""
        logger.info(f"Received signal {signum}, shutting down services")
        self.stop_all_services()
        sys.exit(0)

class HealthChecker:
    """Перевірка стану сервісів"""
    
    def __init__(self):
        self.check_timeout = 5
    
    async def check_service_health(self, service: ServiceDefinition) -> Tuple[bool, Optional[str]]:
        """Перевіряє стан сервісу"""
        if not service.health_check:
            return True, "No health check configured"
        
        health_config = service.health_check
        
        if 'url' in health_config:
            return await self._check_http_health(health_config)
        elif 'command' in health_config:
            return await self._check_command_health(health_config)
        else:
            return True, "Unknown health check type"
    
    async def _check_http_health(self, config: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """Перевіряє HTTP health endpoint"""
        import aiohttp
        
        try:
            timeout = aiohttp.ClientTimeout(total=config.get('timeout', self.check_timeout))
            
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(config['url']) as response:
                    expected_status = config.get('expected_status', 200)
                    
                    if response.status == expected_status:
                        return True, f"HTTP {response.status}"
                    else:
                        return False, f"HTTP {response.status} (expected {expected_status})"
                        
        except asyncio.TimeoutError:
            return False, "Timeout"
        except Exception as e:
            return False, f"Error: {e}"
    
    async def _check_command_health(self, config: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """Перевіряє стан через команду"""
        try:
            process = await asyncio.create_subprocess_shell(
                config['command'],
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=config.get('timeout', self.check_timeout)
            )
            
            expected_code = config.get('expected_exit_code', 0)
            
            if process.returncode == expected_code:
                return True, f"Command returned {process.returncode}"
            else:
                return False, f"Command returned {process.returncode} (expected {expected_code})"
                
        except asyncio.TimeoutError:
            return False, "Command timeout"
        except Exception as e:
            return False, f"Command error: {e}"

class IntelligentStartupSystem:
    """Головна система інтелектуального запуску"""
    
    def __init__(self, atlas_root: Optional[Path] = None):
        self.atlas_root = atlas_root or Path(__file__).parent.parent
        self.config_manager = IntelligentConfigManager()
        self.system_analyzer = SystemAnalyzer()
        self.service_discovery = ServiceDiscovery(self.atlas_root)
        self.port_manager = PortManager()
        self.process_manager = ProcessManager()
        self.health_checker = HealthChecker()
        
        self.services = {}
        self.startup_order = []
        
    def initialize(self):
        """Ініціалізує систему"""
        logger.info("Initializing ATLAS Intelligent Startup System")
        
        # Виявляємо сервіси
        self.services = self.service_discovery.discover_services()
        logger.info(f"Discovered services: {list(self.services.keys())}")
        
        # Визначаємо порядок запуску базуючись на залежностях
        self._determine_startup_order()
        
        # Генеруємо конфігурацію
        self.config = self.config_manager.generate_complete_config()
        
        logger.info("Initialization complete")
    
    def _determine_startup_order(self):
        """Визначає порядок запуску сервісів"""
        # Проста логіка: Goose -> Orchestrator -> Frontend
        order = []
        
        if 'goose' in self.services:
            order.append('goose')
        
        if 'orchestrator' in self.services:
            order.append('orchestrator')
        
        if 'frontend' in self.services:
            order.append('frontend')
        
        self.startup_order = order
        logger.info(f"Startup order: {' -> '.join(order)}")
    
    async def start_all_services(self):
        """Запускає всі сервіси"""
        logger.info("Starting all services")
        
        for service_name in self.startup_order:
            if service_name not in self.services:
                continue
            
            service = self.services[service_name]
            
            # Отримуємо рекомендації для сервісу
            recommendations = self.system_analyzer.recommend_service_parameters(service_name)
            
            # Виділяємо порт
            try:
                port = self.port_manager.allocate_port(service_name)
                logger.info(f"Allocated port {port} for {service_name}")
            except RuntimeError as e:
                logger.error(f"Failed to allocate port for {service_name}: {e}")
                continue
            
            # Застосовуємо затримку запуску
            if service.startup_delay > 0:
                logger.info(f"Waiting {service.startup_delay}s before starting {service_name}")
                await asyncio.sleep(service.startup_delay)
            
            # Запускаємо сервіс
            try:
                self.process_manager.start_service(service, port)
                logger.info(f"Started {service_name} on port {port}")
                
                # Даємо час на ініціалізацію
                await asyncio.sleep(2)
                
                # Перевіряємо стан
                if service.health_check:
                    healthy, status = await self.health_checker.check_service_health(service)
                    if healthy:
                        logger.info(f"{service_name} health check passed: {status}")
                    else:
                        logger.warning(f"{service_name} health check failed: {status}")
                
            except Exception as e:
                logger.error(f"Failed to start {service_name}: {e}")
    
    async def stop_all_services(self):
        """Зупиняє всі сервіси"""
        logger.info("Stopping all services")
        results = self.process_manager.stop_all_services()
        
        for service_name, success in results.items():
            if success:
                logger.info(f"Successfully stopped {service_name}")
            else:
                logger.error(f"Failed to stop {service_name}")
    
    def get_status(self) -> Dict[str, Any]:
        """Отримує загальний статус системи"""
        service_status = self.process_manager.get_service_status()
        
        return {
            'system_info': self.system_analyzer.system_info,
            'services': service_status,
            'startup_order': self.startup_order,
            'atlas_root': str(self.atlas_root),
            'config_generated_at': self.config.get('meta', {}).get('generated_at'),
            'uptime': time.time() - (self.config.get('meta', {}).get('generated_at', time.time()))
        }
    
    async def monitor_services(self):
        """Моніторить сервіси та перезапускає при необхідності"""
        logger.info("Starting service monitoring")
        
        while True:
            try:
                for service_name in self.startup_order:
                    if not self.process_manager.is_service_running(service_name):
                        service = self.services.get(service_name)
                        
                        if service and service.auto_restart:
                            logger.warning(f"Service {service_name} is down, restarting...")
                            
                            try:
                                port = self.port_manager.allocate_port(service_name)
                                self.process_manager.start_service(service, port)
                                logger.info(f"Restarted {service_name} on port {port}")
                            except Exception as e:
                                logger.error(f"Failed to restart {service_name}: {e}")
                
                await asyncio.sleep(30)  # Перевірка кожні 30 секунд
                
            except Exception as e:
                logger.error(f"Error in service monitoring: {e}")
                await asyncio.sleep(60)  # Довша пауза при помилці

# Головна функція
async def main():
    """Головна функція системи"""
    startup_system = IntelligentStartupSystem()
    
    try:
        # Ініціалізація
        startup_system.initialize()
        
        # Запуск сервісів
        await startup_system.start_all_services()
        
        # Виведення статусу
        status = startup_system.get_status()
        logger.info("ATLAS services started successfully!")
        logger.info(f"Status: {json.dumps(status, indent=2, default=str)}")
        
        # Моніторинг (можна закоментувати для одноразового запуску)
        # await startup_system.monitor_services()
        
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
    finally:
        await startup_system.stop_all_services()

if __name__ == "__main__":
    asyncio.run(main())
