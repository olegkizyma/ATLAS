Приму запит: зіб’ю короткий інструктаж по OpenAI‑сумісному API, списку моделей і інтеграції.

## Чекліст
- База й ендпоінти API
- Повний список моделей
- Приклади інтеграції (curl, JS, Python)
- Важливі нюанси (стрімінг, ліміти, ключ)

## База та ендпоінти
- Base URL: http://localhost:3010/v1
- Ендпоінти:
  - GET /v1/models — список моделей
  - POST /v1/chat/completions — чат (OpenAI‑сумісний)
- Авторизація: проксі не перевіряє ключ, але SDK вимагають рядок — використовуйте будь‑який, напр. dummy-key.
- Стрімінг: не підтримується (stream=true → 400).
- Ліміт вхідних токенів: ~8000 (платформний CAP GitHub Models).

## Список моделей (вставляйте як один рядок з комами)
openai/gpt-4o-mini, openai/gpt-4o, gpt-4o-mini, gpt-4o, microsoft/Phi-3.5-mini-instruct, microsoft/Phi-3-mini-4k-instruct, microsoft/Phi-3.5-MoE-instruct, microsoft/Phi-3.5-vision-instruct, microsoft/Phi-3-small-8k-instruct, microsoft/Phi-3-small-128k-instruct, microsoft/Phi-3-medium-4k-instruct, Phi-3.5-mini-instruct, Phi-3-mini-4k-instruct, Phi-3-medium-4k-instruct, Phi-3-small-8k-instruct, Phi-3-small-128k-instruct, AI21-Jamba-1.5-Large, AI21-Jamba-1.5-Mini, Cohere-command-r-08-2024, Cohere-command-r-plus-08-2024, Meta-Llama-3.1-8B-Instruct, Meta-Llama-3.1-405B-Instruct, Mistral-Nemo

Рекомендований старт: gpt-4o-mini або microsoft/Phi-3.5-mini-instruct.

## Швидкі приклади

- curl
```bash
curl -sS -X POST http://localhost:3010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Привіт!"}],
    "max_tokens": 50,
    "temperature": 0.7
  }'
```

- JavaScript (openai)
```js
import OpenAI from "openai";
const client = new OpenAI({ apiKey: "dummy-key", baseURL: "http://localhost:3010/v1" });

const resp = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Привіт!" }],
});
console.log(resp.choices[0].message.content);
```

- Python (openai)
```python
from openai import OpenAI
client = OpenAI(api_key="dummy-key", base_url="http://localhost:3010/v1")
resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Привіт!"}],
)
print(resp.choices[0].message.content)
```

## Нюанси інтеграції з майстрами/клієнтами
- Якщо просять HOST/Base Path:
  - HOST: http://localhost:3010
  - BASE PATH: v1/chat/completions
  - Або просто Base URL: http://localhost:3010/v1 (і порожній Base Path)
- Вимикайте streaming.
- Якщо отримуєте 413 tokens_limit_reached — скорочуйте вхід (історію, системні інструкції, великі вставки).

Хочете, додам авто‑перевірку/обрізання запиту >8000 токенів прямо в проксі?