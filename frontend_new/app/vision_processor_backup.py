#!/usr/bin/env pythtry:
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
    # Screenshot capability for monitoring
    import pyautogui
    import threading
    import time
except ImportError:
    pyautogui = None
    threading = None
    time = Noneion Processor - Computer Vision Integration
Автоматичний парсинг фото з покращенням та візуальною передачею послідовності
"""

import os
import logging
import json
import base64
import tempfile
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import io

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

logger = logging.getLogger('atlas.vision')

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
                    logger.debug(f"Cleaned up temp file: {file_path}")
                    
        except Exception as e:
            logger.warning(f"Temp file cleanup failed: {e}")


# Глобальний інстанс процесора
vision_processor = VisionProcessor()
