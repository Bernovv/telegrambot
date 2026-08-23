// Проверяет, что в .env заполнено всё, без чего продакшн работает неправильно — но молча.
//
// Повод. 27 июля локальную копию .env скопировали на сервер, а в ней не было адреса
// Cloudflare-прокси: он задавался только на сервере. Значение затёрлось пустым, обращения к
// Telegram пошли напрямую и начали отваливаться. Ни один процесс при этом не упал и не
// пожаловался: переменная объявлена необязательной, а без неё код просто идёт по другому пути.
// Ошибку нашли через два часа по косвенным признакам.
//
//   pnpm env:check              — проверить ./.env
//   pnpm env:check путь/к/.env  — проверить конкретный файл
//
// Проверка намеренно тупая: она ничего не знает про правильные значения, только про то, что
// переменная не должна быть пустой и должна выглядеть как обещано.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIRED = [
  {
    name: "TELEGRAM_BOT_TOKEN",
    hint: "токен бота из BotFather",
    pattern: /^\d+:[A-Za-z0-9_-]{30,}$/
  },
  {
    name: "TELEGRAM_API_ROOT",
    hint: "адрес Cloudflare-прокси; без него бот пойдёт напрямую в Telegram, "
      + "а с российского сервера это не работает",
    pattern: /^https:\/\/[^/]+$/,
    patternHint: "https://... без слэша на конце"
  },
  {
    name: "DATABASE_URL",
    hint: "строка подключения к базе",
    pattern: /^postgres(ql)?:\/\/.+@.+\/.+$/
  },
  {
    name: "DATABASE_DIRECT_URL",
    hint: "строка подключения для миграций и скриптов",
    pattern: /^postgres(ql)?:\/\/.+@.+\/.+$/
  },
  { name: "TBANK_TERMINAL_KEY", hint: "терминал Т-Банка" },
  { name: "TBANK_PASSWORD", hint: "пароль терминала Т-Банка" },
  {
    name: "TBANK_NOTIFICATION_URL",
    hint: "адрес, куда Т-Банк шлёт уведомления об оплате",
    pattern: /^https:\/\/.+/
  },
  { name: "ORDER_TOKEN_SECRET", hint: "секрет для ссылок на заказы" },
  // ENCRYPTION_KEY и SENTRY_DSN в шаблоне есть, но в коде не используются — это задел на
  // будущее. В список не добавлены намеренно: проверка, которая ругается без последствий,
  // быстро становится шумом, и настоящую находку в этом шуме пропустят.
  {
    name: "ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID",
    hint: "кому бот пишет о покупках",
    pattern: /^-?\d+(,-?\d+)*$/,
    patternHint: "числовые chat_id через запятую"
  }
];

// Эти включаются вместе: панель без любой из них соберётся и запустится, но войти будет нельзя.
const ADMIN_PANEL = [
  {
    name: "ADMIN_AUTH_ISSUER",
    pattern: /^https:\/\/.+\/auth\/v1$/,
    patternHint: "адрес проекта Supabase С хвостом /auth/v1"
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    pattern: /^https:\/\/[^/]+$/,
    patternHint: "адрес проекта Supabase БЕЗ /auth/v1 и без слэша"
  },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" },
  {
    name: "ADMIN_API_BASE_URL",
    pattern: /^https?:\/\/[^/]+$/,
    patternHint: "адрес API без слэша на конце"
  }
];

// Аккаунт компании в Telegram. Включается наличием TELEGRAM_ACCOUNT_API_ID; всё остальное
// с этого момента обязательно. Прокси — в первую очередь: без него аккаунт с этого сервера
// Telegram не увидит вовсе, а выглядеть это будет как молчание, а не как ошибка.
const TELEGRAM_ACCOUNT = [
  {
    name: "TELEGRAM_ACCOUNT_API_HASH",
    hint: "хэш приложения с my.telegram.org",
    pattern: /^[A-Za-z0-9_-]{32,}$/
  },
  {
    name: "TELEGRAM_ACCOUNT_PHONE",
    hint: "номер аккаунта; по нему сверяется, что вошли под тем",
    pattern: /^\+[1-9]\d{7,14}$/,
    patternHint: "+7XXXXXXXXXX"
  },
  {
    name: "TELEGRAM_ACCOUNT_SESSION_DIR",
    hint: "каталог сессии TDLib; его потеря означает новый вход по коду",
    pattern: /^\/.+/,
    patternHint: "абсолютный путь"
  },
  {
    name: "TELEGRAM_ACCOUNT_DB_KEY",
    hint: "ключ шифрования базы TDLib: openssl rand -hex 32",
    pattern: /^[A-Za-z0-9_-]{32,256}$/
  },
  {
    name: "TELEGRAM_ACCOUNT_PROXY",
    hint: "прокси до Telegram на зарубежной машине; TELEGRAM_API_ROOT его не заменяет — "
      + "тот воркер умеет только HTTP-запросы Bot API",
    pattern: /^(socks5h?|mtproxy|mtproto):\/\/[^/]+:\d+$/,
    patternHint: "socks5://логин:пароль@хост:порт или mtproxy://секрет@хост:порт "
      + "(socks5h тоже принимается — это то же самое)"
  }
];

// Аккаунт компании в MAX. Включается наличием MAX_ACCOUNT_DEVICE_ID. Токена среди
// обязательных нет намеренно: канал включают до первого входа, а токен появляется после.
// Зато его отсутствие видно в проверке канала — там оно значит «процесс не поднимется».
const MAX_ACCOUNT = [
  {
    name: "MAX_ACCOUNT_PHONE",
    hint: "номер аккаунта MAX; по нему сверяется, что вошли под тем",
    pattern: /^\+[1-9]\d{7,14}$/,
    patternHint: "+7XXXXXXXXXX"
  },
  {
    name: "MAX_ACCOUNT_DEVICE_ID",
    hint: "постоянный идентификатор устройства: uuidgen один раз и больше не менять — "
      + "меняющийся выглядит для их антифрода как вход с нового устройства",
    pattern: /^[A-Za-z0-9-]{8,64}$/
  }
];

// Аккаунт компании в WhatsApp. Включается наличием WHATSAPP_ACCOUNT_SESSION_DIR. Прокси —
// в первую очередь и по той же причине, что у Telegram: без него канал не увидит WhatsApp
// вовсе, а выглядеть это будет как тишина в переписке, а не как ошибка.
const WHATSAPP_ACCOUNT = [
  {
    name: "WHATSAPP_ACCOUNT_PHONE",
    hint: "номер аккаунта, только цифры и без плюса — так его ждёт привязка по коду",
    pattern: /^[1-9]\d{7,14}$/,
    patternHint: "79XXXXXXXXX"
  },
  {
    name: "WHATSAPP_ACCOUNT_PROXY",
    hint: "прокси до WhatsApp; годится та же амстердамская машина, что у Telegram-аккаунта. "
      + "Своя переменная, а не общая: одна правка не должна гасить два канала сразу",
    pattern: /^socks5h?:\/\/[^/]+:\d+$/,
    patternHint: "socks5://логин:пароль@хост:порт"
  }
];

const path = resolve(process.argv[2] ?? ".env");
const values = parseEnvFile(await readFile(path, "utf8"));
const problems = [];

for (const variable of REQUIRED) {
  problems.push(...inspect(variable, { required: true }));
}

if (values.get("ADMIN_AUTH_ENABLED") === "true") {
  for (const variable of ADMIN_PANEL) {
    problems.push(...inspect(variable, { required: true, context: "админ-панель включена" }));
  }
}

if ((values.get("TELEGRAM_ACCOUNT_API_ID") ?? "") !== "") {
  for (const variable of TELEGRAM_ACCOUNT) {
    problems.push(...inspect(variable, { required: true, context: "аккаунт компании включён" }));
  }
}

if ((values.get("MAX_ACCOUNT_DEVICE_ID") ?? "") !== "") {
  for (const variable of MAX_ACCOUNT) {
    problems.push(...inspect(variable, {
      required: true,
      context: "аккаунт компании в MAX включён"
    }));
  }
}

if ((values.get("WHATSAPP_ACCOUNT_SESSION_DIR") ?? "") !== "") {
  for (const variable of WHATSAPP_ACCOUNT) {
    problems.push(...inspect(variable, {
      required: true,
      context: "аккаунт компании в WhatsApp включён"
    }));
  }
}

if (problems.length > 0) {
  console.error(`Проблемы в ${path}:`);
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  console.error(
    "\nЧаще всего это следствие копирования .env поверх серверного: значения, которые"
    + " задавались только на сервере, затираются пустыми."
  );
  process.exit(1);
}

console.log(`${path}: обязательные переменные заполнены.`);

function inspect(variable, { required, context }) {
  const value = values.get(variable.name);
  const where = context ? ` (${context})` : "";

  if (value === undefined) {
    return required ? [`${variable.name} — строки нет вовсе${where}${describe(variable)}`] : [];
  }
  if (value === "") {
    return required ? [`${variable.name} — пустое значение${where}${describe(variable)}`] : [];
  }
  if (variable.pattern && !variable.pattern.test(value)) {
    return [
      `${variable.name} — значение не похоже на ожидаемое${where}`
      + (variable.patternHint ? `: ожидается ${variable.patternHint}` : "")
    ];
  }
  return [];
}

function describe(variable) {
  return variable.hint ? `: ${variable.hint}` : "";
}

function parseEnvFile(content) {
  const values = new Map();

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }

  return values;
}
