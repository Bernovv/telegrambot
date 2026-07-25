import { AsyncLocalStorage } from "node:async_hooks";
import type { UnitOfWork } from "@ticket-platform/application";

export interface SqlQueryResult<TRow> {
  readonly rows: readonly TRow[];
  readonly rowCount: number;
}

export interface SqlExecutor {
  query<TRow>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<TRow>>;
}

export interface SqlConnection extends SqlExecutor {
  release(): void;
}

export interface SqlConnectionPool {
  connect(): Promise<SqlConnection>;
}

export class TransactionSession {
  private readonly storage = new AsyncLocalStorage<SqlExecutor>();

  get isActive(): boolean {
    return this.storage.getStore() !== undefined;
  }

  query<TRow>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<TRow>> {
    const executor = this.storage.getStore();

    if (!executor) {
      throw new Error("Database operation requires an active transaction");
    }

    return executor.query<TRow>(text, values);
  }

  run<T>(executor: SqlExecutor, work: () => Promise<T>): Promise<T> {
    return this.storage.run(executor, work);
  }
}

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(
    private readonly pool: SqlConnectionPool,
    private readonly session: TransactionSession
  ) {}

  async transact<T>(work: () => Promise<T>): Promise<T> {
    if (this.session.isActive) {
      return work();
    }

    const connection = await this.pool.connect();

    try {
      await connection.query("begin");

      return await this.session.run(connection, async () => {
        try {
          const result = await work();
          await connection.query("commit");
          return result;
        } catch (error) {
          await connection.query("rollback");
          throw error;
        }
      });
    } finally {
      connection.release();
    }
  }
}
