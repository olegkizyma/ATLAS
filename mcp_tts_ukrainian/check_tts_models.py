#!/usr/bin/env python3
"""
TTS Model Checker
=================

Скрипт для проверки загрузки украинской TTS модели.
Позволяет диагностировать проблемы с загрузкой моделей.
"""

import os
import sys
import logging
import traceback
from pathlib import Path

# Налаштування логування
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def check_pytorch():
    """Проверка PyTorch"""
    try:
        import torch
        logger.info(f"✅ PyTorch установлен, версия: {torch.__version__}")
        logger.info(f"   CUDA доступен: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            logger.info(f"   CUDA версия: {torch.version.cuda}")
            logger.info(f"   Доступные GPU: {torch.cuda.device_count()}")
        return True
    except ImportError:
        logger.error("❌ PyTorch не установлен")
        return False
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке PyTorch: {e}")
        return False

def check_ukrainian_tts():
    """Проверка Ukrainian TTS"""
    try:
        logger.info("Проверка ukrainian-tts...")
        import ukrainian_tts
        logger.info(f"✅ Ukrainian TTS установлен")
        
        # Проверка доступных путей для моделей
        model_path = None
        try:
            # Получаем путь к модулю
            module_path = Path(ukrainian_tts.__file__).parent
            logger.info(f"   Путь к модулю: {module_path}")
            
            # Проверяем наличие потенциальных директорий для моделей
            model_dirs = ['models', 'data', 'tts', 'model', 'resources']
            for dir_name in model_dirs:
                test_path = module_path / dir_name
                if test_path.exists():
                    logger.info(f"   Найдена директория: {test_path}")
                    model_path = test_path
        except Exception as e:
            logger.warning(f"   Ошибка при поиске директорий моделей: {e}")
        
        # Проверка класса TTS, если он существует
        try:
            from ukrainian_tts.tts import TTS
            logger.info("✅ Класс TTS доступен")
            
            logger.info("🔄 Создание экземпляра TTS (может занять время)...")
            tts = TTS(device='cpu')
            logger.info("✅ TTS инициализирован успешно")
            
            # Проверяем доступные голоса
            if hasattr(tts, 'voices'):
                logger.info(f"   Доступные голоса: {tts.voices}")
            elif hasattr(tts, 'Voices'):
                logger.info(f"   Доступные голоса: {tts.Voices}")
            else:
                logger.info("   Информация о голосах недоступна")
                
            # Проверяем модели
            if hasattr(tts, 'models'):
                logger.info(f"   Загруженные модели: {tts.models}")
            else:
                logger.info("   Информация о моделях недоступна")
                
            # Пробуем генерировать речь с маленьким текстом
            logger.info("🔄 Тестирование синтеза речи...")
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                test_file = tmp.name
            
            try:
                tts.tts("Тест", "mykyta", "dictionary", open(test_file, 'wb'))
                file_size = Path(test_file).stat().st_size
                logger.info(f"✅ Синтез успешен, размер файла: {file_size} байт")
                if file_size < 100:
                    logger.warning("⚠️ Сгенерированный файл слишком маленький!")
            except Exception as synth_error:
                logger.error(f"❌ Ошибка синтеза: {synth_error}")
                
            # Удаляем временный файл
            try:
                Path(test_file).unlink(missing_ok=True)
            except:
                pass
                
        except ImportError:
            logger.warning("⚠️ Класс TTS недоступен, проверяем функциональный API")
            
            # Проверка функционального API
            try:
                logger.info("🔄 Проверка функционального API...")
                import tempfile
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                    test_file = tmp.name
                
                ukrainian_tts.tts("Тест", "mykyta", open(test_file, 'wb'))
                file_size = Path(test_file).stat().st_size
                logger.info(f"✅ Синтез через функцию успешен, размер файла: {file_size} байт")
                if file_size < 100:
                    logger.warning("⚠️ Сгенерированный файл слишком маленький!")
                    
                # Удаляем временный файл
                try:
                    Path(test_file).unlink(missing_ok=True)
                except:
                    pass
            except Exception as func_error:
                logger.error(f"❌ Ошибка функционального API: {func_error}")
        except Exception as tts_error:
            logger.error(f"❌ Ошибка при инициализации TTS: {tts_error}")
            traceback.print_exc()
        
        return True
    except ImportError:
        logger.error("❌ Ukrainian TTS не установлен")
        return False
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке Ukrainian TTS: {e}")
        traceback.print_exc()
        return False

def check_audio():
    """Проверка аудио-библиотек"""
    try:
        logger.info("Проверка pygame...")
        import pygame
        logger.info(f"✅ Pygame установлен, версия: {pygame.ver}")
        
        try:
            logger.info("   Инициализация pygame.mixer...")
            pygame.mixer.init()
            logger.info("✅ Pygame mixer инициализирован")
        except Exception as mixer_error:
            logger.error(f"❌ Ошибка инициализации pygame.mixer: {mixer_error}")
        
        return True
    except ImportError:
        logger.error("❌ Pygame не установлен")
        return False
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке Pygame: {e}")
        return False

def check_gtts():
    """Проверка Google TTS"""
    try:
        logger.info("Проверка Google TTS (gTTS)...")
        from gtts import gTTS
        logger.info(f"✅ gTTS установлен")
        
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
                test_file = tmp.name
            
            logger.info("   Тестирование синтеза через gTTS...")
            tts = gTTS("Test", lang='en')
            tts.save(test_file)
            file_size = Path(test_file).stat().st_size
            logger.info(f"✅ Синтез через gTTS успешен, размер файла: {file_size} байт")
            
            # Удаляем временный файл
            try:
                Path(test_file).unlink(missing_ok=True)
            except:
                pass
        except Exception as gtts_error:
            logger.error(f"❌ Ошибка синтеза через gTTS: {gtts_error}")
        
        return True
    except ImportError:
        logger.error("❌ gTTS не установлен")
        return False
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке gTTS: {e}")
        return False

def main():
    """Основная функция"""
    logger.info("🔍 Запуск проверки TTS компонентов...")
    logger.info(f"Python: {sys.version}")
    logger.info(f"Текущая директория: {os.getcwd()}")
    
    # Проверка компонентов
    pytorch_ok = check_pytorch()
    ukrainian_tts_ok = check_ukrainian_tts()
    audio_ok = check_audio()
    gtts_ok = check_gtts()
    
    # Итоговый результат
    logger.info("\n===== РЕЗУЛЬТАТЫ ПРОВЕРКИ =====")
    logger.info(f"PyTorch:      {'✅' if pytorch_ok else '❌'}")
    logger.info(f"Ukrainian TTS: {'✅' if ukrainian_tts_ok else '❌'}")
    logger.info(f"Pygame Audio: {'✅' if audio_ok else '❌'}")
    logger.info(f"Google TTS:   {'✅' if gtts_ok else '❌'}")
    
    if all([pytorch_ok, ukrainian_tts_ok, audio_ok, gtts_ok]):
        logger.info("🎉 Все компоненты TTS в порядке!")
        return 0
    else:
        logger.warning("⚠️ Обнаружены проблемы с некоторыми компонентами TTS")
        return 1

if __name__ == "__main__":
    sys.exit(main())
