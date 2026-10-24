import type {
  AdminEventGreetingRepository,
  GreetingEventRow,
  StoredEventGreeting
} from "@ticket-platform/application";
import type { EventGreetingStats } from "@ticket-platform/contracts";
import type { SqlConnectionPool } from "./postgres.js";

/** Настройки приветствия мероприятия: строка `event_greetings` и итоги по заявкам. */
export class PostgresAdminEventGreetingRepository implements AdminEventGreetingRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async findEvent(eventId: string): Promise<GreetingEventRow | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        readonly id: string;
        readonly title: string;
        readonly starts_at: Date | string;
        readonly timezone: string;
        readonly location_name: string | null;
        readonly location_address: string | null;
      }>(
        `select id, title, starts_at, timezone, location_name, location_address
           from public.events
          where id = $1::uuid`,
        [eventId]
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            title: row.title,
            startsAt: new Date(row.starts_at),
            timeZone: row.timezone,
            locationName: row.location_name,
            locationAddress: row.location_address
          }
        : null;
    } finally {
      connection.release();
    }
  }

  async loadSettings(eventId: string): Promise<StoredEventGreeting | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        readonly is_enabled: boolean;
        readonly event_phrase: string | null;
        readonly body_template: string | null;
        readonly updated_at: Date | string;
        readonly updated_by_name: string | null;
      }>(
        `select settings.is_enabled, settings.event_phrase, settings.body_template,
                settings.updated_at,
                coalesce(author.display_name, author.email_normalized) as updated_by_name
           from public.event_greetings settings
           left join public.admin_accounts author
             on author.id = settings.updated_by_admin_id
          where settings.event_id = $1::uuid`,
        [eventId]
      );
      const row = result.rows[0];
      return row
        ? {
            isEnabled: row.is_enabled,
            eventPhrase: row.event_phrase,
            bodyTemplate: row.body_template,
            updatedAt: new Date(row.updated_at),
            updatedByName: row.updated_by_name
          }
        : null;
    } finally {
      connection.release();
    }
  }

  async countGreetings(eventId: string): Promise<EventGreetingStats> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        readonly pending: string;
        readonly queued: string;
        readonly no_channel: string;
        readonly skipped: string;
      }>(
        `select count(*) filter (where status = 'pending')::text as pending,
                count(*) filter (where status = 'queued')::text as queued,
                count(*) filter (where status = 'no_channel')::text as no_channel,
                count(*) filter (where status = 'skipped')::text as skipped
           from public.registration_greetings
          where event_id = $1::uuid`,
        [eventId]
      );
      const row = result.rows[0];
      return {
        pending: Number(row?.pending ?? 0),
        queued: Number(row?.queued ?? 0),
        noChannel: Number(row?.no_channel ?? 0),
        skipped: Number(row?.skipped ?? 0)
      };
    } finally {
      connection.release();
    }
  }

  async hasPermission(adminId: string, permission: string): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{ readonly granted: boolean }>(
        `select exists (
           select 1
             from public.admin_role_grants g
             join public.admin_role_permissions rp on rp.role_code = g.role_code
            where g.admin_account_id = $1::uuid
              and g.revoked_at is null
              and rp.permission_code = $2::text
         ) as granted`,
        [adminId, permission]
      );
      return result.rows[0]?.granted === true;
    } finally {
      connection.release();
    }
  }

  async saveSettings(input: {
    readonly eventId: string;
    readonly isEnabled: boolean;
    readonly eventPhrase: string | null;
    readonly bodyTemplate: string | null;
    readonly adminId: string;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `insert into public.event_greetings (
           event_id, is_enabled, event_phrase, body_template,
           updated_by_admin_id, created_at, updated_at
         ) values (
           $1::uuid, $2::boolean, $3::text, $4::text,
           $5::uuid, $6::timestamptz, $6::timestamptz
         )
         on conflict (event_id) do update
            set is_enabled = excluded.is_enabled,
                event_phrase = excluded.event_phrase,
                body_template = excluded.body_template,
                updated_by_admin_id = excluded.updated_by_admin_id,
                updated_at = excluded.updated_at`,
        [
          input.eventId,
          input.isEnabled,
          input.eventPhrase,
          input.bodyTemplate,
          input.adminId,
          input.at
        ]
      );
    } finally {
      connection.release();
    }
  }
}

export function createAdminEventGreetingPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminEventGreetingRepository;
} {
  return { repository: new PostgresAdminEventGreetingRepository(pool) };
}
