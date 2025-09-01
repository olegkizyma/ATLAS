#!/usr/bin/env python3
"""
ATLAS Voice API - Інтелектуальні голосові API для агентів
Використовує розумні відповіді замість хардкодених повідомлень
"""

import logging
from flask import Blueprint, request, jsonify, Response
from core.intelligent_voice_manager import IntelligentVoiceManager
from core.intelligent_response_generator import IntelligentResponseGenerator

logger = logging.getLogger(__name__)

# Створюємо Blueprint для voice API
voice_bp = Blueprint('voice', __name__, url_prefix='/api/voice')

# Ініціалізуємо глобальні менеджери
voice_manager = IntelligentVoiceManager()
response_generator = IntelligentResponseGenerator()

@voice_bp.route('/synthesize', methods=['POST'])
def synthesize_speech():
    """
    Синтезувати мовлення для тексту
    
    POST /api/voice/synthesize
    Body: {
        "text": "текст для синтезу",
        "agent": "atlas|tetyana|grisha" (опціонально - визначиться автоматично)
    }
    """
    try:
        data = request.get_json()
        if not data:
            # Використовуємо розумну відповідь замість хардкодених повідомлень
            error_response = response_generator.generate_response_sync(
                context="API отримав запит без даних для синтезу голосу",
                response_type="error",
                agent="grisha",
                user_action="відправка пустого запиту до /api/voice/synthesize"
            )
            return jsonify({
                "success": False, 
                "intelligent_error": error_response["content"],
                "agent": error_response["agent"]
            }), 400
        
        text = data.get('text', '').strip()
        if not text:
            # Розумна відповідь для порожнього тексту
            error_response = response_generator.generate_response_sync(
                context="Користувач надіслав порожній текст для голосового синтезу",
                response_type="error",
                agent="tetyana",
                user_action="спроба синтезу голосу без тексту"
            )
            return jsonify({
                "success": False,
                "intelligent_error": error_response["content"],
                "agent": error_response["agent"]
            }), 400
        
        agent = data.get('agent')
        
        # Синтезуємо мовлення
        result = voice_manager.synthesize_speech(text, agent)
        
        if result["success"]:
            # Розумна відповідь про успіх
            success_response = response_generator.generate_response_sync(
                context="Голосовий синтез успішно завершено",
                response_type="success",
                agent=result["agent"],
                user_action=f"синтез тексту: '{text[:30]}...'"
            )
            
            return Response(
                result["audio_data"],
                mimetype='audio/wav',
                headers={
                    'X-Agent': result["agent"],
                    'X-Voice-Params': str(result["voice_params"]),
                    'X-Success-Message': success_response["content"],
                    'Content-Disposition': f'attachment; filename="tts_{result["agent"]}.wav"'
                }
            )
        else:
            # Розумна обробка помилки синтезу
            error_response = response_generator.generate_response_sync(
                context="Помилка синтезу голосу в TTS системі",
                response_type="error",
                agent="grisha",
                user_action=f"синтез голосу для агента {agent}",
                error_details=result.get("error", "Невідома помилка")
            )
            return jsonify({
                "success": False,
                "intelligent_error": error_response["content"],
                "agent": error_response["agent"],
                "technical_details": result.get("error")
            }), 500
            
    except Exception as e:
        logger.error(f"Загальна помилка синтезу мовлення: {e}")
        
        # Розумна обробка системних помилок
        error_response = response_generator.generate_response_sync(
            context="Системна помилка у voice API під час синтезу",
            response_type="error",
            agent="atlas",
            user_action="виклик /api/voice/synthesize",
            error_details=str(e)
        )
        
        return jsonify({
            "success": False,
            "intelligent_error": error_response["content"],
            "agent": error_response["agent"],
            "system_analysis": "Потребує системної діагностики"
        }), 500

@voice_bp.route('/detect_speaker', methods=['POST'])
def detect_speaker():
    """
    Визначити спікера з тексту
    
    POST /api/voice/detect_speaker
    Body: {
        "text": "текст для аналізу"
    }
    """
    try:
        data = request.get_json()
        if not data:
            error_response = response_generator.generate_response_sync(
                context="Запит визначення спікера без даних",
                response_type="error",
                agent="grisha",
                user_action="відправка пустого запиту до detect_speaker"
            )
            return jsonify({
                "success": False,
                "intelligent_error": error_response["content"]
            }), 400
        
        text = data.get('text', '').strip()
        if not text:
            error_response = response_generator.generate_response_sync(
                context="Спроба визначення спікера з порожнього тексту",
                response_type="error",
                agent="tetyana",
                user_action="аналіз порожнього тексту"
            )
            return jsonify({
                "success": False,
                "intelligent_error": error_response["content"]
            }), 400
        
        agent, cleaned_text = voice_manager.detect_speaker_from_response(text)
        agent_info = voice_manager.get_agent_info(agent)
        
        # Розумна відповідь про успішне визначення
        success_response = response_generator.generate_response_sync(
            context=f"Успішно визначено спікера: {agent}",
            response_type="success", 
            agent=agent,
            user_action=f"аналіз тексту: '{text[:30]}...'"
        )
        
        return jsonify({
            "success": True,
            "agent": agent,
            "cleaned_text": cleaned_text,
            "signature": agent_info["signature"],
            "characteristics": agent_info["characteristics"],
            "intelligent_response": success_response["content"]
        })
        
    except Exception as e:
        logger.error(f"Помилка визначення спікера: {e}")
        
        error_response = response_generator.generate_response_sync(
            context="Помилка системи визначення спікера",
            response_type="error",
            agent="atlas",
            error_details=str(e)
        )
        
        return jsonify({
            "success": False,
            "intelligent_error": error_response["content"]
        }), 500

@voice_bp.route('/prepare_response', methods=['POST'])
def prepare_response():
    """
    Підготувати відповідь для відображення з голосовими мітками
    
    POST /api/voice/prepare_response
    Body: {
        "text": "текст відповіді",
        "agent": "atlas|tetyana|grisha" (опціонально)
    }
    """
    try:
        data = request.get_json()
        if not data:
            error_response = response_generator.generate_response_sync(
                context="Запит підготовки відповіді без даних",
                response_type="error",
                agent="grisha"
            )
            return jsonify({
                "success": False,
                "intelligent_error": error_response["content"]
            }), 400
        
        text = data.get('text', '').strip()
        if not text:
            error_response = response_generator.generate_response_sync(
                context="Підготовка відповіді з порожнім текстом",
                response_type="error",
                agent="tetyana"
            )
            return jsonify({
                "success": False,
                "intelligent_error": error_response["content"]
            }), 400
        
        agent = data.get('agent')
        
        result = voice_manager.prepare_response_for_display(text, agent)
        result["success"] = True
        
        # Додаємо розумну інформацію про підготовку
        info_response = response_generator.generate_response_sync(
            context=f"Відповідь підготовлена для агента {result['agent']}",
            response_type="info",
            agent=result['agent']
        )
        result["preparation_info"] = info_response["content"]
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Помилка підготовки відповіді: {e}")
        
        error_response = response_generator.generate_response_sync(
            context="Системна помилка підготовки відповіді",
            response_type="error",
            agent="atlas",
            error_details=str(e)
        )
        
        return jsonify({
            "success": False,
            "intelligent_error": error_response["content"]
        }), 500

@voice_bp.route('/agents', methods=['GET'])
def get_agents():
    """
    Отримати інформацію про всіх агентів
    
    GET /api/voice/agents
    """
    try:
        agents = {}
        for agent in ["atlas", "tetyana", "grisha"]:
            agents[agent] = voice_manager.get_agent_info(agent)
        
        # Розумна інформація про систему агентів
        info_response = response_generator.generate_response_sync(
            context="Надання інформації про всіх доступних агентів системи",
            response_type="info",
            agent="atlas"
        )
        
        return jsonify({
            "success": True,
            "agents": agents,
            "system_info": info_response["content"],
            "total_agents": len(agents)
        })
        
    except Exception as e:
        logger.error(f"Помилка отримання агентів: {e}")
        
        error_response = response_generator.generate_response_sync(
            context="Помилка завантаження інформації про агентів",
            response_type="error",
            agent="grisha",
            error_details=str(e)
        )
        
        return jsonify({
            "success": False,
            "intelligent_error": error_response["content"]
        }), 500

@voice_bp.route('/health', methods=['GET'])
def voice_health():
    """Перевірка здоров'я voice API з розумними відповідями"""
    try:
        # Перевіряємо доступність TTS сервера
        test_result = voice_manager.synthesize_speech("тест", "atlas")
        tts_available = test_result.get("success", False)
        
        # Створюємо розумний звіт про стан системи
        if tts_available:
            health_response = response_generator.generate_response_sync(
                context="Повна перевірка голосової системи - всі компоненти працюють",
                response_type="success",
                agent="atlas"
            )
        else:
            health_response = response_generator.generate_response_sync(
                context="Голосова система частково недоступна - TTS сервер не відповідає",
                response_type="warning",
                agent="grisha"
            )
        
        return jsonify({
            "success": True,
            "voice_manager": "operational",
            "tts_server": "available" if tts_available else "unavailable",
            "agents_count": 3,
            "supported_agents": ["atlas", "tetyana", "grisha"],
            "intelligent_status": health_response["content"],
            "status_agent": health_response["agent"]
        })
        
    except Exception as e:
        logger.error(f"Помилка перевірки здоров'я voice API: {e}")
        
        error_response = response_generator.generate_response_sync(
            context="Критична помилка перевірки стану голосової системи",
            response_type="error",
            agent="grisha",
            error_details=str(e)
        )
        
        return jsonify({
            "success": False,
            "intelligent_error": error_response["content"]
        }), 500