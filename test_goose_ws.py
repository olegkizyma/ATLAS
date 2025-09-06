import asyncio
import aiohttp
import json
import time

async def test_goose_ws():
    """Тестує WebSocket з'єднання з Goose Web"""
    ws_url = "ws://127.0.0.1:3000/ws"
    payload = {
        "type": "message", 
        "content": "Привіт! Це тест WebSocket з'єднання з ATLAS.", 
        "session_id": "test_atlas", 
        "timestamp": int(time.time()*1000)
    }
    
    print(f"🔗 Підключаюся до {ws_url}")
    print(f"📤 Повідомлення: {payload['content']}")
    
    try:
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(ws_url, heartbeat=30) as ws:
                print("✅ WebSocket з'єднання встановлено")
                
                # Відправляємо повідомлення
                await ws.send_str(json.dumps(payload))
                print("📤 Повідомлення відправлено")
                
                # Читаємо відповіді
                response_chunks = []
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        try:
                            obj = json.loads(msg.data)
                            print(f"📥 Отримано: {obj}")
                            
                            if isinstance(obj, dict):
                                msg_type = obj.get("type")
                                if msg_type == "response":
                                    content = obj.get("content")
                                    if content:
                                        response_chunks.append(str(content))
                                        print(f"💬 Контент: {content}")
                                elif msg_type in ("complete", "cancelled"):
                                    print(f"✅ Завершено: {msg_type}")
                                    break
                                elif msg_type == "error":
                                    print(f"❌ Помилка: {obj.get('message', 'websocket error')}")
                                    break
                        except Exception as e:
                            print(f"⚠️ Помилка парсингу JSON: {e}")
                            response_chunks.append(str(msg.data))
                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        print(f"🔌 WebSocket закрито: {msg.type}")
                        break
                
                full_response = "".join(response_chunks).strip()
                print(f"📝 Повна відповідь: {full_response}")
                return {"success": True, "response": full_response}
                
    except Exception as e:
        print(f"💥 Помилка WebSocket: {e}")
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    result = asyncio.run(test_goose_ws())
    print(f"\n🏁 Фінальний результат: {result}")
