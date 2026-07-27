// Показывает и меняет цену одного тарифа — вместо ручного SQL по боевой базе.
//
// Повод. 27 июля цену тестового билета правили запросом `update public.pricing_rules set
// unit_price_kopecks = 1000;` — без `where`. Десять рублей встали всем одиннадцати тарифам
// сразу, включая VIP и семейные, и в этот момент шли реальные продажи. Восстанавливали по
// миграции-сиду.
//
//   pnpm price:show                                    — показать все тарифы
//   pnpm price:set --product adult_standard --min 1 --rub 12          — примерка, без записи
//   pnpm price:set --product adult_standard --min 1 --rub 12 --apply  — записать
//
// Правило выбирается по коду продукта и нижней границе количества — ровно одно. Если под
// условие попадает больше одного или ни одного, скрипт откажется работать. Записывать без
// --apply он не умеет, а после записи показывает, что получилось.

import { loadWorkerConfig } from "@ticket-platform/config";
import { createNodePostgresPool } from "@ticket-platform/database";

interface RuleRow {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly minimum_quantity: number;
  readonly maximum_quantity: number | null;
  readonly unit_price_kopecks: string;
  readonly is_active: boolean;
}

const options = readOptions(process.argv.slice(2));
const config = loadWorkerConfig(process.env);
// В конфиге воркера мероприятия нет — оно нужно боту и API. Берём ту же переменную с тем же
// значением по умолчанию, что и они.
const eventSlug = process.env.TELEGRAM_PURCHASE_EVENT_SLUG ?? "business-picnic-2026";
const pool = createNodePostgresPool({
  connectionString: config.databaseUrl,
  maxConnections: 1,
  applicationName: "ticket-platform-set-price"
});

try {
  const rules = await readRules();
  printRules("Тарифы сейчас", rules);

  if (!options.product) {
    process.exit(0);
  }

  const matches = rules.filter(
    (rule) => rule.code === options.product && rule.minimum_quantity === options.minimum
  );
  if (matches.length === 0) {
    throw new Error(
      `Под условие (продукт ${options.product}, от ${options.minimum} шт.) не подходит ни одно правило`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Под условие подходит ${matches.length} правил — уточните условие, менять вслепую нельзя`
    );
  }

  const rule = matches[0];
  if (!rule) {
    throw new Error("Правило не найдено");
  }
  const kopecks = BigInt(Math.round(options.rubles * 100));
  console.log(
    `\nМеняю: ${rule.title} (${rule.code}), от ${rule.minimum_quantity} шт. — `
    + `${formatKopecks(rule.unit_price_kopecks)} → ${formatKopecks(kopecks.toString())}`
  );

  if (!options.apply) {
    console.log(
      "\nЭто примерка, база не тронута. Повторите ту же команду с --apply, чтобы записать."
    );
    process.exit(0);
  }

  const connection = await pool.connect();
  try {
    const updated = await connection.query(
      `update public.pricing_rules
       set unit_price_kopecks = $1, updated_at = now()
       where id = $2`,
      [kopecks.toString(), rule.id]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`Ожидалась одна изменённая строка, получено ${updated.rowCount}`);
    }
  } finally {
    connection.release();
  }

  printRules("\nТарифы после изменения", await readRules());
  console.log(
    "\nЦена действует сразу, для всех покупателей. Уже созданные заказы не изменятся —"
    + " в них цена зафиксирована снимком в момент оформления."
  );
} finally {
  await pool.close();
}

async function readRules(): Promise<readonly RuleRow[]> {
  const connection = await pool.connect();
  try {
    const result = await connection.query<RuleRow>(
      `select rule.id, product.code, product.title,
              rule.minimum_quantity, rule.maximum_quantity,
              rule.unit_price_kopecks, rule.is_active
       from public.pricing_rules rule
       join public.ticket_products product on product.id = rule.product_id
       join public.events event on event.id = product.event_id
       where event.slug = $1
       order by product.sort_order, rule.minimum_quantity`,
      [eventSlug]
    );
    return result.rows;
  } finally {
    connection.release();
  }
}

function printRules(caption: string, rules: readonly RuleRow[]): void {
  console.log(`${caption} (${eventSlug}):\n`);
  for (const rule of rules) {
    const range = rule.maximum_quantity === null
      ? `от ${rule.minimum_quantity}`
      : `${rule.minimum_quantity}–${rule.maximum_quantity}`;
    console.log(
      [
        rule.code.padEnd(16),
        `${range} шт.`.padEnd(12),
        formatKopecks(rule.unit_price_kopecks).padStart(12),
        rule.is_active ? "" : "  (отключено)"
      ].join("")
    );
  }
}

function formatKopecks(value: string): string {
  const kopecks = BigInt(value);
  const rubles = kopecks / 100n;
  const remainder = kopecks % 100n;
  return remainder === 0n
    ? `${rubles} ₽`
    : `${rubles},${remainder.toString().padStart(2, "0")} ₽`;
}

function readOptions(argv: readonly string[]) {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  const product = read("product");
  const apply = argv.includes("--apply");
  if (!product) {
    return { product: null, minimum: 0, rubles: 0, apply };
  }

  const minimumRaw = read("min");
  const rublesRaw = read("rub");
  if (!minimumRaw || !/^\d+$/.test(minimumRaw)) {
    throw new Error("Укажите нижнюю границу количества: --min 1");
  }
  if (!rublesRaw || !/^\d+([.,]\d{1,2})?$/.test(rublesRaw)) {
    throw new Error("Укажите цену в рублях: --rub 12 или --rub 2490.50");
  }

  return {
    product,
    minimum: Number(minimumRaw),
    rubles: Number(rublesRaw.replace(",", ".")),
    apply
  };
}
