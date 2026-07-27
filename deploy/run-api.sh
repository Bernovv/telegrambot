#!/bin/bash
# Запускает API (принимает подтверждения оплаты от Т-Банка). Использовать через
# pm2, см. ЗАПУСК_ПРОДАЖ.md.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/api"
exec node --env-file="$ROOT/.env" --import tsx src/main.ts
