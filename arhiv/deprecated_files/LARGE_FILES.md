# Large Files Information

## ⚠️ Великі файли виключені з репозиторію

Наступні файли були виключені з git репозиторію через їх розмір:

### 🤖 TTS Model Files (mcp_tts_ukrainian/)
- `model.pth` (425MB) - Основна модель TTS
- `feats_stats.npz` (1.4KB) - Статистика ознак
- `spk_xvector.ark` (3.9KB) - Дані спікера

### 🎨 3D Models (frontend/)
- `DamagedHelmet.glb` (3.6MB) - 3D модель для демонстрації

## 📥 Як отримати ці файли

### Варіант 1: Завантажити вручну
Ці файли зберігаються локально та можуть бути отримані від розробника.

### Варіант 2: Git LFS (рекомендовано)
Для майбутніх великих файлів використовуйте Git LFS:

```bash
# Встановлення Git LFS
git lfs install

# Додавання типів файлів до LFS
git lfs track "*.pth"
git lfs track "*.npz" 
git lfs track "*.glb"
git lfs track "*.ark"

# Додавання .gitattributes
git add .gitattributes
git commit -m "Add Git LFS tracking"
```

### Варіант 3: Альтернативні моделі
Для TTS можна використовувати:
- Google TTS (вбудований fallback)
- Інші менші open-source моделі
- Хмарні API для TTS

## 🔧 Налаштування без великих файлів

Система ATLAS буде працювати без цих файлів:
- Frontend працює з будь-якими 3D моделями або без них
- TTS автоматично перемикається на Google TTS fallback
- Всі основні функції доступні

## 📁 Структура файлів

```
mcp_tts_ukrainian/
├── model.pth              # ❌ Виключено (425MB)
├── feats_stats.npz        # ❌ Виключено
├── spk_xvector.ark        # ❌ Виключено
└── [інші файли]          # ✅ Включені

frontend/
├── DamagedHelmet.glb     # ❌ Виключено (3.6MB)
└── [інші файли]          # ✅ Включені
```
