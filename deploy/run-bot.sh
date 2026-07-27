#!/bin/bash
# Запускает Telegram-бота (long-polling). Использовать через pm2, см. ЗАПУСК_ПРОДАЖ.md.
set -e
# Проект требует Node >=24, а системный node на сервере старее (используется
# MAX-ботом) — берём Node 24 из nvm, не трогая системный node.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/telegram-bot"
exec node --env-file="$ROOT/.env" --import tsx src/main.ts
