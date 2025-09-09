#!/usr/bin/env python3
"""
ATLAS Goose Vision Client - Universal client combining GooseClient + Frontend Tools + Vision
Об'єднує автовизначення Goose, tool інтеграцію та vision функціональність
"""

import asyncio
import json
import time
import os
import requests
import aiohttp
import httpx
from typing import List, Dict, Any
from datetime import datetime

class GooseVisionClient:
    """Універсальний клієнт для Goose з vision tools та автовизначенням типу сервера"""
    
    def __init__(self, base_url: str | None = None, secret_key: str | None = None):
        # Порядок пріоритетів: аргумент -> env -> авто-вибір
        env_url = os.getenv('GOOSE_BASE_URL')
        self.base_url = base_url or env_url or self._auto_pick_goose_url()
        self.secret_key = secret_key or os.getenv('GOOSE_SECRET_KEY', 'test')
        self.session_id = "atlas-vision-session"
        
        # Vision tools configuration
        self.vision_tools = self._setup_vision_tools()
        
    def _auto_pick_goose_url(self) -> str:
        """Автоматично знаходить доступний Goose сервер"""
        # Спочатку перевіряємо goose web на стандартному порті 3000
        try:
            r = requests.get("http://127.0.0.1:3000/", timeout=2)
            if r.status_code == 200 and "Goose Chat" in r.text:
                print("🌐 Знайдено Goose Web на порті 3000")
                return "http://127.0.0.1:3000"
        except Exception:
            pass
            
        # Потім перевіряємо goosed API
        for base in ("http://127.0.0.1:3000", "http://127.0.0.1:3001"):
            for ep in ("/status", "/api/health", "/"):
                try:
                    r = requests.get(f"{base}{ep}", timeout=2)
                    if r.status_code in (200, 404):
                        print(f"🔧 Знайдено Goose API на {base}")
                        return base
                except Exception:
                    continue
        return "http://127.0.0.1:3000"

    def _is_web(self) -> bool:
        """Перевіряє чи це Goose Web версія"""
        try:
            r = requests.get(f"{self.base_url}/", timeout=3)
            return r.status_code == 200 and "Goose Chat" in r.text
        except Exception:
            return False

    def _is_api(self) -> bool:
        """Перевіряє чи це Goose API версія"""
        try:
            r = requests.get(f"{self.base_url}/status", timeout=3)
            return r.status_code == 200
        except Exception:
            return False

    def _setup_vision_tools(self) -> List[Dict[str, Any]]:
        """Налаштовує vision tools для Goose"""
        return [
            {
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
            },
            {
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
                        }
                    },
                },
            }
        ]

    async def setup_agent(self) -> bool:
        """Ініціалізує Goose агента з vision tools"""
        try:
            if self._is_api():
                async with httpx.AsyncClient() as client:
                    # Create the agent
                    response = await client.post(
                        f"{self.base_url}/agent/update_provider",
                        json={"provider": "databricks", "model": "goose"},
                        headers={"X-Secret-Key": self.secret_key},
                    )
                    response.raise_for_status()
                    print("✅ Successfully created Goose agent")

                    # Add vision frontend extension
                    frontend_config = {
                        "name": "atlas_vision",
                        "type": "frontend",
                        "tools": self.vision_tools,
                        "instructions": "ATLAS Vision tools for computer vision analysis, screenshot monitoring, and basic calculations.",
                    }
                    
                    response = await client.post(
                        f"{self.base_url}/extensions/add",
                        json=frontend_config,
                        headers={"X-Secret-Key": self.secret_key},
                    )
                    response.raise_for_status()
                    print("✅ Successfully added ATLAS vision extension")
                    return True
            else:
                print("✅ Goose Web version detected - tools will be handled via chat")
                return True
                
        except Exception as e:
            print(f"❌ Failed to setup Goose agent: {e}")
            return False

    async def execute_vision_analysis(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Виконує аналіз зображення"""
        try:
            # Імпортуємо vision_processor тут, щоб уникнути циклічних залежностей
            try:
                from vision_processor import vision_processor
                if vision_processor is None:
                    raise ImportError("vision_processor not available")
            except ImportError:
                return [{
                    "type": "text",
                    "text": "Vision processor не доступний. Встановіть opencv, mediapipe та інші залежності.",
                    "annotations": None,
                }]
            
            image_data = args["image_data"]
            analysis_type = args.get("analysis_type", "full")
            
            # Process image
            result = vision_processor.process_image_upload(image_data)
            
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
            return [{
                "type": "text",
                "text": f"Помилка аналізу: {str(e)}",
                "annotations": None,
            }]

    async def execute_screenshot_monitor(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Виконує screenshot monitoring"""
        try:
            action = args.get("action", "capture")
            
            if action == "capture":
                try:
                    import pyautogui
                    from datetime import datetime
                    import tempfile
                    from pathlib import Path
                    import base64
                    
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    temp_dir = Path(tempfile.gettempdir()) / "atlas_vision"
                    temp_dir.mkdir(exist_ok=True)
                    screenshot_path = temp_dir / f"screenshot_{timestamp}.png"
                    
                    # Take screenshot
                    screenshot = pyautogui.screenshot()
                    screenshot.save(screenshot_path)
                    
                    # Also provide base64 for potential analysis
                    import io
                    buffer = io.BytesIO()
                    screenshot.save(buffer, format='PNG')
                    img_base64 = base64.b64encode(buffer.getvalue()).decode()
                    
                    return [{
                        "type": "text",
                        "text": f"📸 Скріншот збережено: {screenshot_path}\n\nРозмір: {screenshot.size[0]}x{screenshot.size[1]} пікселів\nЧас: {datetime.now().strftime('%H:%M:%S')}\n\nМожу проаналізувати зображення, якщо потрібно!",
                        "annotations": {
                            "screenshot_path": str(screenshot_path),
                            "image_base64": f"data:image/png;base64,{img_base64}",
                            "timestamp": timestamp,
                            "dimensions": screenshot.size
                        },
                    }]
                except ImportError:
                    return [{
                        "type": "text",
                        "text": "❌ PyAutoGUI не доступний для створення скріншотів.\n\nВстановіть: pip install pyautogui\n\nТакож переконайтеся, що надали дозволи на доступ до екрану в системних налаштуваннях.",
                        "annotations": None,
                    }]
                except Exception as e:
                    return [{
                        "type": "text",
                        "text": f"❌ Помилка при створенні скріншоту: {str(e)}\n\nПереконайтеся, що:\n1. PyAutoGUI встановлено\n2. Надано дозволи на доступ до екрану\n3. Не запущено в headless режимі",
                        "annotations": None,
                    }]
            else:
                return [{
                    "type": "text",
                    "text": f"✅ Дія '{action}' виконана успішно",
                    "annotations": None,
                }]
                
        except Exception as e:
            return [{
                "type": "text",
                "text": f"❌ Помилка моніторингу: {str(e)}",
                "annotations": None,
            }]

    def submit_tool_result(self, tool_id: str, result: List[Dict[str, Any]]) -> None:
        """Відправляє результат виконання tool до Goose"""
        payload = {
            "id": tool_id,
            "result": {"Ok": result}
        }

        with httpx.Client(timeout=2.0) as client:
            response = client.post(
                f"{self.base_url}/tool_result",
                json=payload,
                headers={"X-Secret-Key": self.secret_key},
            )
            response.raise_for_status()

    def send_reply(self, session_name: str, message: str, timeout: int = 90) -> dict:
        """Backward compatibility method for GooseClient interface"""
        try:
            # For backward compatibility, we run the async method synchronously
            if asyncio.get_event_loop().is_running():
                # If we're already in an async context, create a new loop
                loop = asyncio.new_event_loop()
                try:
                    asyncio.set_event_loop(loop)
                    return loop.run_until_complete(self.send_message(message, timeout))
                finally:
                    asyncio.set_event_loop(None)
            else:
                return asyncio.run(self.send_message(message, timeout))
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def send_message(self, message: str, timeout: int = 90) -> dict:
        """Відправляє повідомлення до Goose і повертає відповідь"""
        if self._is_web():
            try:
                return await self._via_ws(message, timeout)
            except RuntimeError:
                loop = asyncio.new_event_loop()
                try:
                    asyncio.set_event_loop(loop)
                    return loop.run_until_complete(self._via_ws(message, timeout))
                finally:
                    asyncio.set_event_loop(None)
                    loop.close()
        return await self._via_sse(message, timeout)

    async def _via_ws(self, message: str, timeout: int) -> dict:
        """Чат через WebSocket для Goose Web версії"""
        ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
        payload = {
            "type": "message", 
            "content": message, 
            "session_id": self.session_id, 
            "timestamp": int(time.time()*1000)
        }
        
        chunks = []
        timeout_obj = aiohttp.ClientTimeout(total=timeout)
        
        async with aiohttp.ClientSession(timeout=timeout_obj) as session:
            async with session.ws_connect(ws_url, heartbeat=30) as ws:
                await ws.send_str(json.dumps(payload))
                
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        try:
                            obj = json.loads(msg.data)
                        except Exception:
                            obj = None
                            
                        if isinstance(obj, dict):
                            t = obj.get("type")
                            if t == "response":
                                content = obj.get("content")
                                if content:
                                    chunks.append(str(content))
                            elif t in ("complete", "cancelled"):
                                break
                            elif t == "error":
                                return {"success": False, "error": obj.get("message", "websocket error")}
                        else:
                            chunks.append(str(msg.data))
                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        break
                        
        return {"success": True, "response": "".join(chunks).strip()}

    async def _via_sse(self, message: str, timeout: int) -> dict:
        """Чат через Server-Sent Events для Goose API версії"""
        async with httpx.AsyncClient(timeout=timeout) as client:
            # Create message object
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
            
            try:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/reply",
                    json=payload,
                    headers={
                        "X-Secret-Key": self.secret_key,
                        "Accept": "text/event-stream",
                        "Content-Type": "application/json",
                    },
                ) as stream:
                    async for line in stream.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue

                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue

                        if data.get("type") == "Finish":
                            break

                        message_data = data.get("message", {})
                        
                        # Handle different message types
                        for content in message_data.get("content", []):
                            if content.get("type") == "text":
                                responses.append(content["text"])
                            elif content.get("type") == "frontendToolRequest":
                                # Execute the tool and submit results
                                tool_call = content["toolCall"]["value"]
                                tool_name = tool_call['name']
                                tool_args = tool_call["arguments"]
                                
                                print(f"🔧 Executing tool: {tool_name}")
                                
                                # Execute appropriate tool
                                if tool_name == "vision_analysis":
                                    result = self.execute_vision_analysis(tool_args)
                                elif tool_name == "screenshot_monitor":
                                    result = self.execute_screenshot_monitor(tool_args)
                                else:
                                    result = [{
                                        "type": "text",
                                        "text": f"Невідомий інструмент: {tool_name}",
                                        "annotations": None,
                                    }]
                                
                                # Submit result
                                self.submit_tool_result(content["id"], result)

                return {"success": True, "response": "\n".join(responses)}
                
            except Exception as e:
                return {"success": False, "error": str(e), "response": ""}
    
    async def analyze_current_screen(self) -> dict:
        """Швидкий аналіз поточного екрану"""
        try:
            result = await self.execute_screenshot_monitor({"action": "capture"})
            if result and len(result) > 0:
                return {
                    "success": True,
                    "analysis": result[0]["text"],
                    "timestamp": result[0].get("timestamp", ""),
                    "image_path": result[0].get("image_path", "")
                }
            else:
                return {
                    "success": False,
                    "error": "Не вдалося захопити скріншот"
                }
        except Exception as e:
            return {
                "success": False,
                "error": f"Помилка аналізу: {str(e)}"
            }

    async def chat_with_vision(self, message: str) -> str:
        """Чат з Goose з підтримкою vision tools"""
        try:
            # Check for special commands
            if message.lower() in ['screenshot', 'скріншот', 'екран']:
                # Take screenshot and describe it
                result = await self.execute_screenshot_monitor({"action": "capture"})
                if result and len(result) > 0:
                    return result[0]["text"]
                else:
                    return "❌ Не вдалося зробити скріншот"
            
            # Regular chat
            result = await self.send_message(message)
            if result["success"]:
                return result["response"]
            else:
                return f"Помилка: {result.get('error', 'Unknown error')}"
        except Exception as e:
            return f"Помилка чату: {str(e)}"

    async def chat_interactive(self):
        """Інтерактивний чат з Goose"""
        print("🚀 ATLAS Goose Vision Client")
        print("🔧 Доступні команди: vision_analysis, screenshot_monitor")
        print("💬 Введіть 'exit' для виходу\n")
        
        # Setup agent
        await self.setup_agent()
        
        while True:
            try:
                user_input = input("You: ").strip()
                if user_input.lower() in ['exit', 'quit']:
                    print("👋 До побачення!")
                    break
                
                if not user_input:
                    continue
                
                print("🤔 Thinking...")
                result = await self.send_message(user_input)
                
                if result["success"]:
                    print(f"🤖 Goose: {result['response']}")
                else:
                    print(f"❌ Error: {result.get('error', 'Unknown error')}")
                    
            except KeyboardInterrupt:
                print("\n👋 До побачення!")
                break
            except Exception as e:
                print(f"❌ Chat error: {e}")


# Глобальний екземпляр для використання
goose_vision_client = GooseVisionClient()


# Helper functions for compatibility
async def setup_vision_with_goose() -> bool:
    """Wrapper для сумісності"""
    return await goose_vision_client.setup_agent()


async def analyze_image_with_goose(image_data: str, prompt: str = "Проаналізуй це зображення") -> str:
    """Аналіз зображення через Goose"""
    message = f"{prompt}. Використай vision_analysis tool з даними: {image_data[:100]}..."
    result = await goose_vision_client.send_message(message)
    return result.get("response", "")


def get_vision_tools_status() -> Dict[str, Any]:
    """Статус vision tools"""
    return {
        "goose_client": goose_vision_client is not None,
        "goose_url": goose_vision_client.base_url,
        "is_web": goose_vision_client._is_web(),
        "is_api": goose_vision_client._is_api(),
        "tools_count": len(goose_vision_client.vision_tools),
        "available_tools": [tool["name"] for tool in goose_vision_client.vision_tools]
    }


async def main():
    """Демонстрація використання"""
    client = GooseVisionClient()
    await client.chat_interactive()


if __name__ == "__main__":
    asyncio.run(main())
