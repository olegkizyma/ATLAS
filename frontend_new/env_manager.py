#!/usr/bin/env python3
"""
ATLAS Python Environment Manager
Менеджер Python середовища для ATLAS
"""

import os
import sys
import subprocess
import venv
from pathlib import Path

class AtlasEnvironmentManager:
    def __init__(self, base_dir: str = None):
        if base_dir is None:
            base_dir = Path(__file__).parent
        else:
            base_dir = Path(base_dir)
        
        self.base_dir = base_dir
        self.venv_dir = base_dir / "venv"
        self.requirements_file = base_dir / "requirements.txt"
        self.activate_script = self.venv_dir / "bin" / "activate"
        
        # Для Windows
        if os.name == 'nt':
            self.activate_script = self.venv_dir / "Scripts" / "activate"
    
    def check_python(self):
        """Перевіряє доступність Python 3"""
        try:
            result = subprocess.run([sys.executable, "--version"], 
                                 capture_output=True, text=True, check=True)
            print(f"✅ Python знайдено: {result.stdout.strip()}")
            return True
        except subprocess.CalledProcessError:
            print("❌ Python не знайдено")
            return False
    
    def create_venv(self):
        """Створює віртуальне середовище"""
        if self.venv_dir.exists():
            print(f"✅ Віртуальне середовище вже існує: {self.venv_dir}")
            return True
        
        try:
            print(f"📦 Створюємо віртуальне середовище: {self.venv_dir}")
            venv.create(self.venv_dir, with_pip=True)
            print("✅ Віртуальне середовище створено")
            return True
        except Exception as e:
            print(f"❌ Помилка створення віртуального середовища: {e}")
            return False
    
    def get_venv_python(self):
        """Повертає шлях до Python у віртуальному середовищі"""
        if os.name == 'nt':
            return self.venv_dir / "Scripts" / "python.exe"
        else:
            return self.venv_dir / "bin" / "python"
    
    def get_venv_pip(self):
        """Повертає шлях до pip у віртуальному середовищі"""
        if os.name == 'nt':
            return self.venv_dir / "Scripts" / "pip.exe"
        else:
            return self.venv_dir / "bin" / "pip"
    
    def upgrade_pip(self):
        """Оновлює pip у віртуальному середовищі"""
        pip_path = self.get_venv_pip()
        if not pip_path.exists():
            print("❌ pip не знайдено у віртуальному середовищі")
            return False
        
        try:
            print("⬆️  Оновлюємо pip...")
            subprocess.run([str(pip_path), "install", "--upgrade", "pip"], 
                         check=True, capture_output=True)
            print("✅ pip оновлено")
            return True
        except subprocess.CalledProcessError as e:
            print(f"❌ Помилка оновлення pip: {e}")
            return False
    
    def install_requirements(self):
        """Встановлює залежності з requirements.txt"""
        if not self.requirements_file.exists():
            print(f"⚠️  Файл requirements.txt не знайдено: {self.requirements_file}")
            return False
        
        pip_path = self.get_venv_pip()
        if not pip_path.exists():
            print("❌ pip не знайдено у віртуальному середовищі")
            return False
        
        try:
            print("📦 Встановлюємо залежності з requirements.txt...")
            subprocess.run([str(pip_path), "install", "-r", str(self.requirements_file)], 
                         check=True, capture_output=False)
            print("✅ Всі залежності встановлено")
            return True
        except subprocess.CalledProcessError as e:
            print(f"❌ Помилка встановлення залежностей: {e}")
            return False
    
    def list_packages(self):
        """Показує встановлені пакети"""
        pip_path = self.get_venv_pip()
        if not pip_path.exists():
            print("❌ pip не знайдено у віртуальному середовищі")
            return False
        
        try:
            print("\n📋 Встановлені пакети:")
            # Спочатку пробуємо format=columns, якщо не працює - звичайний list
            try:
                subprocess.run([str(pip_path), "list", "--format=columns"], 
                             check=True, capture_output=False)
            except subprocess.CalledProcessError:
                # Fallback до звичайного списку
                subprocess.run([str(pip_path), "list"], 
                             check=True, capture_output=False)
            return True
        except subprocess.CalledProcessError as e:
            print(f"❌ Помилка отримання списку пакетів: {e}")
            return False
    
    def is_venv_active(self):
        """Перевіряє чи активоване віртуальне середовище"""
        return hasattr(sys, 'real_prefix') or (
            hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix
        )
    
    def get_activation_command(self):
        """Повертає команду для активації віртуального середовища"""
        if os.name == 'nt':
            return f"{self.venv_dir}\\Scripts\\activate"
        else:
            return f"source {self.venv_dir}/bin/activate"
    
    def setup_environment(self):
        """Повне налаштування середовища"""
        print("🔧 ATLAS Python Environment Setup")
        print("==================================")
        
        # Перевіряємо Python
        if not self.check_python():
            return False
        
        # Створюємо віртуальне середовище
        if not self.create_venv():
            return False
        
        # Оновлюємо pip
        if not self.upgrade_pip():
            return False
        
        # Встановлюємо залежності
        if not self.install_requirements():
            return False
        
        # Показуємо встановлені пакети
        self.list_packages()
        
        print("\n🎉 Налаштування завершено!")
        print(f"\nДля активації середовища використовуйте:")
        print(f"{self.get_activation_command()}")
        print(f"\nДля деактивації:")
        print("deactivate")
        
        return True
    
    def run_in_venv(self, script_path: str, *args):
        """Запускає скрипт у віртуальному середовищі"""
        python_path = self.get_venv_python()
        if not python_path.exists():
            print("❌ Python не знайдено у віртуальному середовищі")
            return False
        
        try:
            cmd = [str(python_path), script_path] + list(args)
            print(f"🚀 Запускаємо: {' '.join(cmd)}")
            subprocess.run(cmd, check=True)
            return True
        except subprocess.CalledProcessError as e:
            print(f"❌ Помилка запуску: {e}")
            return False
        except FileNotFoundError:
            print(f"❌ Файл не знайдено: {script_path}")
            return False

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='ATLAS Python Environment Manager')
    parser.add_argument('--setup', action='store_true', help='Налаштувати середовище')
    parser.add_argument('--run', type=str, help='Запустити скрипт у віртуальному середовищі')
    parser.add_argument('--list', action='store_true', help='Показати встановлені пакети')
    parser.add_argument('--status', action='store_true', help='Показати статус середовища')
    parser.add_argument('--dir', type=str, help='Базова директорія (за замовчуванням: поточна)')
    
    args = parser.parse_args()
    
    manager = AtlasEnvironmentManager(args.dir)
    
    if args.setup:
        success = manager.setup_environment()
        sys.exit(0 if success else 1)
    
    elif args.run:
        success = manager.run_in_venv(args.run)
        sys.exit(0 if success else 1)
    
    elif args.list:
        success = manager.list_packages()
        sys.exit(0 if success else 1)
    
    elif args.status:
        print("🔍 Статус середовища ATLAS")
        print("=" * 25)
        print(f"Базова директорія: {manager.base_dir}")
        print(f"Віртуальне середовище: {manager.venv_dir}")
        print(f"Існує: {'✅' if manager.venv_dir.exists() else '❌'}")
        print(f"Requirements файл: {'✅' if manager.requirements_file.exists() else '❌'}")
        print(f"Поточне середовище активоване: {'✅' if manager.is_venv_active() else '❌'}")
        print(f"Команда активації: {manager.get_activation_command()}")
        
        if manager.venv_dir.exists():
            python_path = manager.get_venv_python()
            print(f"Python в venv: {python_path}")
            if python_path.exists():
                try:
                    result = subprocess.run([str(python_path), "--version"], 
                                         capture_output=True, text=True, check=True)
                    print(f"Версія: {result.stdout.strip()}")
                except:
                    print("Версія: Невідома")
    
    else:
        # За замовчуванням показуємо статус та пропонуємо дії
        print("🔍 ATLAS Python Environment Manager")
        print("=" * 35)
        
        if not manager.venv_dir.exists():
            print("❌ Віртуальне середовище не налаштоване")
            print("Запустіть: python3 env_manager.py --setup")
        else:
            print("✅ Віртуальне середовище налаштоване")
            print("Доступні команди:")
            print("  --setup    - Перенастроїти середовище")
            print("  --run FILE - Запустити скрипт у середовищі")
            print("  --list     - Показати встановлені пакети")
            print("  --status   - Детальний статус")

if __name__ == "__main__":
    main()
