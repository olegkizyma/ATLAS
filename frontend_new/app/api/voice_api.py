#!/usr/bin/env python3
"""
ATLAS Voice API - Інтелектуальні голосові API для агентів
"""

import logging
from flask import Blueprint, request, jsonify, Response
from core.intelligent_voice_manager import IntelligentVoiceManager

logger = logging.getLogger(__name__)

# Створюємо Blueprint для voice API
voice_bp = Blueprint('voice', __name__, url_prefix='/api/voice')

# Ініціалізуємо глобальний менеджер голосів
voice_manager = IntelligentVoiceManager()

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
            return jsonify({"success": False, "error": "Немає даних"}), 400
        
        text = data.get('text', '').strip()
        if not text:
            return jsonify({"success": False, "error": "Пустий текст"}), 400
        
        agent = data.get('agent')
        
        # Синтезуємо мовлення
        result = voice_manager.synthesize_speech(text, agent)
        
        if result["success"]:
            # Повертаємо аудіо дані
            return Response(
                result["audio_data"],
                mimetype='audio/wav',
                headers={
                    'X-Agent': result["agent"],
                    'X-Voice-Params': str(result["voice_params"]),
                    'Content-Disposition': f'attachment; filename="tts_{result["agent"]}.wav"'
                }
            )
        else:
            return jsonify(result), 500
            
    except Exception as e:
        logger.error(f"Помилка синтезу мовлення: {e}")
        return jsonify({
            "success": False,
            "error": f"Внутрішня помилка: {str(e)}"
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
            return jsonify({"success": False, "error": "Немає даних"}), 400
        
        text = data.get('text', '').strip()
        if not text:
            return jsonify({"success": False, "error": "Пустий текст"}), 400
        
        agent, cleaned_text = voice_manager.detect_speaker_from_response(text)
        agent_info = voice_manager.get_agent_info(agent)
        
        return jsonify({
            "success": True,
            "agent": agent,
            "cleaned_text": cleaned_text,
            "signature": agent_info["signature"],
            "characteristics": agent_info["characteristics"]
        })
        
    except Exception as e:
        logger.error(f"Помилка визначення спікера: {e}")
        return jsonify({
            "success": False,
            "error": f"Внутрішня помилка: {str(e)}"
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
            return jsonify({"success": False, "error": "Немає даних"}), 400
        
        text = data.get('text', '').strip()
        if not text:
            return jsonify({"success": False, "error": "Пустий текст"}), 400
        
        agent = data.get('agent')
        
        result = voice_manager.prepare_response_for_display(text, agent)
        result["success"] = True
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Помилка підготовки відповіді: {e}")
        return jsonify({
            "success": False,
            "error": f"Внутрішня помилка: {str(e)}"
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
        
        return jsonify({
            "success": True,
            "agents": agents
        })
        
    except Exception as e:
        logger.error(f"Помилка отримання агентів: {e}")
        return jsonify({
            "success": False,
            "error": f"Внутрішня помилка: {str(e)}"
        }), 500

@voice_bp.route('/health', methods=['GET'])
def voice_health():
    """Перевірка здоров'я voice API"""
    try:
        # Перевіряємо доступність TTS сервера
        test_result = voice_manager.synthesize_speech("тест", "atlas")
        tts_available = test_result.get("success", False)
        
        return jsonify({
            "success": True,
            "voice_manager": "operational",
            "tts_server": "available" if tts_available else "unavailable",
            "agents_count": 3,
            "supported_agents": ["atlas", "tetyana", "grisha"]
        })
        
    except Exception as e:
        logger.error(f"Помилка перевірки здоров'я voice API: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500