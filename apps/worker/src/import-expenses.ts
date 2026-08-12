// Заносит расходы мероприятия из CSV — вместе с participants:import переносит пикник из
// таблицы в панель целиком.
//
//   pnpm expenses:import --file ~/расходы.csv --admin почта@пример.рф
//   pnpm expenses:import --file ~/расходы.csv --admin почта@пример.рф --apply
//
// Опасность та же, что у участников, — задвоение: расход, занесённый дважды, занижает
// прибыль и доли организаторов. Поэтому строка пропускается, если у мероприятия уже есть
// неотменённый расход с тем же названием и той же суммой. Повторный запуск безопасен.
//
// Оплаченным расход становится только вместе с датой: без неё он не попадёт в
// фактические расходы, а прибыль окажется завышенной. Строка без даты заводится как
// «договорились», сумма факта у неё всё равно проставлена.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadWorkerConfig } from "@ticket-platform/config";
import { createNodePostgresPool } from "@ticket-platform/database";
import { parseExpensesCsv, type ExpenseCsvRow } from "./participants-csv.js";

interface Plan {
  readonly row: ExpenseCsvRow;
  readonly action: "insert" | "skip";
  readonly reason: string;
}

const options = readOptions(process.argv.slice(2));
const config = loadWorkerConfig(process.env);
const eventSlug = process.env.TELEGRAM_PURCHASE_EVENT_SLUG ?? "business-picnic-2026";
const pool = createNodePostgresPool({
  connectionString: config.databaseUrl,
  maxConnections: 1,
  applicationName: "ticket-platform-import-expenses"
});

try {
  const rows = parseExpensesCsv(readFileSync(options.file, "utf8"));
  console.log(`Файл: ${options.file}\nСтрок в файле: ${rows.length}\n`);

  const connection = await pool.connect();
  try {
    const event = await connection.query<{ readonly id: string; readonly title: string }>(
      `select id, title from public.events where slug = $1`,
      [eventSlug]
    );
    const eventRow = event.rows[0];
    if (!eventRow) {
      throw new Error(`Мероприятие со slug ${eventSlug} не найдено`);
    }

    const admin = await connection.query<{ readonly id: string }>(
      `select id from public.admin_accounts
        where email_normalized = $1 and status = 'active'`,
      [options.admin.toLowerCase()]
    );
    const adminRow = admin.rows[0];
    if (!adminRow) {
      throw new Error(`Администратор ${options.admin} не найден или отключён`);
    }

    const categories = await connection.query<{ readonly code: string }>(
      `select code from public.expense_categories`,
      []
    );
    const known = new Set(categories.rows.map((row) => row.code));
    const unknown = [...new Set(rows.map((row) => row.category))]
      .filter((code) => !known.has(code));
    if (unknown.length > 0) {
      throw new Error(
        `Таких статей расходов нет: ${unknown.join(", ")}. `
        + `Есть: ${[...known].sort().join(", ")}`
      );
    }

    const existing = await connection.query<{
      readonly title: string;
      readonly planned_kopecks: string;
    }>(
      `select title, planned_kopecks::text as planned_kopecks
         from public.event_expenses
        where event_id = $1::uuid and status <> 'cancelled'`,
      [eventRow.id]
    );
    const seen = new Set(
      existing.rows.map((row) => `${row.title.trim().toLowerCase()}|${row.planned_kopecks}`)
    );

    const plans: Plan[] = rows.map((row) => {
      const key = `${row.title.trim().toLowerCase()}|${row.amountKopecks}`;
      return seen.has(key)
        ? { row, action: "skip" as const, reason: "уже заведён (то же название и сумма)" }
        : { row, action: "insert" as const, reason: "" };
    });

    const toInsert = plans.filter((plan) => plan.action === "insert");
    const skipped = plans.filter((plan) => plan.action === "skip");

    console.log(`Мероприятие: ${eventRow.title}`);
    console.log(`Расходов уже заведено: ${existing.rows.length}\n`);

    if (skipped.length > 0) {
      console.log(`Пропускаю ${skipped.length}:`);
      for (const plan of skipped) {
        console.log(`  ${plan.row.title} — ${plan.reason}`);
      }
      console.log("");
    }

    console.log(`Заведу ${toInsert.length}:`);
    for (const plan of toInsert) {
      const row = plan.row;
      console.log(
        `  ${row.category.padEnd(11)}${row.title.padEnd(24).slice(0, 24)}`
        + `${String(Number(row.amountKopecks) / 100).padStart(10)} ₽  `
        + `${row.paidAt === "" ? "договорились" : `оплачено ${row.paidAt}`}`
      );
    }

    const total = toInsert.reduce(
      (sum, plan) => sum + BigInt(plan.row.amountKopecks),
      0n
    );
    console.log(`\nИтого к заведению: ${Number(total) / 100} ₽`);

    if (!options.apply) {
      console.log(
        "\nЭто примерка, база не тронута. Повторите ту же команду с --apply, чтобы записать."
      );
      process.exit(0);
    }

    // Одной транзакцией: половина сметы хуже, чем её отсутствие — по ней уже нельзя
    // понять, посчитан расход целиком или нет.
    await connection.query("begin");
    try {
      for (const plan of toInsert) {
        const row = plan.row;
        await connection.query(
          `insert into public.event_expenses (
             id, event_id, category_code, title, quantity, unit,
             planned_kopecks, actual_kopecks, status, paid_at, note,
             created_by_admin_id
           ) values (
             $1::uuid, $2::uuid, $3::text, $4::text, $5::numeric, $6::text,
             $7::bigint, $7::bigint,
             case when $8::timestamptz is null then 'committed' else 'paid' end,
             $8::timestamptz, $9::text, $10::uuid
           )`,
          [
            randomUUID(),
            eventRow.id,
            row.category,
            row.title,
            row.quantity,
            row.unit,
            row.amountKopecks,
            row.paidAt === "" ? null : row.paidAt,
            row.note,
            adminRow.id
          ]
        );
      }
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    }

    console.log(`\nГотово: заведено ${toInsert.length} расходов.`);
    console.log(
      "Теперь на вкладке «Команда» прибыль считается по-настоящему —"
      + " сверьте её со своей таблицей."
    );
  } finally {
    connection.release();
  }
} finally {
  await pool.close();
}

function readOptions(argv: readonly string[]) {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  const file = read("file");
  const admin = read("admin");
  if (!file) {
    throw new Error("Укажите файл: --file ~/расходы.csv");
  }
  if (!admin) {
    throw new Error("Укажите почту администратора: --admin почта@пример.рф");
  }
  return { file, admin, apply: argv.includes("--apply") };
}
