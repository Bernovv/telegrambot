#!/bin/bash
# Запускает Telegram-бота (long-polling). Использовать через pm2, см. ЗАПУСК_ПРОДАЖ.md.
set -e
cd "$(dirname "$0")/.."
set -a
source .env
set +a
exec corepack pnpm --filter telegram-bot dev
