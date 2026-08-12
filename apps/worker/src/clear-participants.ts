// Убирает заведённых руками участников мероприятия — чтобы перезалить список заново.
//
//   pnpm participants:clear --admin почта@пример.рф --reason "перезаливаю список"
//   pnpm participants:clear --admin почта@пример.рф --reason "перезаливаю список" --apply
//
// Повод. Первый перенос августовского пикника занёс спутников («С +1», «Муж», «Ребенок»)
// отдельными карточками. Повторный импорт это не чинит: он узнаёт хозяев по имени и
// пропускает их, а лишние карточки остаются. Значит нужно снять занесённое и занести
// заново.
//
// Удаление мягкое, как в панели: строка остаётся в базе с датой, причиной и тем, кто её
// убрал. Покупателей бота команда не трогает вовсе — у них не карточки, а заказы.

import { loadWorkerConfig } from "@ticket-platform/config";
import { createNodePostgresPool } from "@ticket-platform/database";
import { resolveAdminId } from "./admin-lookup.js";

interface ParticipantRow {
  readonly id: string;
  readonly display_name: string;
  readonly adults: number;
  readonly children: number;
  readonly amount_kopecks: string | null;
}

const options = readOptions(process.argv.slice(2));
const config = loadWorkerConfig(process.env);
const eventSlug = process.env.TELEGRAM_PURCHASE_EVENT_SLUG ?? "business-picnic-2026";
const pool = createNodePostgresPool({
  connectionString: config.databaseUrl,
  maxConnections: 1,
  applicationName: "ticket-platform-clear-participants"
});

try {
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

    const participants = await connection.query<ParticipantRow>(
      `select id, display_name, adults, children, amount_kopecks::text as amount_kopecks
         from public.event_participants
        where event_id = $1::uuid and deleted_at is null
        order by created_at`,
      [eventRow.id]
    );

    console.log(`Мероприятие: ${eventRow.title}`);
    console.log(`Заведено руками сейчас: ${participants.rows.length}\n`);

    if (participants.rows.length === 0) {
      console.log("Убирать нечего.");
      process.exit(0);
    }

    console.log("Уберу:");
    for (const row of participants.rows) {
      const money = row.amount_kopecks === null
        ? "0"
        : String(Number(row.amount_kopecks) / 100);
      console.log(
        `  ${row.display_name.padEnd(34).slice(0, 34)}`
        + `взр ${row.adults}  дет ${row.children}  ${money} ₽`
      );
    }
    const guests = participants.rows.reduce(
      (sum, row) => sum + row.adults + row.children,
      0
    );
    console.log(`\nВсего ${participants.rows.length} карточек, ${guests} гостей.`);
    console.log(
      "Покупателей бота это не касается — у них заказы, а не карточки."
    );

    if (!options.apply) {
      console.log(
        "\nЭто примерка, база не тронута. Повторите ту же команду с --apply, чтобы убрать."
      );
      process.exit(0);
    }

    const removed = await connection.query(
      `update public.event_participants
          set deleted_at = now(),
              deleted_reason = $2::text,
              deleted_by_admin_id = $3::uuid,
              updated_at = now()
        where event_id = $1::uuid and deleted_at is null`,
      [eventRow.id, options.reason, adminId]
    );

    console.log(`\nГотово: убрано ${removed.rowCount} карточек.`);
    console.log(
      "Строки остались в базе с причиной и датой — история не потеряна."
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

  const admin = read("admin");
  const reason = read("reason");
  if (!admin) {
    throw new Error("Укажите почту администратора: --admin почта@пример.рф");
  }
  // Та же граница, что в базе: причина короче трёх символов ничего не объясняет тому,
  // кто откроет эту строку через полгода.
  if (!reason || reason.trim().length < 3 || reason.trim().length > 500) {
    throw new Error('Укажите причину от трёх символов: --reason "перезаливаю список"');
  }
  return { admin, reason: reason.trim(), apply: argv.includes("--apply") };
}
