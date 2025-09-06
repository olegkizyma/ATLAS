# ATLAS Architecture Visualization

Сучасні візуалізації логіки та структури системи з метриками таймінгу, режимом ACK та обробкою дублікатів.

## Вміст
- `system_overview.mmd` – високорівнева діаграма multi-agent pipeline (Mermaid)
- `runtime_flow.mmd` – деталізований послідовний процес запиту (Mermaid Sequence)
- `components.graphviz` – Graphviz (DOT) для більш гнучкого рендеру
- `layers.mmd` – шарова архітектура
- `memory_flow.mmd` – обробка та ранжування памʼяті
- `README.md` – цей файл

## Рендеринг
Mermaid: можна переглянути у VSCode (Mermaid plugin) або в GitHub.
Graphviz: `dot -Tpng components.graphviz -o components.png`.

## Коротко
Пайплайн: Atlas (plan) → Grisha (precheck) → Tetyana (execution) → Grisha (verdict/followup) + Probe підцикл (Tetiana probe → Grisha probe review → Atlas feasibility). Памʼять (SQLite) для Atlas/Grisha з ранжуванням (exponential decay + frequency) інʼєктується в prompt із токеновою метрикою.

### Нові можливості (Phase 3)

#### Детальні таймінги та метрики
- Пер-агентні таймінги: `[TIMING] agent=atlas route=openai_compat model=... ms=... success=true`
- Загальний час циклу: `Cycle finished intent=actionable durationMs=1234`
- Метрики Prometheus: `atlas_agent_timing_ms`, `atlas_request_duration_ms`
- Логування часових зон: UTC + local offset (`[2025-09-07T02:30:45.123Z+03:00]`)

#### ACK режим (Асинхронна обробка)
- Клієнт може надіслати `ackMode: true` або заголовок `X-Atlas-Ack: immediate`
- Фронтенд негайно повертає `accepted: true` + `clientMessageId`
- Користувач може відстежувати прогрес через `/api/chat/status/:sessionId`
- Зменшує ризик таймаутів для тривалих запитів

#### Подавлення дублікатів
- `clientMessageId` автоматично генерується Python фронтендом
- LRU кеш з TTL (5 хвилин) запобігає повторній обробці
- Метрика: `atlas_duplicates_suppressed_total`
- Логування: `Duplicate clientMessageId suppressed key=...`

#### Уніфіковане логування
- Всі логи мають формат UTC + local offset
- Orchestrator (Node.js): `[2025-09-07T02:30:45.123Z+03:00] [INFO] message`
- Frontend (Python): `2025-09-07 02:30:45,123+03:00 [INFO] atlas.frontend: message`

### Памʼять та очищення
Кожен `remember/rememberSafe` виклик після запису запускає `prune()`:
- Capacity pruning: видаляє найстаріші факти понад `ATLAS_MEMORY_MAX_FACTS` (за замовчуванням 200).
- TTL pruning: видаляє факти старші за `ATLAS_MEMORY_TTL_MS` (за замовчуванням 3 дні).

### Метрики (Prometheus)
**Основні:**
- `atlas_memory_facts_written_total`
- `atlas_memory_facts_pruned_total`
- `atlas_memory_context_injections_total`
- `atlas_memory_context_tokens_total`

**Нові (Phase 3):**
- `atlas_duplicates_suppressed_total` – кількість подавлених дублікатів
- `atlas_agent_timing_ms` – час обробки по агентах
- `atlas_request_duration_ms` – загальний час запиту

`rememberSafe` зараз реалізовано інлайном у orchestrator (`server.js`) з простим кешем для уникнення дублікатів ≤60s; можна винести в модуль надалі.

### Конфігурація таймаутів
```bash
# Python Frontend
ORCH_POST_BASE_TIMEOUT=15     # базовий таймаут (збільшено)
ORCH_POST_MAX_TIMEOUT=60      # максимальний таймаут
ORCH_POST_RETRIES=2           # кількість спроб

# Node.js Orchestrator
LLM_BASE_TIMEOUT_MS=8000      # базовий таймаут для LLM
LLM_MAX_TIMEOUT_MS=60000      # максимальний таймаут для LLM
```
