// Сколько места занимает переписка и что из вложений не доехало.
//
// Решение владельца от 23.08.2026: файлы храним у себя, пока вечно, и смотрим за расходом
// места. Смотреть — вот этим:
//
//   pnpm conversations:files
//
// Показывает по месяцам: сколько вложений скачано и сколько это байт, — и отдельно то, что
// требует руки: строки со статусом `failed`. Причина у них видна прямо здесь; чаще всего
// это истёкший путь у Telegram, и такой файл уже не вернуть — но знать об этом лучше в тот
// же месяц, а не через год по пустому окну диалога.
//
// Место на диске считается по тому, что записано в базу. Разойтись с настоящей папкой это
// может ровно в одну сторону — если файлы удаляли руками, — поэтому рядом печатается и
// команда, которой смотрят диск.

import { loadWorkerConfig } from "@ticket-platform/config";
import { createNodePostgresPool } from "@ticket-platform/database";

interface MonthRow {
  readonly month: string;
  readonly stored: string;
  readonly bytes: string | null;
}

interface StatusRow {
  readonly download_status: string;
  readonly count: string;
}

interface FailureRow {
  readonly kind: string;
  readonly failure_reason: string | null;
  readonly count: string;
}

async function main(): Promise<void> {
  const config = loadWorkerConfig(process.env);
  const pool = createNodePostgresPool({ connectionString: config.databaseUrl });
  const connection = await pool.connect();

  try {
    const months = await connection.query<MonthRow>(
      `select to_char(downloaded_at, 'YYYY-MM') as month,
              count(*)::text as stored,
              sum(size_bytes)::text as bytes
         from public.conversation_attachments
        where download_status = 'stored'
        group by 1
        order by 1 desc
        limit 24`
    );

    console.log("Вложения переписки на диске\n");
    if (months.rows.length === 0) {
      console.log("  пока ничего не скачано");
    } else {
      let total = 0;
      for (const row of months.rows) {
        const bytes = Number(row.bytes ?? "0");
        total += bytes;
        console.log(
          `  ${row.month}  ${row.stored.padStart(6)} шт  ${human(bytes).padStart(10)}`
        );
      }
      console.log(`  ${"всего".padEnd(7)} ${String(total > 0 ? human(total) : "0 Б").padStart(20)}`);
    }

    const statuses = await connection.query<StatusRow>(
      `select download_status, count(*)::text as count
         from public.conversation_attachments
        group by 1
        order by 1`
    );
    console.log("\nПо состояниям:");
    for (const row of statuses.rows) {
      console.log(`  ${row.download_status.padEnd(9)} ${row.count.padStart(6)}`);
    }

    const failures = await connection.query<FailureRow>(
      `select kind, failure_reason, count(*)::text as count
         from public.conversation_attachments
        where download_status = 'failed'
        group by 1, 2
        order by count(*) desc
        limit 20`
    );
    if (failures.rows.length > 0) {
      console.log("\nНе скачалось — эти файлы забирают руками, пока они живы у мессенджера:");
      for (const row of failures.rows) {
        console.log(
          `  ${row.count.padStart(4)} × ${row.kind}: ${row.failure_reason ?? "без причины"}`
        );
      }
    }

    console.log(
      `\nПапка на диске: ${config.conversationAttachments.enabled
        ? config.conversationAttachments.directory
        : "не задана — скачивание выключено"}`
    );
    if (config.conversationAttachments.enabled) {
      console.log(`Место на диске: du -sh ${config.conversationAttachments.directory}`);
    }
  } finally {
    connection.release();
    await pool.close();
  }
}

function human(bytes: number): string {
  if (bytes < 1_024) {
    return `${String(bytes)} Б`;
  }
  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes / 1_024;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "КБ"}`;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
