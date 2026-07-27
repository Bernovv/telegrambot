// Показывает и возвращает в работу уведомления, которые очередь сдала в мёртвые письма.
//
// Зачем это нужно. Доставка билетов, анкет и уведомлений администратору идёт через очередь.
// Если задача не проходит все попытки — она уходит в очередь outbox-dispatch-dead-letter и
// оттуда уже никогда не вернётся сама. Ни в логах, ни в панели этого не видно: заказ оплачен,
// а билета у человека нет. Именно так 27 июля потерялся билет, когда канал до Telegram лежал
// два часа.
//
//   pnpm queue:dead-letter                        — показать, что застряло
//   pnpm queue:dead-letter --retry-all            — вернуть всё в работу
//   pnpm queue:dead-letter --retry <id> [<id>...] — вернуть выбранные
//
// Скрипт только перекладывает задачи обратно в рабочую очередь. Повторная доставка безопасна:
// у обработчика есть журнал доставок, и уже отправленное он считает дублем, а не шлёт второй раз.

import { PgBoss } from "pg-boss";
import { loadWorkerConfig } from "@ticket-platform/config";
import { createNodePostgresPool } from "@ticket-platform/database";
import {
  OUTBOX_DISPATCH_DEAD_LETTER_QUEUE,
  OUTBOX_DISPATCH_QUEUE
} from "./pgboss.js";

interface DeadLetterRow {
  readonly id: string;
  readonly created_on: Date;
  readonly data: DeadLetterData | null;
  readonly output: { readonly message?: unknown } | null;
}

interface DeadLetterData {
  readonly event?: { readonly type?: unknown };
  readonly entity?: { readonly id?: unknown };
}

const config = loadWorkerConfig(process.env);
const pool = createNodePostgresPool({
  connectionString: config.databaseUrl,
  maxConnections: 1,
  applicationName: "ticket-platform-dead-letter"
});
const boss = new PgBoss({
  connectionString: config.databaseUrl,
  schema: config.pgBossSchema,
  max: 2,
  application_name: "ticket-platform-dead-letter",
  migrate: false,
  schedule: false,
  useListenNotify: false
});

try {
  const requested = readRequestedIds(process.argv.slice(2));
  const rows = await readDeadLetterJobs();

  if (rows.length === 0) {
    console.log("В очереди мёртвых писем пусто — всё доставлено.");
  } else {
    console.log(`Застрявших доставок: ${rows.length}\n`);
    for (const row of rows) {
      console.log([
        row.id,
        formatMoment(row.created_on),
        readEventType(row.data),
        readEntityId(row.data),
        readFailureMessage(row.output)
      ].join("  |  "));
    }
  }

  if (requested === null) {
    if (rows.length > 0) {
      console.log(
        "\nВернуть в работу: pnpm queue:dead-letter --retry-all"
        + " (или --retry <id> для выбранных)."
      );
    }
  } else {
    const selected = requested === "all"
      ? rows
      : rows.filter((row) => requested.includes(row.id));

    if (requested !== "all") {
      for (const id of requested.filter((value) => !rows.some((row) => row.id === value))) {
        console.error(`Задача ${id} среди застрявших не найдена — пропускаю.`);
      }
    }

    await boss.start();
    let republished = 0;
    for (const row of selected) {
      if (!row.data) {
        console.error(`У задачи ${row.id} нет данных события — вернуть её нельзя.`);
        continue;
      }
      // Идентификатор события не переиспользуем: исходная задача с ним уже существует, и
      // очередь отклонит повтор как дубль.
      await boss.send(OUTBOX_DISPATCH_QUEUE, row.data as object);
      await boss.complete(OUTBOX_DISPATCH_DEAD_LETTER_QUEUE, row.id);
      republished += 1;
    }
    await boss.stop();

    console.log(`\nВозвращено в работу: ${republished}.`);
    if (republished > 0) {
      console.log("Доставка пойдёт в ближайшие секунды — смотрите pm2 logs worker.");
    }
  }
} finally {
  await pool.close();
}

async function readDeadLetterJobs(): Promise<readonly DeadLetterRow[]> {
  const connection = await pool.connect();
  try {
    const result = await connection.query<DeadLetterRow>(
      `select id, created_on, data, output
       from pgboss.job
       where name = $1
         and state in ('created', 'retry', 'failed')
       order by created_on
       limit 200`,
      [OUTBOX_DISPATCH_DEAD_LETTER_QUEUE]
    );
    return result.rows;
  } finally {
    connection.release();
  }
}

function readRequestedIds(argv: readonly string[]): readonly string[] | "all" | null {
  if (argv.includes("--retry-all")) {
    return "all";
  }
  const index = argv.indexOf("--retry");
  if (index === -1) {
    return null;
  }
  const ids = argv.slice(index + 1).filter((value) => !value.startsWith("--"));
  if (ids.length === 0) {
    throw new Error("После --retry нужен хотя бы один идентификатор задачи");
  }
  return ids;
}

function readEventType(data: DeadLetterData | null): string {
  const type = data?.event?.type;
  return typeof type === "string" ? type : "неизвестное событие";
}

function readEntityId(data: DeadLetterData | null): string {
  const id = data?.entity?.id;
  return typeof id === "string" ? id : "—";
}

function readFailureMessage(output: DeadLetterRow["output"]): string {
  const message = output?.message;
  return typeof message === "string" ? message.slice(0, 120) : "причина не записана";
}

function formatMoment(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 19);
}
