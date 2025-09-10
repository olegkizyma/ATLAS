# Top CPU Process Analysis

**Дата аналізу:** 2025-09-09 04:41:25

## Процес з найбільшим %CPU

**Назва процеса:** WindowServer  
**PID:** 427  
**%CPU:** 32.1%  
**Команда:** `/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer -daemon`  
**Користувач:** _windowserver  

## Топ 5 процесів по CPU:

1. **WindowServer** (PID: 427) - 32.1% CPU
2. **Code Helper (Renderer)** (PID: 97676) - 30.5% CPU  
3. **Code Helper (GPU)** (PID: 97673) - 9.6% CPU
4. **CursorUIViewService** (PID: 804) - 9.1% CPU
5. **Electron (VS Code)** (PID: 97670) - 8.5% CPU

## Зауваження:
- WindowServer - системний процес відповідальний за графічний інтерфейс macOS
- Visual Studio Code займає значну частину CPU ресурсів (3 процеси в топ-5)
- Загальне навантаження CPU: 6.84% user, 12.3% sys, 81.12% idle
