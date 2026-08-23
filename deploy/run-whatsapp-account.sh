#!/bin/bash
# Аккаунт компании в WhatsApp: приём входящих в переписку и отправка ответов менеджера.
# Использовать через pm2, см. docs/runbooks/whatsapp-account.md.
#
# Экземпляр должен быть ровно один. Вторая копия на том же каталоге сессии — это две
# программы, пишущие одни и те же сигнальные ключи; кончается это испорченной сессией и
# новой привязкой с телефоном в руках.
set -e
# Проект требует Node >=24, а системный node на сервере старее (используется
# MAX-ботом) — берём Node 24 из nvm, не трогая системный node.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/whatsapp-account"
exec node --env-file="$ROOT/.env" --import tsx src/main.ts
