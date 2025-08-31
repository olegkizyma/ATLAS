from pathlib import Path
import json
import logging

logger = logging.getLogger(__name__)

def serve_frontend(h):
    try:
        html_path = Path(__file__).resolve().parents[2] / "frontend" / "index.html"
        with open(html_path, 'r', encoding='utf-8') as f:
            content = f.read()
        h.send_response(200)
        h.send_header('Content-type', 'text/html; charset=utf-8')
        h.send_header('Content-Length', str(len(content.encode('utf-8'))))
        h.end_headers()
        h.wfile.write(content.encode('utf-8'))
    except Exception as e:
        logger.error(f"Error serving frontend: {e}")
        try:
            h.send_error(500, str(e))
        except Exception:
            pass

def serve_3d_model(h):
    try:
        model_path = Path(__file__).resolve().parents[2] / "frontend" / "DamagedHelmet.glb"
        if not model_path.exists():
            h.send_error(404, "3D model not found")
            return
        file_size = model_path.stat().st_size
        h.send_response(200)
        h.send_header('Content-type', 'application/octet-stream')
        h.send_header('Content-Length', str(file_size))
        h.send_header('Accept-Ranges', 'bytes')
        h.end_headers()
        with open(model_path, 'rb') as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                try:
                    h.wfile.write(chunk)
                    h.wfile.flush()
                except Exception:
                    break
    except Exception as e:
        logger.error(f"Error serving 3D model: {e}")
        try:
            h.send_error(500, str(e))
        except Exception:
            pass

def serve_favicon(h):
    try:
        favicon_path = Path(__file__).resolve().parents[2] / "frontend" / "favicon.ico"
        if not favicon_path.exists():
            h.send_response(200)
            h.send_header('Content-type', 'image/x-icon')
            h.send_header('Content-Length', '0')
            h.end_headers()
            return
        file_size = favicon_path.stat().st_size
        h.send_response(200)
        h.send_header('Content-type', 'image/x-icon')
        h.send_header('Content-Length', str(file_size))
        h.end_headers()
        with open(favicon_path, 'rb') as f:
            while True:
                chunk = f.read(1024)
                if not chunk:
                    break
                try:
                    h.wfile.write(chunk)
                    h.wfile.flush()
                except Exception:
                    break
    except Exception as e:
        logger.error(f"Error serving favicon: {e}")
        try:
            h.send_error(500, str(e))
        except Exception:
            pass
