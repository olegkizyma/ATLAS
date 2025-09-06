# ATLAS Architecture Visualization

Сучасні візуалізації логіки та структури системи.

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
