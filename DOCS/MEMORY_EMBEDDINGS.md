# ATLAS Памʼять та Семантичні Embeddings

Оновлена підсистема памʼяті для агентів Atlas / Grisha: персистентні key/value факти в SQLite + ранжування + (опційно) семантичний пошук.

## Основні можливості
- Персистенція у `agent_facts` (better-sqlite3, WAL).
- Принцип ранжування: експоненційний спад за останнім оновленням + логарифм частоти оновлень (групування за `fact_key`).
- `summarizeForPrompt(targetTokens)` формує компактний блок памʼяті під приблизний ліміт токенів (евристика 4 chars ≈ 1 token).
- Безпечний запис `rememberSafe` (дедуп ≤60s + hash-дедуп для ідентичних значень).
- Авто-обрізання довгих значень (`ATLAS_MEMORY_VALUE_MAX`, стандарт 800 символів) з суфіксом `…`.
- Принудове `prune()` після кожного запису: capacity + TTL.
- Опційні embeddings (вмикаються флагом) + простий семантичний контекст (cosine similarity).
- Періодичне обслуговування: `PRAGMA optimize` + (опційно) `VACUUM` на інтервалі.

## Таблиці
```
agent_facts(id, agent, fact_key, fact_value, created_at, updated_at)
agent_fact_embeddings(fact_id, agent, fact_key, embedding(JSON), dim, updated_at)  # опційно
```

## Алгоритм ранжування (summarizeRanked)
1. Вибірка `limit * 4` останніх фактів.
2. Групування за ключем для підрахунку частоти (кількість оновлень).
3. Обчислення:
   - `recencyWeight = 0.5 ** (ageMs / halfLifeMs)`
   - `score = recencyWeight * (1 + log2(freq + 1))`
4. Сортування, top N, формування рядків `- key (f=...,score=..): value`.

`halfLifeMinutes` конфігурується через `ATLAS_MEMORY_HALFLIFE_MIN` (дефолт 180 хв).

## Семантичний пошук
Увімкнення: `ATLAS_MEMORY_EMBEDDINGS=1`.
- Локальний режим (default): швидкий hash-вектор (bag-of-hash) з нормалізацією (псевдо-embedding).
- Віддалений режим: `ATLAS_MEMORY_EMBED_REMOTE=1` + `ATLAS_EMBED_MODEL` → POST `/embeddings` (OpenAI-compatible). При збої fallback на hash-вектор.
- Зберігається JSON масив float у таблиці embeddings; cosine similarity при запиті.
- API (всередині коду): `semanticContext(agent, query, { topK, maxChars })`.

## Метрики (Prometheus)
```
atlas_memory_facts_written_total
atlas_memory_facts_pruned_total
atlas_memory_context_injections_total
atlas_memory_context_tokens_total
```
(інші загальні: pipeline_phase_*, probe_*, і т.д.)

## HTTP Ендпоїнти
- `GET /memory/:agent?limit=30&pattern=prefix` – останні факти (фільтр за ключем через LIKE).
- `GET /memory` – health summary: кількість, вік фактів, чи увімкнені embeddings.
- `GET /metrics/prometheus` – метрики.

## ENV Змінні
| Змінна | Опис | Дефолт |
|--------|------|--------|
| ATLAS_MEMORY_DB | Шлях до файлу БД | ./agent_memory.db |
| ATLAS_MEMORY_MAX_FACTS | Ліміт фактів на агента | 200 |
| ATLAS_MEMORY_TTL_MS | TTL фактів (мс) | 3 дні |
| ATLAS_MEMORY_VALUE_MAX | Макс. довжина значення | 800 |
| ATLAS_MEMORY_HALFLIFE_MIN | Half-life ранжування (хв) | 180 |
| ATLAS_MEMORY_TARGET_TOKENS | Ціль токенів для summarizeForPrompt | 320 |
| ATLAS_MEMORY_EMBEDDINGS | 1 = ввімкнути embeddings | 0 |
| ATLAS_MEMORY_EMBED_REMOTE | 1 = викликати зовнішню /embeddings | 0 |
| ATLAS_EMBED_MODEL | Модель embeddings | text-embedding-3-small |
| ATLAS_MEMORY_EMBED_DIM | (Інфо/override) розмір embedding | 384 |
| ATLAS_MEMORY_OPTIMIZE_INTERVAL_MS | Інтервал optimize/VACUUM | 600000 (10м) |
| ATLAS_MEMORY_AUTO_VACUUM | 1 = виконувати VACUUM | 0 |
| ATLAS_MEMORY_COUNT_UPDATES | 1 = рахувати UPDATE як запис | 0 |

## Потік вставки
```
remember/rememberSafe -> truncate -> hash dedup -> UPDATE|INSERT -> (optional embedding upsert async) -> prune(capacity) -> prune(TTL)
```

## Семантичний контекст у Prompt
У orchestrator під час створення prompt для Atlas/Grisha:
1. Виклик `summarizeForPrompt` для кожного агента (ранжовані факти).
2. Якщо embeddings увімкнені – `semanticContext(..., lastUserMessage)` додає top-K схожі факти.
3. Формується секція `[ПАМ'ЯТЬ]` з блоків.

## Обслуговування
`startMemoryMaintenance()` запускає таймер:
- `PRAGMA optimize` кожен інтервал.
- `VACUUM` (якщо `ATLAS_MEMORY_AUTO_VACUUM=1`).

## Безпека / Обмеження
- Hash-вектори не дають повної семантики – це скоріше евристика (для точності потрібен віддалений embedding сервіс).
- Синхронність: better-sqlite3 безпечний у одному процесі; multi-process потребує додаткового RPC.
- Потенційний приріст файлу — використовуйте періодичний VACUUM.

## Розширення (майбутнє)
- Замінити hash-вектор на справжні локальні embeddings (ggml / onnx) без HTTP.
- Зберігати агреговану статистику (mean recency score) для швидкого моніторингу деградації.
- Бекграундова компресія старих значень (summary rolling).

## Швидкий чек після змін
1. `ATLAS_MEMORY_EMBEDDINGS=1 npm start` orchestrator.
2. Запит до `/memory` – переконатися `embeddingsEnabled: true`.
3. Надіслати кілька повідомлень → перевірити `/metrics/prometheus` (memory_* зростають).
4. Переконатися prune працює: зменшити `ATLAS_MEMORY_MAX_FACTS=5`, накидати 8 фактів, перевірити count.

---
Актуалізуйте цей файл при зміні схеми БД або протоколу формування памʼяті.
