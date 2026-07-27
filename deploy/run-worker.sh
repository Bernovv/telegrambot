#!/bin/bash
# Запускает фоновые задачи (доставка билета после оплаты, снятие брони). Использовать
# через pm2, см. ЗАПУСК_ПРОДАЖ.md.
set -e
cd "$(dirname "$0")/.."
set -a
source .env
set +a
exec corepack pnpm --filter worker dev
