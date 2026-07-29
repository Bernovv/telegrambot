import type {
  AdminOutreachRepository,
  NormalizedOutreachImportRow,
  OutreachExportRow
} from "@ticket-platform/application";
import type {
  OutreachActivity,
  OutreachCampaignContactDetail,
  OutreachCampaignContactSummary,
  OutreachCampaignSummary,
  OutreachImportResult,
  OutreachManager
} from "@ticket-platform/contracts";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface CampaignRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: OutreachCampaignSummary["status"];
  readonly total_contacts: string;
  readonly untouched_contacts: string;
  readonly interested_contacts: string;
  readonly converted_contacts: string;
  readonly created_at: Date | string;
  readonly completed_at: Date | string | null;
}

interface ContactRow {
  readonly id: string;
  readonly contact_id: string;
  readonly display_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram_username: string | null;
  readonly max_identifier: string | null;
  readonly source: string | null;
  readonly note: string | null;
  readonly linked_user_id: string | null;
  readonly assigned_admin_id: string | null;
  readonly assigned_admin_name: string | null;
  readonly current_status: OutreachCampaignContactSummary["status"];
  readonly last_activity_at: Date | string | null;
  readonly next_contact_at: Date | string | null;
  readonly last_channel: OutreachCampaignContactSummary["lastChannel"];
  readonly last_result: OutreachCampaignContactSummary["lastResult"];
  readonly total_count?: string;
}

interface ActivityRow {
  readonly id: string;
  readonly actor_admin_id: string;
  readonly actor_name: string;
  readonly channel: OutreachActivity["channel"];
  readonly result: OutreachActivity["result"];
  readonly note: string | null;
  readonly occurred_at: Date | string;
}

interface ExistingContactRow {
  readonly id: string;
}

export class PostgresAdminOutreachRepository
implements AdminOutreachRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  listCampaigns(): Promise<readonly OutreachCampaignSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<CampaignRow>(
        `${CAMPAIGN_SUMMARY_SELECT}
         group by campaign.id
         order by campaign.created_at desc, campaign.id desc
         limit 200`
      );
      return result.rows.map(mapCampaign);
    });
  }

  getCampaign(campaignId: string): Promise<OutreachCampaignSummary | null> {
    return this.read(async (connection) => {
      const result = await connection.query<CampaignRow>(
        `${CAMPAIGN_SUMMARY_SELECT}
         where campaign.id = $1
         group by campaign.id`,
        [campaignId]
      );
      return result.rows[0] ? mapCampaign(result.rows[0]) : null;
    });
  }

  async createCampaign(
    input: Parameters<AdminOutreachRepository["createCampaign"]>[0]
  ): Promise<void> {
    await this.write(async (connection) => {
      await connection.query(
        `insert into public.outreach_campaigns (
         id, name, description, status, created_by_admin_id,
           created_at, updated_at, completed_at
         ) values (
           $1::uuid, $2::text, $3::text, $4::text, $5::uuid,
           $6::timestamptz, $6::timestamptz,
           case
             when $4::text = 'completed' then $6::timestamptz
             else null::timestamptz
           end
         )`,
        [
          input.id,
          input.name,
          input.description,
          input.status,
          input.createdByAdminId,
          input.now
        ]
      );
    });
  }

  async updateCampaign(
    input: Parameters<AdminOutreachRepository["updateCampaign"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const sets = ["updated_at = $2"];
      const values: unknown[] = [input.campaignId, input.now];
      if (input.name !== undefined) {
        values.push(input.name);
        sets.push(`name = $${values.length}`);
      }
      if (input.description !== undefined) {
        values.push(input.description);
        sets.push(`description = $${values.length}`);
      }
      if (input.status !== undefined) {
        values.push(input.status);
        sets.push(`status = $${values.length}`);
        sets.push(
          `completed_at = case when $${values.length} = 'completed' then $2 else null end`
        );
      }
      const result = await connection.query(
        `update public.outreach_campaigns
         set ${sets.join(", ")}
         where id = $1`,
        values
      );
      return result.rowCount === 1;
    });
  }

  listContacts(
    input: Parameters<AdminOutreachRepository["listContacts"]>[0]
  ): Promise<Awaited<ReturnType<AdminOutreachRepository["listContacts"]>>> {
    return this.read(async (connection) => {
      const search = input.search
        ? `%${escapeLike(input.search.toLowerCase())}%`
        : null;
      const result = await connection.query<ContactRow>(
        `${CONTACT_SUMMARY_SELECT},
           count(*) over()::text as total_count
         from public.outreach_campaign_contacts campaign_contact
         join public.outreach_contacts contact
           on contact.id = campaign_contact.contact_id
         left join public.admin_accounts assignee
           on assignee.id = campaign_contact.assigned_admin_id
         left join lateral (
           select activity.channel, activity.result
           from public.outreach_activities activity
           where activity.campaign_contact_id = campaign_contact.id
           order by activity.occurred_at desc, activity.id desc
           limit 1
         ) last_activity on true
         where campaign_contact.campaign_id = $1
           and ($2::text is null or (
             coalesce(contact.display_name, '') ilike $2 escape '\\'
             or coalesce(contact.phone_e164, '') ilike $2 escape '\\'
             or coalesce(contact.telegram_username_normalized, '') ilike $2 escape '\\'
             or coalesce(contact.max_identifier_normalized, '') ilike $2 escape '\\'
           ))
           and ($3::text is null or campaign_contact.current_status = $3)
           and ($4::uuid is null or campaign_contact.assigned_admin_id = $4)
         order by
           case when campaign_contact.current_status = 'new' then 0 else 1 end,
           campaign_contact.created_at desc,
           campaign_contact.id desc
         limit $5 offset $6`,
        [
          input.campaignId,
          search,
          input.status,
          input.assignedAdminId,
          input.limit,
          (input.page - 1) * input.limit
        ]
      );
      return {
        items: result.rows.map(mapContact),
        total: Number(result.rows[0]?.total_count ?? 0),
        page: input.page,
        limit: input.limit
      };
    });
  }

  getContact(campaignContactId: string): Promise<OutreachCampaignContactDetail | null> {
    return this.read(async (connection) => {
      const summaryResult = await connection.query<ContactRow>(
        `${CONTACT_SUMMARY_SELECT}
         from public.outreach_campaign_contacts campaign_contact
         join public.outreach_contacts contact
           on contact.id = campaign_contact.contact_id
         left join public.admin_accounts assignee
           on assignee.id = campaign_contact.assigned_admin_id
         left join lateral (
           select activity.channel, activity.result
           from public.outreach_activities activity
           where activity.campaign_contact_id = campaign_contact.id
           order by activity.occurred_at desc, activity.id desc
           limit 1
         ) last_activity on true
         where campaign_contact.id = $1`,
        [campaignContactId]
      );
      const row = summaryResult.rows[0];
      if (!row) {
        return null;
      }
      const activities = await connection.query<ActivityRow>(
        `select activity.id, activity.actor_admin_id,
                coalesce(actor.display_name, actor.email_normalized, 'Менеджер') as actor_name,
                activity.channel, activity.result, activity.note, activity.occurred_at
         from public.outreach_activities activity
         join public.admin_accounts actor on actor.id = activity.actor_admin_id
         where activity.campaign_contact_id = $1
         order by activity.occurred_at desc, activity.id desc
         limit 100`,
        [campaignContactId]
      );
      return {
        ...mapContact(row),
        activities: activities.rows.map(mapActivity)
      };
    });
  }

  importContacts(
    input: Parameters<AdminOutreachRepository["importContacts"]>[0]
  ): Promise<OutreachImportResult> {
    return this.write(async (connection) => {
      const campaign = await connection.query<{ readonly id: string }>(
        `select id
         from public.outreach_campaigns
         where id = $1 and status <> 'completed'
         for update`,
        [input.campaignId]
      );
      if (!campaign.rows[0]) {
        throw new Error("Outreach campaign was not found or is completed");
      }
      let createdContacts = 0;
      let updatedContacts = 0;
      let addedToCampaign = 0;
      let alreadyInCampaign = 0;
      for (const row of input.rows) {
        const matches = await connection.query<ExistingContactRow>(
          `select id
           from public.outreach_contacts
           where ($1::text is not null and phone_e164 = $1)
              or ($2::text is not null and telegram_username_normalized = $2)
              or ($3::text is not null and max_identifier_normalized = $3)
           order by created_at
           limit 2`,
          [
            row.phoneE164,
            row.telegramUsernameNormalized,
            row.maxIdentifierNormalized
          ]
        );
        if (matches.rows.length > 1) {
          throw new Error("Outreach contact identifiers belong to different contacts");
        }
        const existing = matches.rows[0];
        const contactId = existing?.id ?? row.contactId;
        if (existing) {
          await updateContact(connection, contactId, row, input.now);
          updatedContacts += 1;
        } else {
          await insertContact(
            connection,
            contactId,
            row,
            input.createdByAdminId,
            input.now
          );
          createdContacts += 1;
        }
        const membership = await connection.query<{ readonly id: string }>(
          `insert into public.outreach_campaign_contacts (
             id, campaign_id, contact_id, assigned_admin_id, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $5)
           on conflict (campaign_id, contact_id) do nothing
           returning id`,
          [
            row.campaignContactId,
            input.campaignId,
            contactId,
            input.assignedAdminId,
            input.now
          ]
        );
        if (membership.rows[0]) {
          addedToCampaign += 1;
        } else {
          alreadyInCampaign += 1;
        }
      }
      return {
        received: input.rows.length,
        createdContacts,
        updatedContacts,
        addedToCampaign,
        alreadyInCampaign
      };
    });
  }

  assignContacts(
    input: Parameters<AdminOutreachRepository["assignContacts"]>[0]
  ): Promise<number> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_campaign_contacts
         set assigned_admin_id = $2, updated_at = $3
         where id = any($1::uuid[])`,
        [input.campaignContactIds, input.assignedAdminId, input.now]
      );
      return result.rowCount;
    });
  }

  recordActivities(
    input: Parameters<AdminOutreachRepository["recordActivities"]>[0]
  ): Promise<number> {
    return this.write(async (connection) => {
      let recorded = 0;
      for (const activity of input.activities) {
        const inserted = await connection.query<{ readonly id: string }>(
          `insert into public.outreach_activities (
             id, campaign_contact_id, contact_id, actor_admin_id,
             action, channel, result, note, batch_id, occurred_at
           )
           select $1, campaign_contact.id, campaign_contact.contact_id, $3,
                  $4, $5, $6, $7, $8, $9
           from public.outreach_campaign_contacts campaign_contact
           where campaign_contact.id = $2
           returning id`,
          [
            activity.id,
            activity.campaignContactId,
            input.actorAdminId,
            input.action,
            input.channel,
            input.result,
            input.note,
            input.batchId,
            input.occurredAt
          ]
        );
        if (!inserted.rows[0]) {
          continue;
        }
        await connection.query(
          `update public.outreach_campaign_contacts
           set current_status = $2,
               last_activity_at = $3,
               next_contact_at = $4,
               updated_at = $3
           where id = $1`,
          [
            activity.campaignContactId,
            input.result,
            input.occurredAt,
            input.nextContactAt
          ]
        );
        recorded += 1;
      }
      return recorded;
    });
  }

  listManagers(): Promise<readonly OutreachManager[]> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly id: string;
        readonly display_name: string;
      }>(
        `select distinct account.id,
                coalesce(account.display_name, account.email_normalized, 'Менеджер') as display_name
         from public.admin_accounts account
         join public.admin_role_grants grant_row
           on grant_row.admin_account_id = account.id
          and grant_row.revoked_at is null
         where account.status = 'active'
           and grant_row.role_code in ('sales_manager', 'super_admin')
         order by display_name`
      );
      return result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name
      }));
    });
  }

  exportCampaignContacts(
    campaignId: string
  ): Promise<{
    readonly campaign: OutreachCampaignSummary | null;
    readonly rows: readonly OutreachExportRow[];
  }> {
    return this.read(async (connection) => {
      const campaignResult = await connection.query<CampaignRow>(
        `${CAMPAIGN_SUMMARY_SELECT}
         where campaign.id = $1
         group by campaign.id`,
        [campaignId]
      );
      const campaign = campaignResult.rows[0]
        ? mapCampaign(campaignResult.rows[0])
        : null;
      if (!campaign) {
        return { campaign: null, rows: [] };
      }
      const result = await connection.query<ContactRow>(
        `${CONTACT_SUMMARY_SELECT}
         from public.outreach_campaign_contacts campaign_contact
         join public.outreach_contacts contact
           on contact.id = campaign_contact.contact_id
         left join public.admin_accounts assignee
           on assignee.id = campaign_contact.assigned_admin_id
         left join lateral (
           select activity.channel, activity.result
           from public.outreach_activities activity
           where activity.campaign_contact_id = campaign_contact.id
           order by activity.occurred_at desc, activity.id desc
           limit 1
         ) last_activity on true
         where campaign_contact.campaign_id = $1
         order by contact.display_name nulls last, contact.phone_e164`,
        [campaignId]
      );
      return {
        campaign,
        rows: result.rows.map((row) => ({
          displayName: row.display_name,
          phone: row.phone_e164,
          telegramUsername: row.telegram_username,
          maxIdentifier: row.max_identifier,
          source: row.source,
          assignedAdminName: row.assigned_admin_name,
          status: row.current_status,
          lastChannel: row.last_channel,
          lastActivityAt: nullableIso(row.last_activity_at),
          nextContactAt: nullableIso(row.next_contact_at),
          linkedUserId: row.linked_user_id,
          note: row.note
        }))
      };
    });
  }

  private async read<T>(
    work: (connection: SqlConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      const result = await work(connection);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async write<T>(
    work: (connection: SqlConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      const result = await work(connection);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function createAdminOutreachPersistence(
  pool: SqlConnectionPool
): AdminOutreachRepository {
  return new PostgresAdminOutreachRepository(pool);
}

async function insertContact(
  connection: SqlConnection,
  contactId: string,
  row: NormalizedOutreachImportRow,
  createdByAdminId: string,
  now: Date
): Promise<void> {
  await connection.query(
    `insert into public.outreach_contacts (
       id, linked_user_id, display_name, phone_e164,
       telegram_username, telegram_username_normalized,
       max_identifier, max_identifier_normalized,
       source, note, created_by_admin_id, created_at, updated_at
     ) values (
       $1,
       (
         select user_contact.user_id
         from public.user_contacts user_contact
         where user_contact.contact_type = 'phone'
           and user_contact.verification_status in ('imported', 'verified')
           and user_contact.value_normalized = $3
         order by user_contact.is_primary desc, user_contact.created_at
         limit 1
       ),
       $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11
     )`,
    [
      contactId,
      row.displayName,
      row.phoneE164,
      row.telegramUsername,
      row.telegramUsernameNormalized,
      row.maxIdentifier,
      row.maxIdentifierNormalized,
      row.source,
      row.note,
      createdByAdminId,
      now
    ]
  );
}

async function updateContact(
  connection: SqlConnection,
  contactId: string,
  row: NormalizedOutreachImportRow,
  now: Date
): Promise<void> {
  await connection.query(
    `update public.outreach_contacts
     set display_name = coalesce($2, display_name),
         phone_e164 = coalesce($3, phone_e164),
         telegram_username = coalesce($4, telegram_username),
         telegram_username_normalized = coalesce($5, telegram_username_normalized),
         max_identifier = coalesce($6, max_identifier),
         max_identifier_normalized = coalesce($7, max_identifier_normalized),
         source = coalesce($8, source),
         note = coalesce($9, note),
         linked_user_id = coalesce(
           linked_user_id,
           (
             select user_contact.user_id
             from public.user_contacts user_contact
             where user_contact.contact_type = 'phone'
               and user_contact.verification_status in ('imported', 'verified')
               and user_contact.value_normalized = $3
             order by user_contact.is_primary desc, user_contact.created_at
             limit 1
           )
         ),
         updated_at = $10
     where id = $1`,
    [
      contactId,
      row.displayName,
      row.phoneE164,
      row.telegramUsername,
      row.telegramUsernameNormalized,
      row.maxIdentifier,
      row.maxIdentifierNormalized,
      row.source,
      row.note,
      now
    ]
  );
}

function mapCampaign(row: CampaignRow): OutreachCampaignSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    totalContacts: Number(row.total_contacts),
    untouchedContacts: Number(row.untouched_contacts),
    interestedContacts: Number(row.interested_contacts),
    convertedContacts: Number(row.converted_contacts),
    createdAt: toIso(row.created_at),
    completedAt: nullableIso(row.completed_at)
  };
}

function mapContact(row: ContactRow): OutreachCampaignContactSummary {
  return {
    id: row.id,
    contactId: row.contact_id,
    displayName: row.display_name,
    phone: row.phone_e164,
    telegramUsername: row.telegram_username,
    maxIdentifier: row.max_identifier,
    source: row.source,
    note: row.note,
    linkedUserId: row.linked_user_id,
    assignedAdminId: row.assigned_admin_id,
    assignedAdminName: row.assigned_admin_name,
    status: row.current_status,
    lastActivityAt: nullableIso(row.last_activity_at),
    nextContactAt: nullableIso(row.next_contact_at),
    lastChannel: row.last_channel,
    lastResult: row.last_result
  };
}

function mapActivity(row: ActivityRow): OutreachActivity {
  return {
    id: row.id,
    actorAdminId: row.actor_admin_id,
    actorName: row.actor_name,
    channel: row.channel,
    result: row.result,
    note: row.note,
    occurredAt: toIso(row.occurred_at)
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

const CAMPAIGN_SUMMARY_SELECT = `
  select campaign.id, campaign.name, campaign.description, campaign.status,
         count(campaign_contact.id)::text as total_contacts,
         count(campaign_contact.id) filter (
           where campaign_contact.current_status = 'new'
         )::text as untouched_contacts,
         count(campaign_contact.id) filter (
           where campaign_contact.current_status = 'interested'
         )::text as interested_contacts,
         count(campaign_contact.id) filter (
           where campaign_contact.current_status = 'converted'
         )::text as converted_contacts,
         campaign.created_at, campaign.completed_at
  from public.outreach_campaigns campaign
  left join public.outreach_campaign_contacts campaign_contact
    on campaign_contact.campaign_id = campaign.id`;

const CONTACT_SUMMARY_SELECT = `
  select campaign_contact.id, contact.id as contact_id,
         contact.display_name, contact.phone_e164,
         contact.telegram_username, contact.max_identifier,
         contact.source, contact.note, contact.linked_user_id,
         campaign_contact.assigned_admin_id,
         coalesce(assignee.display_name, assignee.email_normalized) as assigned_admin_name,
         campaign_contact.current_status,
         campaign_contact.last_activity_at,
         campaign_contact.next_contact_at,
         last_activity.channel as last_channel,
         last_activity.result as last_result`;
