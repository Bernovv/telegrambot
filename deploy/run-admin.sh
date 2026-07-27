#!/bin/bash
# Запускает админ-панель (Next.js) на 127.0.0.1:3002. Наружу её отдаёт nginx на
# admin.biz-day.ru — см. ЗАПУСК_АДМИНКИ.md. Использовать через pm2.
set -e
# Проект требует Node >=24, а системный node на сервере старее (используется
# MAX-ботом) — берём Node 24 из nvm, не трогая системный node.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/admin-web"
# Переменные читает разборщик Node (--env-file), как в run-api.sh и run-bot.sh.
# Через шелл (`. .env`) нельзя: пароль Т-Банка содержит `&`, и строка рвётся.
# Порт задан флагом: в .env PORT=3001 — это порт API, и если Next его подхватит,
# Т-Банк перестанет доставлять уведомления об оплате.
exec node --env-file="$ROOT/.env" ./node_modules/next/dist/bin/next start -p 3002 -H 127.0.0.1
