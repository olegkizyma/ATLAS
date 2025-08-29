#!/bin/bash

# ATLAS System Build Script
# Скрипт компіляції системи ATLAS
# Включає: Goose AI Agent сборка

echo "🔨 Компіляція системи ATLAS..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Переход в директорию goose
cd /Users/dev/Documents/GitHub/ATLAS/goose

# Активация среды Hermit
echo "⚙️  Активація середовища розробки Hermit..."
source bin/activate-hermit

if [ $? -ne 0 ]; then
    echo "❌ Не вдалося активувати Hermit середовище"
    exit 1
fi

echo "✅ Hermit середовище активовано"

## ---------------- AI Agent (goosed) build ----------------
# Режим сборки (можно переопределить: export GOOSE_BUILD_MODE=debug)
BUILD_MODE=${GOOSE_BUILD_MODE:-release}
[ "$BUILD_MODE" = "debug" ] && BUILD_FLAG="" || BUILD_FLAG="--release"
GOOSED_PATH="target/${BUILD_MODE}/goosed"

echo "🔍 Обрано build mode: ${BUILD_MODE} (бінарний файл: ${GOOSED_PATH})"

# Очистка предыдущей сборки (опционально)
if [ "$1" = "--clean" ]; then
    echo "🧹 Очищення попередньої збірки..."
    cargo clean
    echo "✅ Очищення завершено"
fi

# Компиляция AI Agent сервера
echo "🔨 Компіляція AI Agent сервера (cargo build ${BUILD_FLAG} -p goose-server)..."
echo "   Це може зайняти кілька хвилин..."

# Показываем время начала сборки
START_TIME=$(date)
echo "   ⏰ Початок: $START_TIME"

cargo build ${BUILD_FLAG} -p goose-server

BUILD_EXIT_CODE=$?

# Показываем время окончания сборки
END_TIME=$(date)
echo "   ⏰ Завершено: $END_TIME"

if [ $BUILD_EXIT_CODE -ne 0 ]; then
    echo "❌ Помилка компіляції AI Agent сервера"
    echo "💡 Спробуйте:"
    echo "   1. Перевірити наявність необхідних залежностей"
    echo "   2. Запустити з очищенням: ./build_atlas.sh --clean"
    echo "   3. Перевірити логи вище для деталей помилки"
    exit 1
fi

# Проверка наличия скомпилированного бинарного файла
if [ ! -f "${GOOSED_PATH}" ]; then
    echo "❌ Бінарний файл не знайдено після збірки: ${GOOSED_PATH}"
    echo "📁 Вміст директорії target/${BUILD_MODE}:"
    ls -al target/${BUILD_MODE} 2>/dev/null || echo "   Директорія не існує"
    exit 1
fi

# Делаем файл исполняемым
chmod +x "${GOOSED_PATH}" 2>/dev/null || true

# Получаем размер файла
FILE_SIZE=$(ls -lh "${GOOSED_PATH}" | awk '{print $5}')

echo "✅ AI Agent сервер успішно скомпільовано!"
echo "   📁 Розташування: ${GOOSED_PATH}"
echo "   📊 Розмір файлу: ${FILE_SIZE}"

# Проверка версии скомпилированного goose
echo "🔍 Перевірка версії скомпільованого Goose..."
if "./${GOOSED_PATH}" --version > /dev/null 2>&1; then
    VERSION_INFO=$("./${GOOSED_PATH}" --version 2>/dev/null || echo "версія недоступна")
    echo "   📋 Версія: ${VERSION_INFO}"
else
    echo "   ⚠️ Не вдалося отримати версію (це нормально для деяких збірок)"
fi

# Также компилируем goose CLI если нужно
if [ "$2" = "--with-cli" ] || [ "$1" = "--with-cli" ]; then
    echo ""
    echo "🔨 Компіляція Goose CLI..."
    cargo build ${BUILD_FLAG} -p goose
    
    if [ $? -eq 0 ]; then
        CLI_PATH="target/${BUILD_MODE}/goose"
        chmod +x "${CLI_PATH}" 2>/dev/null || true
        CLI_SIZE=$(ls -lh "${CLI_PATH}" | awk '{print $5}')
        echo "✅ Goose CLI успішно скомпільовано!"
        echo "   📁 Розташування: ${CLI_PATH}"
        echo "   📊 Розмір файлу: ${CLI_SIZE}"
    else
        echo "⚠️ Помилка компіляції Goose CLI (не критично для роботи системи)"
    fi
fi

echo ""
echo "🎉 КОМПІЛЯЦІЯ ATLAS ЗАВЕРШЕНА!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ AI Agent Server готовий до запуску"
echo "💡 Для запуску системи виконайте: ./start_atlas.sh"
echo ""
echo "📋 КОРИСНІ КОМАНДИ:"
echo "   🔨 Перекомпіляція:        ./build_atlas.sh"
echo "   🧹 Очищення + компіляція: ./build_atlas.sh --clean"
echo "   🛠️ З CLI інструментами:   ./build_atlas.sh --with-cli"
echo "   🚀 Запуск системи:       ./start_atlas.sh"
echo ""
