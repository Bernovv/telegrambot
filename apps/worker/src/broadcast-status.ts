// Показывает состояние рассылок и закрывает те, что зависли в статусе sending.
//
// Зачем это нужно. Кампания переходит в sending, когда воркер начал её разворачивать, и в
// completed — когда прошёл список до конца. Если задача до конца так и не дошла и очередь
// сдала её в мёртвые письма, строка остаётся в sending навсегда: sent_count и failed_count в
// ней недостоверны, а в панели такая рассылка выглядит вечно идущей. Ровно так выглядят
// кампании, запущенные до того, как отправка научилась переживать ошибку одного получателя.
//
//   pnpm broadcast:status                — что с рассылками, где застряло
//   pnpm broadcast:status --close <id>   — закрыть зависшую по реальным данным журнала
//
// Счётчики при закрытии берутся не с потолка, а из notification_deliveries — журнала, куда
// отправка пишет каждое сообщение. Он же остаётся источником правды о том, кому ушло.

import { loadWorkerConfig } from "@ticket-platform/config";
import { createNodePostgresPool } from "@ticket-platform/database";
import { OUTBOX_DISPATCH_QUEUE } from "./pgboss.js";

interface BroadcastRow {
  readonly id: string;
  readonly status: string;
  readonly is_test: boolean;
  readonly created_at: Date;
  readonly started_at: Date | null;
  readonly sent_count: number;
  readonly failed_count: number;
  readonly message_text: string;
}

interface LedgerCountsRow {
  readonly sent: string;
  readonly failed: string;
}

interface QueueStateRow {
  readonly state: string;
}

const STUCK_AFTER_MINUTES = 30;

const config = loadWorkerConfig(process.env);
const pool = createNodePostgresPool({
  connectionString: config.databaseUrl,
  maxConnections: 1,
  applicationName: "ticket-platform-broadcast-status"
});

try {
  const requestedId = readRequestedId(process.argv.slice(2));
  const broadcasts = await readRecentBroadcasts();

  if (requestedId === null) {
    await report(broadcasts);
  } else {
    await close(requestedId, broadcasts);
  }
} finally {
  await pool.close();
}

async function report(broadcasts: readonly BroadcastRow[]): Promise<void> {
  if (broadcasts.length === 0) {
    console.log("Рассылок пока не было.");
    return;
  }

  const stuck: BroadcastRow[] = [];
  for (const broadcast of broadcasts) {
    const ledger = await readLedgerCounts(broadcast.id);
    const isStuck = broadcast.status === "sending" && minutesSince(broadcast.started_at) > STUCK_AFTER_MINUTES;
    if (isStuck) {
      stuck.push(broadcast);
    }
    console.log([
      broadcast.id,
      formatMoment(broadcast.created_at),
      (broadcast.is_test ? "проба/" : "") + broadcast.status + (isStuck ? " (зависла)" : ""),
      `в базе ${broadcast.sent_count}/${broadcast.failed_count}`,
      `в журнале ${ledger.sent}/${ledger.failed}`,
      truncate(broadcast.message_text)
    ].join("  |  "));
  }
  console.log("\nСчётчики: отправлено/не доставлено. Журнал — это notification_deliveries.");

  if (stuck.length > 0) {
    console.log(
      `\nЗависших рассылок: ${stuck.length}.`
      + " Сначала посмотрите pnpm queue:dead-letter — если задача ещё жива, её лучше вернуть"
      + " в работу, а не закрывать кампанию."
    );
    for (const broadcast of stuck) {
      console.log(`  pnpm broadcast:status --close ${broadcast.id}`);
    }
  }
}

async function close(
  broadcastId: string,
  broadcasts: readonly BroadcastRow[]
): Promise<void> {
  const broadcast = broadcasts.find((candidate) => candidate.id === broadcastId);
  if (!broadcast) {
    throw new Error(`Рассылка ${broadcastId} среди последних не найдена`);
  }
  if (broadcast.status !== "sending") {
    throw new Error(`Рассылка ${broadcastId} в статусе ${broadcast.status} — закрывать нечего`);
  }

  // Пока задача жива в очереди, воркер может дописывать в неё прямо сейчас: закрыть её
  // означает разойтись с реальностью и потерять хвост отправки.
  const active = await readActiveQueueStates(broadcastId);
  if (active.length > 0) {
    throw new Error(
      `Задача рассылки ${broadcastId} ещё в очереди (${active.join(", ")}).`
      + " Дождитесь её завершения или разберитесь с очередью."
    );
  }

  const ledger = await readLedgerCounts(broadcastId);
  const sent = Number(ledger.sent);
  const failed = Number(ledger.failed);
  // Ни одного доставленного — это не «завершилась», это «не состоялась».
  const status = sent > 0 ? "completed" : "cancelled";

  const connection = await pool.connect();
  try {
    const result = await connection.query(
      `update public.admin_broadcasts
       set status = $2,
           sent_count = $3,
           failed_count = $4,
           recipient_count = $3 + $4,
           completed_at = now()
       where id = $1 and status = 'sending'`,
      [broadcastId, status, sent, failed]
    );
    if (result.rowCount === 0) {
      throw new Error(`Рассылка ${broadcastId} уже не в статусе sending — ничего не менял`);
    }
  } finally {
    connection.release();
  }

  console.log(
    `Рассылка ${broadcastId} закрыта как ${status}: отправлено ${sent}, не доставлено ${failed}.`
  );
  if (status === "cancelled") {
    console.log("Ни одного сообщения не ушло — при необходимости создайте рассылку заново.");
  }
}

async function readRecentBroadcasts(): Promise<readonly BroadcastRow[]> {
  const connection = await pool.connect();
  try {
    const result = await connection.query<BroadcastRow>(
      `select id, status, is_test, created_at, started_at, sent_count, failed_count, message_text
       from public.admin_broadcasts
       order by created_at desc
       limit 50`
    );
    return result.rows;
  } finally {
    connection.release();
  }
}

async function readLedgerCounts(broadcastId: string): Promise<LedgerCountsRow> {
  const connection = await pool.connect();
  try {
    const result = await connection.query<LedgerCountsRow>(
      `select
         count(*) filter (where status = 'sent')::text as sent,
         count(*) filter (where status <> 'sent')::text as failed
       from public.notification_deliveries
       where kind = 'admin_broadcast' and aggregate_id = $1`,
      [broadcastId]
    );
    return result.rows[0] ?? { sent: "0", failed: "0" };
  } finally {
    connection.release();
  }
}

async function readActiveQueueStates(broadcastId: string): Promise<readonly string[]> {
  const connection = await pool.connect();
  try {
    const result = await connection.query<QueueStateRow>(
      `select distinct state
       from pgboss.job
       where name = $1
         and state in ('created', 'active', 'retry')
         and data -> 'event' ->> 'type' = 'AdminBroadcastRequested'
         and data -> 'entity' ->> 'id' = $2`,
      [OUTBOX_DISPATCH_QUEUE, broadcastId]
    );
    return result.rows.map((row) => row.state);
  } finally {
    connection.release();
  }
}

function readRequestedId(argv: readonly string[]): string | null {
  const index = argv.indexOf("--close");
  if (index === -1) {
    return null;
  }
  const id = argv[index + 1];
  if (!id || id.startsWith("--")) {
    throw new Error("После --close нужен идентификатор рассылки");
  }
  return id;
}

function minutesSince(value: Date | null): number {
  return value === null
    ? Number.POSITIVE_INFINITY
    : (Date.now() - value.getTime()) / 60_000;
}

function truncate(text: string): string {
  return text.length > 50 ? `${text.slice(0, 50)}...` : text;
}

function formatMoment(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 19);
}
