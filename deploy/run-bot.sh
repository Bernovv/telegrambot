#!/bin/bash
# Запускает Telegram-бота (long-polling). Использовать через pm2, см. ЗАПУСК_ПРОДАЖ.md.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/telegram-bot"
exec node --env-file="$ROOT/.env" --import tsx src/main.ts
