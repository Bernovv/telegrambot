import type {
  ChannelIdentity,
  TelegramPhoneStatus,
  TelegramPhoneStatusRepository
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

export class PostgresTelegramPhoneStatusRepository implements TelegramPhoneStatusRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async findPhoneStatus(identity: ChannelIdentity): Promise<TelegramPhoneStatus | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{ readonly phone_status: TelegramPhoneStatus }>(
        `select users.phone_status
         from public.messenger_identities identity
         join public.users on users.id = identity.user_id
         where identity.channel = $2::text
           and identity.external_user_id = $1`,
        [identity.externalUserId, identity.channel]
      );
      return result.rows[0]?.phone_status ?? null;
    } finally {
      connection.release();
    }
  }
}

export function createTelegramAccessPersistence(pool: SqlConnectionPool) {
  return {
    phoneStatusRepository: new PostgresTelegramPhoneStatusRepository(pool)
  } as const;
}
