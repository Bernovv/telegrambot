"""Состояние процессов pm2 для проверки канала MAX.

Отдельным файлом, а не строкой внутри bash: питон с кавычками внутри одинарных кавычек
шелла ломается молча, и вместо проверки получается синтаксическая ошибка в выводе.
"""
import json
import sys

WANTED = ("api", "worker")


def main() -> int:
    """Возвращает число найденных проблем: их считает вызывающий шелл."""
    try:
        procs = json.load(sys.stdin)
    except Exception:
        print("  ?      pm2 не отдал список процессов")
        return 0

    problems = 0

    seen = {}
    for proc in procs:
        name = proc.get("name")
        if name in WANTED:
            env = proc.get("pm2_env") or {}
            seen[name] = (env.get("status"), bool(env.get("NODE_EXTRA_CA_CERTS")))

    for name in WANTED:
        if name not in seen:
            print("  нет    процесса " + name + " нет в pm2")
            problems += 1
            continue
        status, has_cert = seen[name]
        if status == "online":
            print("  есть   " + name + ": online")
        else:
            print("  нет    " + name + ": " + str(status))
            problems += 1
        if has_cert:
            print("  есть   " + name + ": NODE_EXTRA_CA_CERTS в окружении")
        else:
            print(
                "  нет    " + name
                + ": NODE_EXTRA_CA_CERTS НЕ в окружении — вызовы MAX будут падать"
            )
            problems += 1

    return problems


sys.exit(main())
