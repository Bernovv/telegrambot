#!/bin/bash
# Аккаунт компании в Telegram: приём входящих в переписку. Использовать через pm2,
# см. docs/runbooks/telegram-account.md.
#
# Экземпляр должен быть ровно один. Вторая копия на той же сессии для Telegram — это второе
# устройство, и соединение начинает рваться по кругу; снаружи это выглядит как «канал
# моргает», а причина в том, что кто-то оставил запущенным второй процесс.
set -e
# Проект требует Node >=24, а системный node на сервере старее (используется
# MAX-ботом) — берём Node 24 из nvm, не трогая системный node.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/telegram-account"
exec node --env-file="$ROOT/.env" --import tsx src/main.ts
