import type { SqlConnection } from "@ticket-platform/database";

/**
 * Ищет администратора, от чьего имени пишется импорт.
 *
 * Почта в `admin_accounts` необязательна — учётку можно завести только с идентификатором
 * пользователя Supabase, и тогда искать по почте нечего. Поэтому принимаем и почту, и
 * идентификатор самой учётки, а если не нашли — показываем, кто вообще есть, вместо
 * «не найден» без подсказки.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AdminRow {
  readonly id: string;
  readonly email_normalized: string | null;
  readonly display_name: string | null;
  readonly roles: string | null;
}

export async function resolveAdminId(
  connection: SqlConnection,
  value: string
): Promise<string> {
  const admins = await connection.query<AdminRow>(
    `select
       a.id,
       a.email_normalized,
       a.display_name,
       string_agg(g.role_code, ', ' order by g.role_code) as roles
     from public.admin_accounts a
     left join public.admin_role_grants g
       on g.admin_account_id = a.id and g.revoked_at is null
     where a.status = 'active'
     group by a.id
     order by a.created_at`,
    []
  );

  const needle = value.trim().toLowerCase();
  const found = admins.rows.find((row) =>
    (UUID_PATTERN.test(needle) && row.id.toLowerCase() === needle)
    || row.email_normalized === needle);

  if (found) {
    return found.id;
  }

  const list = admins.rows.length === 0
    ? "  (активных администраторов в базе нет)"
    : admins.rows
      .map((row) => `  ${row.id}  ${row.email_normalized ?? "почта не указана"}`
        + `  ${row.display_name ?? ""}  [${row.roles ?? "без ролей"}]`)
      .join("\n");

  throw new Error(
    `Администратор «${value}» не найден.\n\n`
    + `Активные администраторы:\n${list}\n\n`
    + "Передайте в --admin почту из этого списка или идентификатор из первой колонки."
  );
}
