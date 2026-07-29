import type { AdminSegmentPreviewRepository } from "@ticket-platform/application";
import type {
  AdminSegmentClassificationCondition,
  AdminSegmentConditionGroup,
  AdminSegmentExpression,
  AdminSegmentSampleUser
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface CountRow {
  readonly total_count: string;
}

interface SampleRow {
  readonly id: string;
  readonly display_name: string | null;
  readonly telegram_username: string | null;
  readonly registered_at: Date | string;
  readonly status_codes: readonly string[];
  readonly category_codes: readonly string[];
}

export class PostgresAdminSegmentPreviewRepository
implements AdminSegmentPreviewRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async findUnavailableClassificationCodes(input: {
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }): Promise<{
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }> {
    return this.read(async (connection) => {
      const statuses = input.statusCodes.length === 0
        ? []
        : (await connection.query<{ readonly code: string }>(
            `select code from public.user_statuses
             where code = any($1::text[]) and is_active = true`,
            [input.statusCodes]
          )).rows.map((row) => row.code);
      const categories = input.categoryCodes.length === 0
        ? []
        : (await connection.query<{ readonly code: string }>(
            `select code from public.user_categories
             where code = any($1::text[]) and is_active = true`,
            [input.categoryCodes]
          )).rows.map((row) => row.code);
      return {
        statusCodes: input.statusCodes.filter(
          (code) => !statuses.includes(code)
        ),
        categoryCodes: input.categoryCodes.filter(
          (code) => !categories.includes(code)
        )
      };
    });
  }

  preview(
    input: Parameters<AdminSegmentPreviewRepository["preview"]>[0]
  ): ReturnType<AdminSegmentPreviewRepository["preview"]> {
    return this.read(async (connection) => {
      const parameters: unknown[] = [];
      const expression = buildAdminSegmentSqlExpression(input, parameters);
      const count = await connection.query<CountRow>(
        `select count(*)::text as total_count
         from public.users users
         where users.is_deleted = false and (${expression})`,
        parameters
      );
      const sampleParameters = [...parameters, input.sampleLimit];
      const sample = await connection.query<SampleRow>(
        `select users.id, users.display_name,
                identity.username as telegram_username,
                users.registered_at,
                coalesce(statuses.codes, array[]::text[]) as status_codes,
                coalesce(categories.codes, array[]::text[]) as category_codes
         from public.users users
         left join lateral (
           select username
           from public.messenger_identities
           where user_id = users.id and channel = 'telegram'
           order by first_seen_at
           limit 1
         ) identity on true
         left join lateral (
           select array_agg(status_code order by status_code) as codes
           from public.user_status_assignments
           where user_id = users.id and removed_at is null
         ) statuses on true
         left join lateral (
           select array_agg(category_code order by category_code) as codes
           from public.user_category_assignments
           where user_id = users.id and removed_at is null
         ) categories on true
         where users.is_deleted = false and (${expression})
         order by users.registered_at desc, users.id desc
         limit $${sampleParameters.length}`,
        sampleParameters
      );
      return {
        totalCount: count.rows[0]?.total_count ?? "0",
        sampleUsers: sample.rows.map(mapSample)
      };
    });
  }

  private async read<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

export function createAdminSegmentPreviewPersistence(
  pool: SqlConnectionPool
): AdminSegmentPreviewRepository {
  return new PostgresAdminSegmentPreviewRepository(pool);
}

export function buildAdminSegmentSqlExpression(
  expression: AdminSegmentExpression,
  parameters: unknown[]
): string {
  return buildGroups(expression.groups, expression.operator, parameters);
}

function buildGroups(
  groups: readonly AdminSegmentConditionGroup[],
  operator: "and" | "or",
  parameters: unknown[]
): string {
  return groups
    .map((group) =>
      `(${group.conditions
        .map((condition) => buildCondition(condition, parameters))
        .join(group.operator === "and" ? " and " : " or ")})`
    )
    .join(operator === "and" ? " and " : " or ");
}

function buildCondition(
  condition: AdminSegmentClassificationCondition,
  parameters: unknown[]
): string {
  parameters.push(condition.codes);
  const parameter = `$${parameters.length}::text[]`;
  const table = condition.kind === "status"
    ? "public.user_status_assignments"
    : "public.user_category_assignments";
  const column = condition.kind === "status" ? "status_code" : "category_code";
  if (condition.mode === "all") {
    return `(select count(distinct assignment.${column})
      from ${table} assignment
      where assignment.user_id = users.id
        and assignment.removed_at is null
        and assignment.${column} = any(${parameter}))
      = cardinality(${parameter})`;
  }
  const exists = `exists (
    select 1 from ${table} assignment
    where assignment.user_id = users.id
      and assignment.removed_at is null
      and assignment.${column} = any(${parameter})
  )`;
  return condition.mode === "none" ? `not ${exists}` : exists;
}

function mapSample(row: SampleRow): AdminSegmentSampleUser {
  return {
    id: row.id,
    displayName: row.display_name,
    telegramUsername: row.telegram_username,
    registeredAt: asIso(row.registered_at),
    statusCodes: row.status_codes,
    categoryCodes: row.category_codes
  };
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Administrator segment timestamp is invalid");
  }
  return date.toISOString();
}
