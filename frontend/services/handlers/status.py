from datetime import datetime
from pathlib import Path
import json
import logging

logger = logging.getLogger(__name__)

def send_json(h, obj: dict, status_code=200):
    payload = json.dumps(obj, ensure_ascii=False, indent=2).encode('utf-8')
    h.send_response(status_code)
    h.send_header('Content-type', 'application/json; charset=utf-8')
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Content-Length', str(len(payload)))
    h.end_headers()
    h.wfile.write(payload)

def serve_system_status(h):
    status = {
        "services": {
            "atlas_frontend": "running",
            "atlas_core_available": getattr(h, 'ATLAS_CORE_AVAILABLE', False) or False,
            "timestamp": datetime.now().isoformat(),
        },
        "processes": {"atlas": {"count": 1, "status": "active"}},
    }
    send_json(h, status)

def serve_atlas_core_status(h):
    try:
        ATLAS_CORE_AVAILABLE = h.__class__.__dict__.get('ATLAS_CORE_AVAILABLE', False) or globals().get('ATLAS_CORE_AVAILABLE', False)
    except Exception:
        ATLAS_CORE_AVAILABLE = False
    try:
        if ATLAS_CORE_AVAILABLE:
            from atlas_core import get_atlas_core
            core = get_atlas_core(str((Path(__file__).resolve().parents[3] / "goose")))
            status = core.get_system_status()
            health = core.health_check()
            response_data = {
                "atlas_core": {"available": True, "status": status, "health": health},
                "timestamp": datetime.now().isoformat(),
            }
        else:
            response_data = {
                "atlas_core": {"available": False, "error": "Atlas Core недоступний", "legacy_mode": True},
                "timestamp": datetime.now().isoformat(),
            }
        send_json(h, response_data)
    except Exception as e:
        logger.error(f"Atlas Core status error: {e}")
        send_json(h, {"atlas_core": {"available": False, "error": str(e)}, "timestamp": datetime.now().isoformat()}, 500)

def serve_atlas_sessions(h):
    try:
        from atlas_core import get_atlas_core
        core = get_atlas_core(str((Path(__file__).resolve().parents[3] / "goose")))
        sessions = core.get_available_sessions()
        response_data = {
            "sessions": sessions,
            "count": len(sessions),
            "atlas_core": True,
            "timestamp": datetime.now().isoformat(),
        }
        send_json(h, response_data)
    except Exception as e:
        logger.error(f"Atlas sessions error: {e}")
        send_json(h, {"sessions": [], "error": str(e), "atlas_core": False, "timestamp": datetime.now().isoformat()}, 500)

def serve_goose_sessions(h):
    try:
        sessions_dir = Path.home() / ".local/share/goose/sessions"
        sessions = []
        if sessions_dir.exists():
            jsonl_files = list(sessions_dir.glob("*.jsonl"))
            for session_file in sorted(jsonl_files, key=lambda f: f.stat().st_mtime, reverse=True)[:10]:
                stat = session_file.stat()
                size_kb = round(stat.st_size / 1024, 1)
                description = "Unknown task"
                try:
                    with open(session_file, 'r', encoding='utf-8') as f:
                        first_line = f.readline().strip()
                        if first_line:
                            data = json.loads(first_line)
                            description = data.get("description", "Unknown task")
                except Exception:
                    pass
                sessions.append({
                    "name": session_file.name,
                    "description": description,
                    "size_kb": size_kb,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "path": str(session_file),
                })
        response_data = {"sessions": sessions, "count": len(sessions), "sessions_dir": str(sessions_dir), "timestamp": datetime.now().isoformat()}
        send_json(h, response_data)
    except Exception as e:
        logger.error(f"Goose sessions error: {e}")
        send_json(h, {"sessions": [], "error": str(e), "timestamp": datetime.now().isoformat()}, 500)

def serve_correction_statistics(h):
    if hasattr(h.server, 'session_manager'):
        stats = h.server.session_manager.get_all_correction_statistics()
        send_json(h, {"correction_statistics": stats, "feature_description": "Atlas automatically creates detailed correction tasks when Grisha identifies incomplete work", "timestamp": datetime.now().isoformat()})
    else:
        send_json(h, {"error": "Session manager not available", "timestamp": datetime.now().isoformat()}, 503)

def serve_session_corrections(h, session_name: str):
    if hasattr(h.server, 'session_manager'):
        history = h.server.session_manager.get_session_correction_history(session_name)
        send_json(h, {"correction_history": history, "feature_description": f"Detailed correction history for session '{session_name}'", "timestamp": datetime.now().isoformat()})
    else:
        send_json(h, {"error": "Session manager not available", "session_name": session_name, "timestamp": datetime.now().isoformat()}, 503)

def serve_api_diagnostics(h):
    if not hasattr(h.server, 'session_manager'):
        send_json(h, {"error": "Session manager not available"}, 503)
        return
    sm = h.server.session_manager
    diagnostics = {
        "api_configuration": {"api_url": sm.api_url, "use_http_api": sm.use_http_api, "secret_key_configured": bool(sm.secret_key)},
        "api_status": {
            "failure_count": getattr(sm, 'api_failure_count', 0),
            "fallback_active": getattr(sm, 'fallback_active', False),
            "last_api_check": getattr(sm, 'last_api_check', None),
            "recovery_interval": getattr(sm, 'api_recovery_interval', 30),
        },
        "status_history": getattr(sm, 'api_status_history', [])[-10:],
        "live_validation": None,
    }
    try:
        if hasattr(sm, '_validate_api_availability'):
            diagnostics["live_validation"] = sm._validate_api_availability()
    except Exception as val_error:
        diagnostics["live_validation"] = {"error": str(val_error)}
    response_data = {"diagnostics": diagnostics, "recommendations": _generate_api_recommendations(diagnostics), "timestamp": datetime.now().isoformat()}
    send_json(h, response_data)

def _generate_api_recommendations(diagnostics: dict) -> list:
    recommendations = []
    api_status = diagnostics.get("api_status", {})
    config = diagnostics.get("api_configuration", {})
    if api_status.get("fallback_active"):
        recommendations.append({"priority": "high", "issue": "HTTP API fallback активний", "solution": "Перевірте чи працює Goose web сервер на порту 3000", "command": "ps aux | grep 'goose web'"})
    if api_status.get("failure_count", 0) > 5:
        recommendations.append({"priority": "medium", "issue": f"Багато помилок API ({api_status.get('failure_count')})", "solution": "Перезапустіть Goose сервер або перевірте мережеве з'єднання"})
    if not config.get("secret_key_configured"):
        recommendations.append({"priority": "low", "issue": "Secret key не налаштований", "solution": "Встановіть GOOSE_SECRET_KEY в змінних середовища"})
    live_validation = diagnostics.get("live_validation", {})
    if not live_validation.get("available"):
        reason = live_validation.get("reason", "unknown")
        if reason == "network_unreachable":
            recommendations.append({"priority": "critical", "issue": "Мережевий порт недоступний", "solution": "Запустіть Goose web сервер: './target/release/goose web --port 3000'"})
        elif reason == "http_timeout":
            recommendations.append({"priority": "high", "issue": "HTTP таймаути", "solution": "Goose сервер може бути перевантажений - перезапустіть його"})
    return recommendations

def serve_health_check(h):
    try:
        health_status = {"status": "healthy", "timestamp": datetime.now().isoformat(), "components": {}}
        if hasattr(h.server, 'session_manager'):
            sm = h.server.session_manager
            fallback_active = getattr(sm, 'fallback_active', False)
            health_status["components"]["session_manager"] = {"status": "degraded" if fallback_active else "healthy", "fallback_active": fallback_active, "mode": "CLI" if fallback_active else "HTTP_API"}
            if fallback_active:
                health_status["status"] = "degraded"
        else:
            health_status["components"]["session_manager"] = {"status": "unavailable", "error": "Session manager not initialized"}
            health_status["status"] = "unhealthy"
        try:
            import subprocess
            result = subprocess.run(['pgrep', '-f', 'goose web'], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                health_status["components"]["goose_web"] = {"status": "healthy", "processes": len(result.stdout.strip().split('\n')) if result.stdout.strip() else 0}
            else:
                health_status["components"]["goose_web"] = {"status": "unavailable", "error": "No goose web processes found"}
                if health_status["status"] == "healthy":
                    health_status["status"] = "degraded"
        except Exception as e:
            health_status["components"]["goose_web"] = {"status": "unknown", "error": str(e)}
        status_code = 200 if health_status["status"] == "healthy" else (503 if health_status["status"] == "unhealthy" else 200)
        send_json(h, health_status, status_code)
    except Exception as e:
        send_json(h, {"error": str(e)}, 500)

def serve_test_mode_analysis(h):
    if not hasattr(h.server, 'session_manager'):
        send_json(h, {"error": "Session manager not available"}, 503)
        return
    sm = h.server.session_manager
    test_results = sm.test_intelligent_mode_analysis()
    response_data = {
        "test_results": test_results,
        "summary": {
            "total_tests": test_results["total_tests"],
            "http_api_percentage": round((test_results["http_api_recommended"] / test_results["total_tests"]) * 100, 1),
            "cli_percentage": round((test_results["cli_recommended"] / test_results["total_tests"]) * 100, 1),
        },
        "system_status": {
            "intelligent_analysis": "active",
            "mode_detection": "enabled",
            "current_default": "http_api" if sm.use_http_api else "cli",
        },
        "timestamp": datetime.now().isoformat(),
    }
    send_json(h, response_data)
