#!/usr/bin/env bash
# Проверка канала MAX: всё ли на месте после включения.
#
# Запускается на сервере, ничего не меняет — только читает. Нужен после включения канала,
# после перезагрузки сервера и после любой правки .env или nginx: половина настроек здесь
# такая, что при пропаже канал молчит, а не падает, и заметить это можно только специально.
#
#   bash scripts/max-channel-check.sh
#
# Секреты не печатаются: только длины и признак «задано».
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

ENV_FILE=".env"
CERT_DEFAULT="/home/maxbot/max-bot/certs/russian_trusted_ca.pem"
ACCESS_LOG="/var/log/nginx/access.log"

problems=0

ok()   { printf '  \033[32mесть\033[0m   %s\n' "$1"; }
bad()  { printf '  \033[31mнет\033[0m    %s\n' "$1"; problems=$((problems + 1)); }
warn() { printf '  \033[33m?\033[0m      %s\n' "$1"; }
head_() { printf '\n%s\n' "$1"; }

env_value() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }

# --- Настройки -------------------------------------------------------------
head_ "Настройки в .env"
for name in MAX_BOT_TOKEN MAX_WEBHOOK_PATH_SECRET MAX_WEBHOOK_SECRET; do
  value=$(env_value "$name")
  if [ -n "$value" ]; then ok "$name (${#value} знаков)"; else bad "$name не задан"; fi
done

username=$(env_value MAX_BOT_USERNAME)
if [ -n "$username" ]; then
  ok "MAX_BOT_USERNAME"
else
  # Не ошибка, но партнёрская ссылка без имени бота не выдаётся вовсе.
  warn "MAX_BOT_USERNAME пуст — партнёрская ссылка в MAX выдаваться не будет"
fi

# --- Сертификат ------------------------------------------------------------
head_ "Сертификат Минцифры"
cert=$(env_value NODE_EXTRA_CA_CERTS)
cert=${cert:-$CERT_DEFAULT}
if [ -r "$cert" ]; then ok "файл на месте: $cert"; else bad "файл не читается: $cert"; fi

# --- Процессы --------------------------------------------------------------
# Переменная нужна именно в окружении процессов: Node читает её до старта, и из .env она
# не подхватится. Без неё вызовы MAX падают безымянным «fetch failed».
head_ "Процессы"
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | python3 -c '
import json, sys
try:
    procs = json.load(sys.stdin)
except Exception:
    print("  ?      pm2 не отдал список процессов"); sys.exit(0)
wanted = {"api", "worker"}
seen = {}
for p in procs:
    name = p.get("name")
    if name in wanted:
        env = p.get("pm2_env", {}) or {}
        seen[name] = (env.get("status"), bool(env.get("NODE_EXTRA_CA_CERTS")))
for name in sorted(wanted):
    if name not in seen:
        print(f"  нет    процесса {name} нет в pm2")
        continue
    status, has_cert = seen[name]
    print(f"  {'есть' if status == 'online' else 'нет '}   {name}: {status}")
    if has_cert:
        print(f"  есть   {name}: NODE_EXTRA_CA_CERTS в окружении")
    else:
        print(f"  нет    {name}: NODE_EXTRA_CA_CERTS НЕ в окружении — вызовы MAX будут падать")
'
else
  warn "pm2 не найден — проверьте процессы вручную"
fi

if [ -f "$HOME/.pm2/dump.pm2" ]; then
  ok "pm2 save сделан — окружение переживёт перезагрузку"
else
  bad "pm2 save не сделан: после перезагрузки сертификат пропадёт, и MAX замолчит"
fi

# --- Старый бот ------------------------------------------------------------
head_ "Старый MAX-бот"
if ! command -v systemctl >/dev/null 2>&1; then
  # Молчать нельзя: без systemctl проверка не «прошла», а не состоялась.
  warn "systemctl недоступен — состояние max-bot не проверено"
elif systemctl is-active --quiet max-bot; then
  warn "max-bot запущен. Отвечать людям он не может (подписки нет), но проверьте, что так и задумано"
else
  ok "max-bot остановлен"
fi
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-enabled --quiet max-bot 2>/dev/null; then
    bad "max-bot в автозапуске — после перезагрузки поднимется сам"
  else
    ok "max-bot снят с автозапуска"
  fi
fi

# --- Вебхук ----------------------------------------------------------------
head_ "Вебхук"
base=$(env_value MAX_WEBHOOK_BASE_URL)
base=${base:-https://max-bot.biz-day.ru}
path_secret=$(env_value MAX_WEBHOOK_PATH_SECRET)
header_secret=$(env_value MAX_WEBHOOK_SECRET)

wrong=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  "$base/webhooks/max/deadbeefdeadbeefdeadbeef" 2>/dev/null)
if [ "$wrong" = "404" ]; then
  ok "чужой ключ отвергается ($wrong)"
else
  bad "чужой ключ даёт $wrong вместо 404"
fi

if [ -n "$path_secret" ]; then
  mine=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
    -H 'Content-Type: application/json' -H "X-Max-Bot-Api-Secret: $header_secret" \
    -d '{"update_type":"ping"}' "$base/webhooks/max/$path_secret" 2>/dev/null)
  if [ "$mine" = "200" ]; then
    ok "свой ключ принимается ($mine)"
  else
    bad "свой ключ даёт $mine вместо 200"
  fi
fi

# --- Подписки на стороне MAX ----------------------------------------------
head_ "Подписки в MAX"
token=$(env_value MAX_BOT_TOKEN)
if [ -n "$token" ]; then
  NODE_EXTRA_CA_CERTS="$cert" curl -s -m 15 --cacert "$cert" \
    -H "Authorization: $token" "https://platform-api2.max.ru/subscriptions" 2>/dev/null \
    | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print("  ?      MAX не ответил — проверьте сертификат и сеть"); sys.exit(0)
try:
    data = json.loads(raw)
except Exception:
    print("  ?      MAX ответил не JSON:", raw[:80]); sys.exit(0)
items = data.get("subscriptions", data if isinstance(data, list) else [])
if not items:
    print("  нет    подписок нет вовсе — MAX не будет слать обновления")
    sys.exit(0)
for item in items:
    url = item.get("url", "")
    shown = url.rsplit("/", 1)[0] + "/<секрет>" if "/webhooks/max/" in url else url
    marker = "есть" if "/webhooks/max/" in url else "нет "
    note = "" if "/webhooks/max/" in url else "  ← лишняя, снять"
    print(f"  {marker}   {shown}{note}")
if len(items) > 1:
    print("  нет    подписок больше одной: лишние бьются в мёртвый порт")
'
else
  warn "нет токена — подписки не проверить"
fi

# --- Что реально приходит --------------------------------------------------
head_ "Последние обращения MAX (из журнала nginx)"
if [ -r "$ACCESS_LOG" ]; then
  recent=$(grep "webhooks/max" "$ACCESS_LOG" 2>/dev/null | tail -50 \
    | sed 's|/webhooks/max/[A-Za-z0-9_-]*|/webhooks/max/<секрет>|' \
    | awk '{print $7, $9}' | sort | uniq -c | sort -rn)
  if [ -n "$recent" ]; then
    printf '%s\n' "$recent" | sed 's/^/    /'
    if printf '%s' "$recent" | grep -q "webhooks/max 502"; then
      bad "есть 502 на адрес без секрета — старая подписка ещё жива"
    fi
  else
    warn "обращений не было — напишите боту /start и повторите проверку"
  fi
else
  warn "журнал nginx недоступен"
fi

# --- Данные ----------------------------------------------------------------
head_ "Данные MAX в общей базе"
db=$(env_value DATABASE_DIRECT_URL)
if [ -n "$db" ] && command -v psql >/dev/null 2>&1; then
  psql "$db" -tA -F' · ' -c "
    select 'людей из MAX', count(*)::text from public.messenger_identities where channel='max'
    union all
    select 'телефонов из MAX', count(*)::text from public.user_contacts where source='max_contact'
    union all
    select 'заказов MAX', count(*)::text from public.orders where channel='max'
    union all
    select 'согласий MAX', count(*)::text from public.offer_acceptances where channel='max'
    union all
    select 'доставок в MAX за сутки', count(*)::text from public.notification_deliveries
      where recipient_channel='max' and created_at > now() - interval '1 day'
    union all
    select 'из них не доставлено', count(*)::text from public.notification_deliveries
      where recipient_channel='max' and status='failed' and created_at > now() - interval '1 day'
  " 2>/dev/null | sed 's/^/    /' || warn "база не ответила"
else
  warn "psql или DATABASE_DIRECT_URL недоступны — данные не проверить"
fi

# --- Итог ------------------------------------------------------------------
if [ "$problems" -eq 0 ]; then
  printf '\n\033[32mВсё на месте.\033[0m Строки с «?» — не ошибки, а то, что стоит посмотреть глазами.\n'
else
  printf '\n\033[31mНашлось проблем: %s.\033[0m Каждая помечена «нет» выше.\n' "$problems"
  exit 1
fi
