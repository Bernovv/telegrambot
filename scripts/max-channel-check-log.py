"""Что MAX присылал нам за последнее время — по журналу nginx.

Отдельным файлом по той же причине, что и разбор pm2: питон с кавычками внутри одинарных
кавычек шелла ломается молча.

Смысл проверки — не в количестве строк, а в их возрасте. Журнал помнит всё, и обращения
недельной давности будут поднимать тревогу до следующей ротации, даже когда причина давно
устранена. Поэтому старое показывается отдельно и проблемой не считается.
"""
import re
import sys
from datetime import datetime, timedelta, timezone

# Сколько времени назад считается «сейчас». Обновления MAX приходят пачками по минутам,
# час — окно, в котором ещё видно последствия только что сделанной правки.
WINDOW = timedelta(hours=1)

LINE = re.compile(
    r"\[(?P<when>\d{2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2}) [^\]]*\]"
    r'\s+"(?P<method>\w+)\s+(?P<path>\S+)[^"]*"\s+(?P<status>\d{3})'
)
SECRET = re.compile(r"/webhooks/max/[A-Za-z0-9_-]+")


def main() -> int:
    now = datetime.now(timezone.utc)
    recent: dict[tuple[str, str], int] = {}
    older = 0
    stale_deliveries = 0

    for line in sys.stdin:
        if "webhooks/max" not in line or "deadbeefdeadbeefdeadbeef" in line:
            continue
        match = LINE.search(line)
        if not match:
            continue

        when = datetime.strptime(match.group("when"), "%d/%b/%Y:%H:%M:%S").replace(
            tzinfo=timezone.utc
        )
        if now - when > WINDOW:
            older += 1
            continue

        path = match.group("path")
        status = match.group("status")
        # Обращение на адрес без секрета значит одно из двух: жива лишняя подписка либо
        # MAX доигрывает повторы недоставленного — он ретраит до восьми часов. Код при этом
        # не важен: 502, когда старый бот выключен, и 200, когда он поднят.
        #
        # Второе опаснее первого и потому названо вслух: принимает такие повторы старый
        # бот, а он отвечает людям из старой базы и пишет в неё же.
        if not SECRET.search(path):
            stale_deliveries += 1
        recent[(SECRET.sub("/webhooks/max/<секрет>", path), status)] = (
            recent.get((SECRET.sub("/webhooks/max/<секрет>", path), status), 0) + 1
        )

    if not recent:
        print("  ?      за последний час обращений не было — напишите боту /start")
        if older:
            print(f"         (в журнале есть {older} записей постарше)")
        return 0

    for (path, status), count in sorted(recent.items(), key=lambda item: -item[1]):
        print(f"    {count:>4}  {path}  {status}")
    if older:
        print(f"         ещё {older} записей старше часа — это история, не проблема")

    if stale_deliveries:
        print(
            "  нет    за последний час были обращения на адрес без секрета."
        )
        print(
            "         Либо жива лишняя подписка, либо MAX доигрывает повторы"
            " недоставленного (до 8 часов)."
        )
        print(
            "         Если старый бот при этом запущен — он их принимает и отвечает"
            " людям из старой базы. Остановить."
        )
        return 1
    print("  есть   всё приходит только на наш адрес")
    return 0


sys.exit(main())
