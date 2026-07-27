#!/bin/bash
# Запускает фоновые задачи (доставка билета после оплаты, снятие брони). Использовать
# через pm2, см. ЗАПУСК_ПРОДАЖ.md.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/worker"
exec node --env-file="$ROOT/.env" --import tsx src/main.ts
