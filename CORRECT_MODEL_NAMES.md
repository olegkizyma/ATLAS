# Правильні назви моделей для ATLAS SDK

Цей файл містить повний список правильних назв моделей, що мають використовуватися в ATLAS системі.

## Повний список правильних назв (58 моделей)

### AI21 Labs
1. `ai21-labs/ai21-jamba-1.5-large`
2. `ai21-labs/ai21-jamba-1.5-mini`

### Cohere
3. `cohere/cohere-command-a`
4. `cohere/cohere-command-r-08-2024`
5. `cohere/cohere-command-r-plus-08-2024`
6. `cohere/cohere-embed-v3-english`
7. `cohere/cohere-embed-v3-multilingual`

### Core42
8. `core42/jais-30b-chat`

### DeepSeek
9. `deepseek/deepseek-r1`
10. `deepseek/deepseek-r1-0528`
11. `deepseek/deepseek-v3-0324`

### Meta
12. `meta/llama-3.2-11b-vision-instruct`
13. `meta/llama-3.2-90b-vision-instruct`
14. `meta/llama-3.3-70b-instruct`
15. `meta/llama-4-maverick-17b-128e-instruct-fp8`
16. `meta/llama-4-scout-17b-16e-instruct`
17. `meta/meta-llama-3.1-405b-instruct`
18. `meta/meta-llama-3.1-8b-instruct`

### Microsoft
19. `microsoft/mai-ds-r1`
20. `microsoft/phi-3-medium-128k-instruct`
21. `microsoft/phi-3-medium-4k-instruct`
22. `microsoft/phi-3-mini-128k-instruct`
23. `microsoft/phi-3-mini-4k-instruct`
24. `microsoft/phi-3-small-128k-instruct`
25. `microsoft/phi-3-small-8k-instruct`
26. `microsoft/phi-3.5-mini-instruct`
27. `microsoft/phi-3.5-moe-instruct`
28. `microsoft/phi-3.5-vision-instruct`
29. `microsoft/phi-4`
30. `microsoft/phi-4-mini-instruct`
31. `microsoft/phi-4-mini-reasoning`
32. `microsoft/phi-4-multimodal-instruct`
33. `microsoft/phi-4-reasoning`

### Mistral AI
34. `mistral-ai/codestral-2501`
35. `mistral-ai/ministral-3b`
36. `mistral-ai/mistral-large-2411`
37. `mistral-ai/mistral-medium-2505`
38. `mistral-ai/mistral-nemo`
39. `mistral-ai/mistral-small-2503`

### OpenAI
40. `openai/gpt-4.1`
41. `openai/gpt-4.1-mini`
42. `openai/gpt-4.1-nano`
43. `openai/gpt-4o`
44. `openai/gpt-4o-mini`
45. `openai/gpt-5`
46. `openai/gpt-5-chat`
47. `openai/gpt-5-mini`
48. `openai/gpt-5-nano`
49. `openai/o1`
50. `openai/o1-mini`
51. `openai/o1-preview`
52. `openai/o3`
53. `openai/o3-mini`
54. `openai/o4-mini`
55. `openai/text-embedding-3-large`
56. `openai/text-embedding-3-small`

### xAI
57. `xai/grok-3`
58. `xai/grok-3-mini`

## Типові помилки в назвах, які потрібно виправити:

### Неправильне (було) → Правильне (має бути)
- `microsoft/Phi-3.5-mini-instruct` → `microsoft/phi-3.5-mini-instruct`
- `microsoft/Phi-3-mini-4k-instruct` → `microsoft/phi-3-mini-4k-instruct`
- `Meta-Llama-3.1-8B-Instruct` → `meta/meta-llama-3.1-8b-instruct`
- `Mistral-Nemo` → `mistral-ai/mistral-nemo`
- `AI21-Jamba-1.5-Large` → `ai21-labs/ai21-jamba-1.5-large`

## Ключові правила:
1. **Завжди використовувати `провайдер/модель` формат**
2. **Всі літери в нижньому регістрі**
3. **Дефіси замість підкреслень або пробілів**
4. **Точні назви провайдерів:** `openai`, `microsoft`, `meta`, `mistral-ai`, `ai21-labs`, `cohere`, `deepseek`, `xai`

## Файли, що оновлені:
- `/frontend_new/orchestrator/model_registry.js` - основний реєстр моделей
- `/fallback_llm/server.js` - fallback сервер
- `/fallback_llm/server_sdk.js` - SDK fallback сервер
