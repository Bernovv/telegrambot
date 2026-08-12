// Заносит участников мероприятия из CSV — вместо того, чтобы вбивать их руками по одному.
//
// Повод. Пикник 8–9 августа вёлся в таблице, а не в панели: 77 строк, и переносить их
// вручную — несколько часов и неизбежные опечатки в телефонах.
//
//   pnpm participants:import --file ~/участники.csv --admin почта@пример.рф
//   pnpm participants:import --file ~/участники.csv --admin почта@пример.рф --apply
//
// Главная опасность здесь — задвоение. Часть людей купила через бота и уже лежит в базе
// оплаченными заказами; заведи их ещё и руками — удвоятся гости, выручка, палатки и порции.
// Поэтому скрипт сначала читает оплаченные заказы мероприятия и пропускает всех, кто
// сходится по телефону или нику в Telegram, а заодно тех, кого уже заводили руками раньше.
// Из этого же следует, что повторный запуск безопасен: второй раз он не заведёт никого.
//
// Без --apply скрипт только показывает, что собирается сделать, и базу не трогает.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadWorkerConfig } from "@ticket-platform/config";
import { createNodePostgresPool } from "@ticket-platform/database";
import { resolveAdminId } from "./admin-lookup.js";
import {
  parseParticipantsCsv,
  type ParticipantCsvRow
} from "./participants-csv.js";

interface Plan {
  readonly row: ParticipantCsvRow;
  readonly action: "insert" | "skip";
  readonly reason: string;
}

const options = readOptions(process.argv.slice(2));
const config = loadWorkerConfig(process.env);
const eventSlug = process.env.TELEGRAM_PURCHASE_EVENT_SLUG ?? "business-picnic-2026";
const pool = createNodePostgresPool({
  connectionString: config.databaseUrl,
  maxConnections: 1,
  applicationName: "ticket-platform-import-participants"
});

try {
  const rows = parseParticipantsCsv(readFileSync(options.file, "utf8"));
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

    const adminId = await resolveAdminId(connection, options.admin);

    const buyers = await connection.query<{
      readonly phone: string | null;
      readonly username: string | null;
    }>(
      `select
         contact.value_normalized as phone,
         identity.username as username
       from public.orders o
       left join lateral (
         select value_normalized from public.user_contacts
          where user_id = o.user_id and contact_type = 'phone'
          order by is_primary desc, created_at limit 1
       ) contact on true
       left join lateral (
         select username from public.messenger_identities
          where user_id = o.user_id and username is not null
          order by last_seen_at desc, id limit 1
       ) identity on true
       where o.event_id = $1::uuid
         and o.status = 'paid'
         and o.excluded_at is null`,
      [eventRow.id]
    );
    const existing = await connection.query<{
      readonly display_name: string;
      readonly phone_e164: string | null;
    }>(
      `select display_name, phone_e164
         from public.event_participants
        where event_id = $1::uuid and deleted_at is null`,
      [eventRow.id]
    );

    const buyerPhones = new Set(
      buyers.rows.map((row) => row.phone).filter((value): value is string => value !== null)
    );
    const buyerHandles = new Set(
      buyers.rows
        .map((row) => row.username?.toLowerCase())
        .filter((value): value is string => value !== undefined)
    );
    const knownPhones = new Set(
      existing.rows
        .map((row) => row.phone_e164)
        .filter((value): value is string => value !== null)
    );
    const knownNames = new Set(
      existing.rows.map((row) => row.display_name.trim().toLowerCase())
    );

    const plans: Plan[] = rows.map((row) => {
      const handle = row.telegram.replace(/^@/, "").toLowerCase();
      if (row.phone !== "" && buyerPhones.has(row.phone)) {
        return { row, action: "skip", reason: "уже купил через бота (телефон)" };
      }
      if (handle !== "" && buyerHandles.has(handle)) {
        return { row, action: "skip", reason: "уже купил через бота (Telegram)" };
      }
      if (row.phone !== "" && knownPhones.has(row.phone)) {
        return { row, action: "skip", reason: "уже заведён руками (телефон)" };
      }
      if (knownNames.has(row.name.trim().toLowerCase())) {
        return { row, action: "skip", reason: "уже заведён руками (имя)" };
      }
      return { row, action: "insert", reason: "" };
    });

    const toInsert = plans.filter((plan) => plan.action === "insert");
    const skipped = plans.filter((plan) => plan.action === "skip");

    console.log(`Мероприятие: ${eventRow.title}`);
    console.log(`Оплаченных заказов через бота: ${buyers.rows.length}`);
    console.log(`Уже заведено руками: ${existing.rows.length}\n`);

    if (skipped.length > 0) {
      console.log(`Пропускаю ${skipped.length}:`);
      for (const plan of skipped) {
        console.log(`  ${plan.row.row.padStart(3)}  ${plan.row.name} — ${plan.reason}`);
      }
      console.log("");
    }

    console.log(`Заведу ${toInsert.length}:`);
    for (const plan of toInsert) {
      const row = plan.row;
      console.log(
        `  ${row.row.padStart(3)}  ${row.name.padEnd(32).slice(0, 32)}`
        + `${(row.phone || "—").padEnd(14)}`
        + `взр ${row.adults}  дет ${row.children}  мест ${row.sleeping}`
        + `  ${Number(row.amountKopecks) / 100} ₽`
      );
    }

    const guests = toInsert.reduce(
      (sum, plan) => sum + Number(plan.row.adults) + Number(plan.row.children),
      0
    );
    const berths = toInsert.reduce((sum, plan) => sum + Number(plan.row.sleeping), 0);
    const money = toInsert.reduce(
      (sum, plan) => sum + BigInt(plan.row.amountKopecks),
      0n
    );
    console.log(
      `\nИтого к заведению: ${guests} гостей, ${berths} спальных мест,`
      + ` ${Number(money) / 100} ₽`
    );

    if (!options.apply) {
      console.log(
        "\nЭто примерка, база не тронута. Повторите ту же команду с --apply, чтобы записать."
      );
      process.exit(0);
    }

    // Всё одной транзакцией: наполовину занесённый список хуже, чем не занесённый вовсе —
    // по нему уже нельзя понять, где остановились.
    await connection.query("begin");
    try {
      for (const plan of toInsert) {
        const row = plan.row;
        await connection.query(
          `insert into public.event_participants (
             id, event_id, display_name, phone_e164, source, ticket_title,
             adults, children, sleeping_places, note, amount_kopecks,
             created_by_admin_id
           ) values (
             $1::uuid, $2::uuid, $3::text, $4::text, $5::text, '',
             $6::integer, $7::integer, $8::integer, $9::text, $10::bigint,
             $11::uuid
           )`,
          [
            randomUUID(),
            eventRow.id,
            row.name,
            row.phone === "" ? null : row.phone,
            row.source,
            Number(row.adults),
            Number(row.children),
            Number(row.sleeping),
            [row.note, row.telegram].filter((part) => part !== "").join("; ").slice(0, 500),
            row.amountKopecks,
            adminId
          ]
        );
      }
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    }

    console.log(`\nГотово: заведено ${toInsert.length} участников.`);
    console.log(
      "Откройте вкладку «Участники» и сверьте итоги со своей таблицей."
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
    throw new Error("Укажите файл: --file ~/участники.csv");
  }
  if (!admin) {
    throw new Error("Укажите почту администратора: --admin почта@пример.рф");
  }
  return { file, admin, apply: argv.includes("--apply") };
}
