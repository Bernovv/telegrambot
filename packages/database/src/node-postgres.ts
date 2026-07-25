import pg, { type PoolClient, type PoolConfig } from "pg";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

const { Pool } = pg;

export interface ManagedSqlConnectionPool extends SqlConnectionPool {
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface NodePostgresPoolOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly applicationName?: string;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
  readonly onIdleClientError?: (error: Error) => void;
}

export function createNodePostgresPool(options: NodePostgresPoolOptions): ManagedSqlConnectionPool {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    application_name: options.applicationName ?? "ticket-platform"
  };
  const pool = new Pool(config);

  if (options.onIdleClientError) {
    pool.on("error", options.onIdleClientError);
  }

  return new NodePostgresPool(pool);
}

export class NodePostgresPool implements ManagedSqlConnectionPool {
  constructor(private readonly pool: pg.Pool) {}

  async connect(): Promise<SqlConnection> {
    return new NodePostgresConnection(await this.pool.connect());
  }

  async ping(): Promise<void> {
    await this.pool.query("select 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class NodePostgresConnection implements SqlConnection {
  constructor(private readonly client: PoolClient) {}

  async query<TRow>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<TRow>> {
    const result = await this.client.query(text, values ? [...values] : undefined);

    return {
      rows: result.rows as readonly TRow[],
      rowCount: result.rowCount ?? result.rows.length
    };
  }

  release(): void {
    this.client.release();
  }
}
