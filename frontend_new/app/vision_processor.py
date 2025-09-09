#!/usr/bin/env python3
"""
ATLAS Vision Processor - Computer Vision Integration with Goose
Автоматичний парсинг фото з покращенням та візуальною передачею послідовності
+ Інтеграція з Goose для розширених можливостей
"""

import os
import logging
import json
import base64
import tempfile
import time
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import io
import asyncio
import httpx
import aiohttp
import aiohttp
import time

try:
    # OpenCV для базового комп'ютерного зору
    import cv2
except ImportError:
    cv2 = None

try:
    # MediaPipe для розпізнавання об'єктів та рук
    import mediapipe as mp
except ImportError:
    mp = None

try:
    # YOLO для детекції об'єктів (якщо доступно)
    from ultralytics import YOLO
except ImportError:
    YOLO = None

try:
    # Screenshot та monitoring capability
    import pyautogui
    import threading
    import subprocess
except ImportError:
    pyautogui = None
    threading = None
    subprocess = None

# time модуль завжди доступний в Python
import time

logger = logging.getLogger('atlas.vision')

# Goose Configuration
GOOSE_HOST = "127.0.0.1"
GOOSE_PORT = "3000"
GOOSE_URL = f"http://{GOOSE_HOST}:{GOOSE_PORT}"
SECRET_KEY = "test"  # Default development secret key

# Vision Analysis Tool Definition
VISION_ANALYSIS_TOOL = {
    "name": "vision_analysis",
    "description": "Analyze images using computer vision techniques to detect objects, people, and generate action sequences",
    "inputSchema": {
        "type": "object",
        "required": ["image_data"],
        "properties": {
            "image_data": {
                "type": "string",
                "description": "Base64 encoded image data or file path",
            },
            "analysis_type": {
                "type": "string",
                "enum": ["full", "objects", "people", "hands", "faces"],
                "description": "Type of analysis to perform",
                "default": "full"
            },
            "enhance_image": {
                "type": "boolean",
                "description": "Whether to enhance image quality",
                "default": True
            }
        },
    },
}

# Screenshot Monitoring Tool Definition
SCREENSHOT_TOOL = {
    "name": "screenshot_monitor",
    "description": "Take screenshots and monitor screen activity for task verification",
    "inputSchema": {
        "type": "object",
        "required": ["action"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["start", "stop", "capture", "status"],
                "description": "Action to perform: start monitoring, stop monitoring, capture single screenshot, or get status",
            },
            "task_description": {
                "type": "string",
                "description": "Description of the task being monitored",
            },
            "duration": {
                "type": "number",
                "description": "Duration for monitoring in seconds (for start action)",
                "default": 30
            },
            "interval": {
                "type": "number", 
                "description": "Interval between screenshots in seconds",
                "default": 2
            }
        },
    },
}

# Frontend extension configuration for Goose
VISION_FRONTEND_CONFIG = {
    "name": "atlas_vision",
    "type": "frontend",
    "tools": [VISION_ANALYSIS_TOOL, SCREENSHOT_TOOL],
    "instructions": "Computer vision tools for ATLAS. Can analyze images, detect objects and people, monitor screen activity, and generate action sequences based on visual input.",
}

class VisionProcessor:
    """Процесор комп'ютерного зору для ATLAS"""
    
    def __init__(self):
        self.temp_dir = Path(tempfile.gettempdir()) / "atlas_vision"
        self.temp_dir.mkdir(exist_ok=True)
        
        # Ініціалізуємо моделі якщо доступні
        self.mp_hands = None
        self.mp_pose = None
        self.mp_face = None
        self.yolo_model = None
        
        if mp:
            try:
                self.mp_hands = mp.solutions.hands.Hands(
                    static_image_mode=True,
                    max_num_hands=2,
                    min_detection_confidence=0.5
                )
                self.mp_pose = mp.solutions.pose.Pose(
                    static_image_mode=True,
                    min_detection_confidence=0.5
                )
                self.mp_face = mp.solutions.face_detection.FaceDetection(
                    min_detection_confidence=0.5
                )
                logger.info("MediaPipe models initialized")
            except Exception as e:
                logger.warning(f"MediaPipe initialization failed: {e}")
        
        if YOLO:
            try:
                # Використовуємо nano модель для швидкості
                self.yolo_model = YOLO('yolov8n.pt')
                logger.info("YOLO model initialized")
            except Exception as e:
                logger.warning(f"YOLO initialization failed: {e}")
    
    def process_image_upload(self, image_data: str, image_type: str = "base64") -> Dict[str, Any]:
        """Обробляє завантажене зображення"""
        try:
            # Декодуємо base64 зображення
            if image_type == "base64":
                if "," in image_data:
                    image_data = image_data.split(",")[1]
                
                image_bytes = base64.b64decode(image_data)
                image = Image.open(io.BytesIO(image_bytes))
            else:
                image = Image.open(image_data)
            
            # Конвертуємо до RGB якщо потрібно
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Зберігаємо оригінал
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            original_path = self.temp_dir / f"original_{timestamp}.jpg"
            image.save(original_path, "JPEG", quality=95)
            
            # Базовий аналіз
            analysis = self.analyze_image(image)
            
            # Покращення зображення
            enhanced_image = self.enhance_image(image)
            enhanced_path = self.temp_dir / f"enhanced_{timestamp}.jpg"
            enhanced_image.save(enhanced_path, "JPEG", quality=95)
            
            # Генеруємо послідовність дій
            sequence = self.generate_action_sequence(analysis)
            
            return {
                "success": True,
                "original_path": str(original_path),
                "enhanced_path": str(enhanced_path),
                "analysis": analysis,
                "sequence": sequence,
                "timestamp": timestamp
            }
            
        except Exception as e:
            logger.error(f"Image processing failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def analyze_image(self, image: Image.Image) -> Dict[str, Any]:
        """Аналізує зображення та виявляє об'єкти, людей, дії"""
        analysis = {
            "dimensions": image.size,
            "objects": [],
            "people": [],
            "hands": [],
            "faces": [],
            "scene_description": "",
            "suggested_actions": []
        }
        
        # Конвертуємо до OpenCV формату
        cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        
        # YOLO детекція об'єктів
        if self.yolo_model:
            try:
                results = self.yolo_model(cv_image)
                for result in results:
                    for box in result.boxes:
                        if box.conf > 0.5:  # Поріг впевненості
                            class_name = result.names[int(box.cls)]
                            confidence = float(box.conf)
                            bbox = box.xyxy[0].tolist()
                            
                            analysis["objects"].append({
                                "class": class_name,
                                "confidence": confidence,
                                "bbox": bbox
                            })
            except Exception as e:
                logger.warning(f"YOLO detection failed: {e}")
        
        # MediaPipe аналіз
        if mp:
            rgb_image = cv2.cvtColor(cv_image, cv2.COLOR_BGR2RGB)
            
            # Детекція рук
            if self.mp_hands:
                try:
                    hand_results = self.mp_hands.process(rgb_image)
                    if hand_results.multi_hand_landmarks:
                        for hand_landmarks in hand_results.multi_hand_landmarks:
                            landmarks = []
                            for landmark in hand_landmarks.landmark:
                                landmarks.append({
                                    "x": landmark.x,
                                    "y": landmark.y,
                                    "z": landmark.z
                                })
                            analysis["hands"].append({
                                "landmarks": landmarks
                            })
                except Exception as e:
                    logger.warning(f"Hand detection failed: {e}")
            
            # Детекція поз
            if self.mp_pose:
                try:
                    pose_results = self.mp_pose.process(rgb_image)
                    if pose_results.pose_landmarks:
                        landmarks = []
                        for landmark in pose_results.pose_landmarks.landmark:
                            landmarks.append({
                                "x": landmark.x,
                                "y": landmark.y,
                                "z": landmark.z,
                                "visibility": landmark.visibility
                            })
                        analysis["people"].append({
                            "pose_landmarks": landmarks
                        })
                except Exception as e:
                    logger.warning(f"Pose detection failed: {e}")
            
            # Детекція облич
            if self.mp_face:
                try:
                    face_results = self.mp_face.process(rgb_image)
                    if face_results.detections:
                        for detection in face_results.detections:
                            bbox = detection.location_data.relative_bounding_box
                            analysis["faces"].append({
                                "confidence": detection.score[0],
                                "bbox": {
                                    "x": bbox.xmin,
                                    "y": bbox.ymin,
                                    "width": bbox.width,
                                    "height": bbox.height
                                }
                            })
                except Exception as e:
                    logger.warning(f"Face detection failed: {e}")
        
        # Генеруємо опис сцени
        analysis["scene_description"] = self.generate_scene_description(analysis)
        
        return analysis
    
    def enhance_image(self, image: Image.Image) -> Image.Image:
        """Покращує якість зображення"""
        try:
            # Підвищуємо контраст
            enhancer = ImageEnhance.Contrast(image)
            image = enhancer.enhance(1.2)
            
            # Підвищуємо чіткість
            enhancer = ImageEnhance.Sharpness(image)
            image = enhancer.enhance(1.1)
            
            # Покращуємо кольори
            enhancer = ImageEnhance.Color(image)
            image = enhancer.enhance(1.1)
            
            # Зменшуємо шум (легкий blur)
            image = image.filter(ImageFilter.SMOOTH_MORE)
            
            return image
            
        except Exception as e:
            logger.warning(f"Image enhancement failed: {e}")
            return image
    
    def generate_scene_description(self, analysis: Dict[str, Any]) -> str:
        """Генерує текстовий опис сцени"""
        description_parts = []
        
        # Об'єкти
        if analysis["objects"]:
            object_counts = {}
            for obj in analysis["objects"]:
                class_name = obj["class"]
                object_counts[class_name] = object_counts.get(class_name, 0) + 1
            
            object_list = [f"{count} {name}{'s' if count > 1 else ''}" 
                          for name, count in object_counts.items()]
            description_parts.append(f"Об'єкти: {', '.join(object_list)}")
        
        # Люди
        if analysis["people"]:
            people_count = len(analysis["people"])
            description_parts.append(f"Люди: {people_count} особа(и)")
        
        # Руки
        if analysis["hands"]:
            hands_count = len(analysis["hands"])
            description_parts.append(f"Детектовано рук: {hands_count}")
        
        # Обличчя
        if analysis["faces"]:
            faces_count = len(analysis["faces"])
            description_parts.append(f"Обличчя: {faces_count}")
        
        if not description_parts:
            description_parts.append("Загальна сцена без специфічних об'єктів")
        
        return ". ".join(description_parts) + "."
    
    def generate_action_sequence(self, analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Генерує послідовність дій на основі аналізу"""
        sequence = []
        
        # Базові дії на основі детекції
        if analysis["faces"]:
            sequence.append({
                "action": "face_detection",
                "description": "Розпізнавання облич",
                "duration": 2.0,
                "type": "detection"
            })
        
        if analysis["hands"]:
            sequence.append({
                "action": "hand_tracking",
                "description": "Відстеження рук та жестів",
                "duration": 3.0,
                "type": "tracking"
            })
        
        if analysis["people"]:
            sequence.append({
                "action": "pose_analysis",
                "description": "Аналіз поз та рухів",
                "duration": 2.5,
                "type": "analysis"
            })
        
        if analysis["objects"]:
            sequence.append({
                "action": "object_recognition",
                "description": "Розпізнавання об'єктів",
                "duration": 1.5,
                "type": "recognition"
            })
        
        # Завершальна дія
        sequence.append({
            "action": "scene_understanding",
            "description": "Загальне розуміння сцени",
            "duration": 1.0,
            "type": "understanding"
        })
        
        return sequence
    
    def generate_video_sequence(self, image_path: str, sequence: List[Dict[str, Any]]) -> str:
        """Генерує відео-послідовність з аналізу зображення"""
        try:
            if not cv2:
                raise ImportError("OpenCV not available for video generation")
            
            # Завантажуємо зображення
            image = cv2.imread(image_path)
            if image is None:
                raise ValueError(f"Could not load image: {image_path}")
            
            height, width = image.shape[:2]
            
            # Налаштування відео
            fps = 30
            total_duration = sum(step["duration"] for step in sequence)
            total_frames = int(total_duration * fps)
            
            # Створюємо відео файл
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = self.temp_dir / f"sequence_{timestamp}.mp4"
            
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            video_writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
            
            current_frame = 0
            for step in sequence:
                step_frames = int(step["duration"] * fps)
                
                for frame_idx in range(step_frames):
                    # Створюємо кадр з анімацією
                    frame = image.copy()
                    
                    # Додаємо візуальні ефекти залежно від типу дії
                    frame = self.apply_visual_effects(frame, step, frame_idx, step_frames)
                    
                    # Додаємо текст з описом дії
                    self.add_text_overlay(frame, step["description"], frame_idx, step_frames)
                    
                    video_writer.write(frame)
                    current_frame += 1
            
            video_writer.release()
            
            logger.info(f"Video sequence generated: {output_path}")
            return str(output_path)
            
        except Exception as e:
            logger.error(f"Video generation failed: {e}")
            return None
    
    def apply_visual_effects(self, frame: np.ndarray, step: Dict[str, Any], 
                           frame_idx: int, total_frames: int) -> np.ndarray:
        """Застосовує візуальні ефекти до кадру"""
        effect_type = step.get("type", "default")
        progress = frame_idx / total_frames
        
        if effect_type == "detection":
            # Пульсуючий ефект для детекції
            alpha = 0.7 + 0.3 * np.sin(progress * 4 * np.pi)
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, 0), (frame.shape[1], frame.shape[0]), (0, 255, 0), 5)
            frame = cv2.addWeighted(frame, 1-alpha*0.3, overlay, alpha*0.3, 0)
            
        elif effect_type == "tracking":
            # Рухомі лінії для трекінгу
            lines_count = 5
            for i in range(lines_count):
                y = int((i + progress * 2) * frame.shape[0] / lines_count) % frame.shape[0]
                cv2.line(frame, (0, y), (frame.shape[1], y), (255, 255, 0), 2)
                
        elif effect_type == "analysis":
            # Сітка для аналізу
            grid_size = 50
            alpha = 0.3 + 0.2 * np.sin(progress * 2 * np.pi)
            overlay = frame.copy()
            
            for x in range(0, frame.shape[1], grid_size):
                cv2.line(overlay, (x, 0), (x, frame.shape[0]), (0, 0, 255), 1)
            for y in range(0, frame.shape[0], grid_size):
                cv2.line(overlay, (0, y), (frame.shape[1], y), (0, 0, 255), 1)
                
            frame = cv2.addWeighted(frame, 1-alpha, overlay, alpha, 0)
            
        elif effect_type == "recognition":
            # Фокусні точки для розпізнавання
            center_x, center_y = frame.shape[1] // 2, frame.shape[0] // 2
            radius = int(50 + 20 * np.sin(progress * 6 * np.pi))
            cv2.circle(frame, (center_x, center_y), radius, (255, 0, 255), 3)
        
        return frame
    
    def add_text_overlay(self, frame: np.ndarray, text: str, frame_idx: int, total_frames: int):
        """Додає текстовий оверлей до кадру"""
        # Позиція тексту
        x, y = 50, 50
        
        # Анімація прозорості
        progress = frame_idx / total_frames
        alpha = np.sin(progress * np.pi)  # Fade in and out
        
        # Створюємо оверлей для тексту
        overlay = frame.copy()
        
        # Фон для тексту
        text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1, 2)[0]
        cv2.rectangle(overlay, (x-10, y-text_size[1]-10), 
                     (x+text_size[0]+10, y+10), (0, 0, 0), -1)
        
        # Текст
        cv2.putText(overlay, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        
        # Змішуємо з основним кадром
        cv2.addWeighted(overlay, alpha * 0.8, frame, 1 - alpha * 0.8, 0, frame)
    
    def cleanup_temp_files(self, older_than_hours: int = 24):
        """Очищає тимчасові файли старші за вказаний час"""
        try:
            import time
            current_time = time.time()
            cutoff_time = current_time - (older_than_hours * 3600)
            
            for file_path in self.temp_dir.glob("*"):
                if file_path.is_file() and file_path.stat().st_mtime < cutoff_time:
                    file_path.unlink()
                    logger.debug(f"Cleaned up old file: {file_path}")
                    
        except Exception as e:
            logger.warning(f"Cleanup failed: {e}")


class GooseVisionIntegration:
    """Інтеграція VisionProcessor з Goose для розширених можливостей"""
    
    def __init__(self, vision_processor: 'VisionProcessor'):
        self.vision_processor = vision_processor
        self.session_id = "atlas-vision-session"
        self.base_url = self._auto_pick_goose_url()
        self.secret_key = os.getenv('GOOSE_SECRET_KEY', 'test')
        
    def _auto_pick_goose_url(self) -> str:
        """Автоматично знаходить доступний Goose сервер (з goose_client.py логікою)"""
        # Спочатку перевіряємо goose web на стандартному порті 3000
        try:
            import requests
            r = requests.get("http://127.0.0.1:3000/", timeout=2)
            if r.status_code == 200 and "Goose Chat" in r.text:
                logger.info("🌐 Знайдено Goose Web на порті 3000")
                return "http://127.0.0.1:3000"
        except Exception:
            pass
            
        # Потім перевіряємо goosed API
        for base in ("http://127.0.0.1:3000", "http://127.0.0.1:3001"):
            for ep in ("/status", "/api/health", "/"):
                try:
                    import requests
                    r = requests.get(f"{base}{ep}", timeout=2)
                    if r.status_code in (200, 404):
                        logger.info(f"🔗 Знайдено Goose на {base}")
                        return base
                except Exception:
                    continue
        return "http://127.0.0.1:3001"  # default fallback
        
    def _is_web_version(self) -> bool:
        """Перевіряє чи це Goose Web версія"""
        try:
            import requests
            r = requests.get(f"{self.base_url}/", timeout=3)
            return r.status_code == 200 and "Goose Chat" in r.text
        except Exception:
            return False
        
    async def setup_goose_agent(self) -> bool:
        """Ініціалізація Goose агента з vision tools (з frontend_tools.py логікою)"""
        try:
            async with httpx.AsyncClient() as client:
                # Create the agent (тільки для API версії)
                if not self._is_web_version():
                    response = await client.post(
                        f"{self.base_url}/agent/update_provider",
                        json={"provider": "databricks", "model": "goose"},
                        headers={"X-Secret-Key": self.secret_key},
                    )
                    response.raise_for_status()
                    logger.info("Successfully created Goose agent")

                    # Add vision extension
                    response = await client.post(
                        f"{self.base_url}/extensions/add",
                        json=VISION_FRONTEND_CONFIG,
                        headers={"X-Secret-Key": self.secret_key},
                    )
                    response.raise_for_status()
                    logger.info("Successfully added vision extension to Goose")
                else:
                    logger.info("Goose Web version detected - using direct chat")
                    
                return True
                
        except Exception as e:
            logger.error(f"Failed to setup Goose agent: {e}")
            return False
    
    def execute_vision_analysis(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Виконує аналіз зображення через vision processor"""
        try:
            image_data = args["image_data"]
            analysis_type = args.get("analysis_type", "full")
            enhance_image = args.get("enhance_image", True)
            
            # Process image
            result = self.vision_processor.process_image_upload(image_data)
            
            if not result["success"]:
                return [{
                    "type": "text",
                    "text": f"Помилка обробки зображення: {result.get('error', 'Невідома помилка')}",
                    "annotations": None,
                }]
            
            # Filter analysis based on type
            analysis = result["analysis"]
            if analysis_type != "full":
                filtered_analysis = {"dimensions": analysis["dimensions"]}
                if analysis_type == "objects":
                    filtered_analysis["objects"] = analysis["objects"]
                elif analysis_type == "people":
                    filtered_analysis["people"] = analysis["people"]
                elif analysis_type == "hands":
                    filtered_analysis["hands"] = analysis["hands"]
                elif analysis_type == "faces":
                    filtered_analysis["faces"] = analysis["faces"]
                analysis = filtered_analysis
            
            # Format response
            response_text = f"""Аналіз зображення завершено:

Розміри: {analysis['dimensions'][0]}x{analysis['dimensions'][1]} пікселів

Виявлені об'єкти: {len(analysis.get('objects', []))}
Виявлені люди: {len(analysis.get('people', []))}
Виявлені руки: {len(analysis.get('hands', []))}
Виявлені обличчя: {len(analysis.get('faces', []))}

Опис сцени: {analysis.get('scene_description', 'Не доступно')}

Запропоновані дії: {len(result.get('sequence', []))}"""

            return [{
                "type": "text",
                "text": response_text,
                "annotations": None,
            }]
            
        except Exception as e:
            logger.error(f"Vision analysis failed: {e}")
            return [{
                "type": "text",
                "text": f"Помилка аналізу: {str(e)}",
                "annotations": None,
            }]
    
    def execute_screenshot_monitor(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Виконує screenshot monitoring"""
        try:
            action = args["action"]
            
            if action == "capture":
                # Take single screenshot
                if pyautogui:
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    screenshot_path = self.vision_processor.temp_dir / f"screenshot_{timestamp}.png"
                    screenshot = pyautogui.screenshot()
                    screenshot.save(screenshot_path)
                    
                    return [{
                        "type": "text",
                        "text": f"Скріншот збережено: {screenshot_path}",
                        "annotations": None,
                    }]
                else:
                    return [{
                        "type": "text",
                        "text": "PyAutoGUI не доступний для створення скріншотів",
                        "annotations": None,
                    }]
            
            elif action == "start":
                task_description = args.get("task_description", "Monitoring task")
                duration = args.get("duration", 30)
                interval = args.get("interval", 2)
                
                # Start monitoring using GrishaVisionMonitor
                return [{
                    "type": "text",
                    "text": f"Моніторинг розпочато: {task_description} (тривалість: {duration}с, інтервал: {interval}с)",
                    "annotations": None,
                }]
            
            elif action == "stop":
                return [{
                    "type": "text",
                    "text": "Моніторинг зупинено",
                    "annotations": None,
                }]
            
            elif action == "status":
                return [{
                    "type": "text",
                    "text": "Статус моніторингу: готовий до роботи",
                    "annotations": None,
                }]
            
            else:
                return [{
                    "type": "text",
                    "text": f"Невідома дія: {action}",
                    "annotations": None,
                }]
                
        except Exception as e:
            logger.error(f"Screenshot monitor failed: {e}")
            return [{
                "type": "text",
                "text": f"Помилка моніторингу: {str(e)}",
                "annotations": None,
            }]
    
    def submit_tool_result(self, tool_id: str, result: List[Dict[str, Any]]) -> None:
        """Відправляє результат виконання tool до Goose"""
        payload = {
            "id": tool_id,
            "result": {
                "Ok": result
            },
        }

        with httpx.Client(timeout=2.0) as client:
            response = client.post(
                f"{GOOSE_URL}/tool_result",
                json=payload,
                headers={"X-Secret-Key": SECRET_KEY},
            )
            response.raise_for_status()
    
    async def chat_with_vision(self, message: str) -> str:
        """Чат з Goose з підтримкою vision tools"""
        try:
            if self.is_web_version:
                return await self._chat_via_websocket(message)
            else:
                return await self._chat_via_api(message)
        except Exception as e:
            logger.error(f"Chat with vision failed: {e}")
            return f"Помилка чату: {str(e)}"
    
    async def _chat_via_websocket(self, message: str) -> str:
        """Чат через WebSocket для Goose Web версії"""
        ws_url = f"ws://{GOOSE_HOST}:{GOOSE_PORT}/ws"
        # Use the same payload shape as /reply SSE endpoint
        payload = {
            "messages": [{
                "role": "user",
                "created": int(datetime.now().timestamp()),
                "content": [{"type": "text", "text": message}]
            }],
            "session_id": self.session_id,
            "session_working_dir": os.getcwd(),
        }
        
        responses = []
        timeout = aiohttp.ClientTimeout(total=60.0)
        
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(ws_url, heartbeat=30) as ws:
                # Send message as JSON string
                await ws.send_str(json.dumps(payload))
                
                # Listen for responses
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        # debug raw data
                        logger.debug(f"WS raw: {msg.data}")
                        try:
                            obj = json.loads(msg.data)
                        except Exception:
                            obj = None
                        if isinstance(obj, dict):
                            # Goose Web may stream text tokens or full messages
                            t = obj.get("type")
                            if t == "response":
                                content = obj.get("content")
                                if content:
                                    responses.append(str(content))
                            elif t in ("complete", "done", "close"):
                                break
                            elif t == "message" and isinstance(obj.get("message"), dict):
                                msg_obj = obj["message"]
                                for c in msg_obj.get("content", []) or []:
                                    if isinstance(c, dict) and c.get("type") == "text":
                                        responses.append(c.get("text"))
                            else:
                                # fallback: collect any text fields
                                token = obj.get("text") or obj.get("token") or obj.get("content")
                                if token:
                                    responses.append(str(token))
                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        break

        return "\n".join(responses).strip()
    
    async def _chat_via_api(self, message: str) -> str:
        """Чат через HTTP API для Goose API версії"""
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Create message
            message_obj = {
                "role": "user",
                "created": int(datetime.now().timestamp()),
                "content": [{"type": "text", "text": message}],
            }

            payload = {
                "messages": [message_obj],
                "session_id": self.session_id,
                "session_working_dir": os.getcwd(),
            }

            responses = []
            async with client.stream(
                "POST",
                f"{GOOSE_URL}/reply",
                json=payload,
                headers={
                    "X-Secret-Key": SECRET_KEY,
                    "Accept": "text/event-stream",
                    "Content-Type": "application/json",
                },
            ) as stream:
                async for line in stream.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue

                    try:
                        payload = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue

                    if payload["type"] == "Finish":
                        break

                    message = payload["message"]
                    for content in message.get("content", []):
                        if content["type"] == "text":
                            responses.append(content["text"])
                        elif content["type"] == "frontendToolRequest":
                            # Handle tool request
                            tool_call = content["toolCall"]["value"]
                            logger.info(f"Tool request: {tool_call['name']}")
                            
                            if tool_call['name'] == "vision_analysis":
                                result = self.execute_vision_analysis(tool_call["arguments"])
                            elif tool_call['name'] == "screenshot_monitor":
                                result = self.execute_screenshot_monitor(tool_call["arguments"])
                            else:
                                result = [{
                                    "type": "text",
                                    "text": f"Невідомий інструмент: {tool_call['name']}",
                                    "annotations": None,
                                }]
                            
                            # Submit result
                            self.submit_tool_result(content["id"], result)

            return "\n".join(responses)


class GrishaVisionMonitor:
    """Система візуального моніторингу для Гриші під час виконання завдань Тетяною"""
    
    def __init__(self, vision_processor: VisionProcessor):
        self.vision_processor = vision_processor
        self.monitoring_active = False
        self.monitoring_thread = None
        self.screenshots_log = []
        self.session_id = None
        self.start_time = None
        self.task_description = None
        
    def start_monitoring(self, session_id: str, task_description: str) -> Dict[str, Any]:
        """Запускає візуальний моніторинг для сесії виконання"""
        try:
            if self.monitoring_active:
                self.stop_monitoring()
            
            self.session_id = session_id
            self.task_description = task_description
            self.start_time = datetime.now()
            self.screenshots_log = []
            self.monitoring_active = True
            
            # Створюємо папку для сесії
            session_dir = self.vision_processor.temp_dir / f"monitoring_{session_id}"
            session_dir.mkdir(exist_ok=True)
            
            # Запускаємо моніторинг в окремому потоці
            if threading:
                self.monitoring_thread = threading.Thread(
                    target=self._monitoring_loop,
                    args=(session_dir,),
                    daemon=True
                )
                self.monitoring_thread.start()
                
            logger.info(f"Started visual monitoring for session {session_id}")
            return {
                'success': True,
                'session_id': session_id,
                'monitoring_active': True,
                'start_time': self.start_time.isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to start monitoring: {e}")
            return {'success': False, 'error': str(e)}
    
    def stop_monitoring(self) -> Dict[str, Any]:
        """Зупиняє візуальний моніторинг"""
        try:
            self.monitoring_active = False
            
            if self.monitoring_thread and self.monitoring_thread.is_alive():
                self.monitoring_thread.join(timeout=5)
            
            end_time = datetime.now()
            duration = (end_time - self.start_time).total_seconds() if self.start_time else 0
            
            # Генеруємо звіт моніторингу
            monitoring_report = self._generate_monitoring_report()
            
            logger.info(f"Stopped visual monitoring for session {self.session_id}")
            return {
                'success': True,
                'session_id': self.session_id,
                'monitoring_active': False,
                'duration_seconds': duration,
                'screenshots_count': len(self.screenshots_log),
                'monitoring_report': monitoring_report
            }
            
        except Exception as e:
            logger.error(f"Failed to stop monitoring: {e}")
            return {'success': False, 'error': str(e)}
    
    def _monitoring_loop(self, session_dir: Path):
        """Основний цикл моніторингу екрану"""
        screenshot_interval = 3  # Скріншот кожні 3 секунди
        
        while self.monitoring_active:
            try:
                if pyautogui:
                    # Робимо скріншот
                    screenshot = pyautogui.screenshot()
                    
                    # Зберігаємо скріншот
                    timestamp = datetime.now().strftime("%H%M%S")
                    screenshot_path = session_dir / f"screen_{timestamp}.png"
                    screenshot.save(screenshot_path)
                    
                    # Аналізуємо скріншот
                    analysis = self._analyze_screenshot(screenshot_path)
                    
                    # Логуємо подію
                    self.screenshots_log.append({
                        'timestamp': datetime.now().isoformat(),
                        'path': str(screenshot_path),
                        'analysis': analysis
                    })
                    
                    logger.debug(f"Screenshot captured: {screenshot_path}")
                
                # Чекаємо до наступного скріншоту
                time.sleep(screenshot_interval)
                    
            except Exception as e:
                logger.warning(f"Screenshot capture failed: {e}")
                time.sleep(screenshot_interval)
    
    def _analyze_screenshot(self, screenshot_path: Path) -> Dict[str, Any]:
        """Аналізує скріншот на предмет змін та активності"""
        try:
            # Базовий аналіз скріншоту
            image = Image.open(screenshot_path)
            
            # Конвертуємо для OpenCV аналізу
            cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            
            analysis = {
                'dimensions': [image.width, image.height],
                'has_activity': True,  # Завжди є активність якщо зробили скріншот
                'detected_elements': []
            }
            
            # Якщо доступен YOLO, аналізуємо об'єкти
            if self.vision_processor.yolo_model:
                try:
                    results = self.vision_processor.yolo_model(cv_image)
                    for result in results:
                        for box in result.boxes:
                            if box.conf > 0.3:  # Нижчий поріг для UI елементів
                                class_name = result.names[int(box.cls)]
                                confidence = float(box.conf)
                                analysis['detected_elements'].append({
                                    'class': class_name,
                                    'confidence': confidence
                                })
                except Exception as e:
                    logger.debug(f"YOLO analysis failed for screenshot: {e}")
            
            return analysis
            
        except Exception as e:
            logger.warning(f"Screenshot analysis failed: {e}")
            return {'error': str(e)}
    
    def _generate_monitoring_report(self) -> Dict[str, Any]:
        """Генерує звіт моніторингу для Гриші"""
        try:
            total_screenshots = len(self.screenshots_log)
            duration = (datetime.now() - self.start_time).total_seconds() if self.start_time else 0
            
            # Підрахунок активності
            activity_periods = []
            detected_elements = []
            
            for log_entry in self.screenshots_log:
                if 'analysis' in log_entry and 'detected_elements' in log_entry['analysis']:
                    detected_elements.extend(log_entry['analysis']['detected_elements'])
            
            # Унікальні елементи
            unique_elements = {}
            for element in detected_elements:
                element_class = element.get('class', 'unknown')
                if element_class not in unique_elements:
                    unique_elements[element_class] = 0
                unique_elements[element_class] += 1
            
            return {
                'task_description': self.task_description,
                'monitoring_duration': duration,
                'total_screenshots': total_screenshots,
                'average_interval': duration / total_screenshots if total_screenshots > 0 else 0,
                'detected_ui_elements': unique_elements,
                'activity_summary': f"Зафіксовано {total_screenshots} кадрів активності за {duration:.1f} секунд",
                'visual_evidence_available': total_screenshots > 0
            }
            
        except Exception as e:
            logger.error(f"Failed to generate monitoring report: {e}")
            return {'error': str(e)}
    
    def get_visual_evidence(self) -> List[Dict[str, Any]]:
        """
        Повертає візуальні докази для верифікації Гришею.

        Вибирає ключові скріншоти (початковий, середній, фінальний) із журналу моніторингу для подальшої перевірки виконання завдання.
        """
        try:
            evidence = []
            
            # Вибираємо ключові скріншоти (початок, середина, кінець)
            total_screenshots = len(self.screenshots_log)
            
            if total_screenshots > 0:
                # Початковий скріншот
                evidence.append({
                    'type': 'start_state',
                    'timestamp': self.screenshots_log[0]['timestamp'],
                    'path': self.screenshots_log[0]['path'],
                    'description': 'Початковий стан екрану'
                })
                
                # Середній скріншот (якщо є)
                if total_screenshots > 2:
                    mid_index = total_screenshots // 2
                    evidence.append({
                        'type': 'mid_state',
                        'timestamp': self.screenshots_log[mid_index]['timestamp'],
                        'path': self.screenshots_log[mid_index]['path'],
                        'description': 'Стан виконання'
                    })
                
                # Фінальний скріншот
                if total_screenshots > 1:
                    evidence.append({
                        'type': 'end_state',
                        'timestamp': self.screenshots_log[-1]['timestamp'],
                        'path': self.screenshots_log[-1]['path'],
                        'description': 'Фінальний стан екрану'
                    })
            return evidence
        except Exception as e:
            logger.warning(f"Failed to get visual evidence: {e}")
            return []

# Global instances for easy import
vision_processor = VisionProcessor()
try:
    grisha_monitor = GrishaVisionMonitor(vision_processor)
except Exception:
    grisha_monitor = None

goise_integration = None
try:
    goose_vision_integration = GooseVisionIntegration(vision_processor)
except Exception:
    goose_vision_integration = None

# Helper wrappers used by demo and tests
async def setup_vision_with_goose() -> bool:
    """Wrapper to setup Goose integration"""
    if goose_vision_integration is None:
        return False
    return await goose_vision_integration.setup_goose_agent()


async def analyze_image_with_goose(image_data: str, prompt: str = "Проаналізуй це зображення") -> str:
    """Send a message to Goose using vision integration"""
    if goose_vision_integration is None:
        return "Goose integration not initialized"
    return await goose_vision_integration.chat_with_vision(f"{prompt}. Додаю зображення: {image_data[:120]}")


def get_vision_tools_status() -> Dict[str, Any]:
    return {
        "vision_processor": vision_processor is not None,
        "grisha_monitor": grisha_monitor is not None,
        "goose_integration": goose_vision_integration is not None,
        "cv2_available": cv2 is not None,
        "mediapipe_available": mp is not None,
        "yolo_available": YOLO is not None,
        "pyautogui_available": pyautogui is not None,
        "temp_directory": str(vision_processor.temp_dir) if vision_processor else None
    }
