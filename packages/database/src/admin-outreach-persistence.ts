import type {
  AdminOutreachRepository,
  NormalizedOutreachImportRow,
  OutreachExportRow,
  OutreachImportCounts
} from "@ticket-platform/application";
import type {
  OutreachActivity,
  OutreachCampaignContactDetail,
  OutreachCampaignContactSummary,
  OutreachCampaignSummary,
  OutreachCustomFieldDefinition,
  OutreachCustomFieldType,
  OutreachCustomFieldValue,
  AddExistingContactsResult,
  MoveOutreachContactsResult,
  OutreachBaseContact,
  OutreachImportRow,
  OutreachManager,
  OutreachPerson,
  OutreachPersonCard,
  OutreachPipelineColumn,
  OutreachPipelineColumnOutcome,
  OutreachStageHistoryEntry,
  OutreachTask,
  OutreachTaskBoardItem
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
  readonly event_id: string | null;
  readonly event_title: string | null;
  readonly archived_at: Date | string | null;
}

interface BaseContactRow {
  readonly contact_id: string;
  readonly display_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram_username: string | null;
  readonly max_identifier: string | null;
  readonly source: string | null;
  readonly in_campaign: boolean;
  readonly campaign_count: string;
}

interface ParticipationRow {
  readonly participant_id: string;
  readonly event_id: string;
  readonly event_title: string;
  readonly adults: number;
  readonly children: number;
  readonly sleeping_places: number;
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
  readonly pipeline_stage: OutreachCampaignContactSummary["stage"];
  readonly lost_reason: OutreachCampaignContactSummary["lostReason"];
  readonly current_status: OutreachCampaignContactSummary["status"];
  readonly last_activity_at: Date | string | null;
  readonly next_contact_at: Date | string | null;
  readonly last_channel: OutreachCampaignContactSummary["lastChannel"];
  readonly last_result: OutreachCampaignContactSummary["lastResult"];
  readonly open_task_id: string | null;
  readonly open_task_assigned_admin_id: string | null;
  readonly open_task_assigned_admin_name: string | null;
  readonly open_task_created_by_admin_id: string | null;
  readonly open_task_created_by_admin_name: string | null;
  readonly open_task_type: OutreachTask["type"] | null;
  readonly open_task_text: string | null;
  readonly open_task_due_at: Date | string | null;
  readonly open_task_created_at: Date | string | null;
  readonly custom_fields: readonly CustomFieldJsonRow[] | null;
  readonly total_count?: string;
}

interface CustomFieldJsonRow {
  readonly field_id: string;
  readonly key: string;
  readonly label: string;
  readonly field_type: OutreachCustomFieldType;
  readonly options: readonly string[] | null;
  readonly value: string | null;
}

interface CustomFieldDefinitionRow {
  readonly id: string;
  readonly campaign_id: string | null;
  readonly field_key: string;
  readonly label: string;
  readonly field_type: OutreachCustomFieldType;
  readonly options: readonly string[] | null;
  readonly position: number;
}

interface TaskBoardRow {
  readonly id: string;
  readonly campaign_contact_id: string;
  readonly campaign_id: string;
  readonly campaign_name: string;
  readonly contact_name: string | null;
  readonly contact_phone: string | null;
  readonly assigned_admin_id: string;
  readonly assigned_admin_name: string;
  readonly task_type: OutreachTask["type"];
  readonly task_text: string;
  readonly due_at: Date | string;
  readonly status: OutreachTask["status"];
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

interface PersonRow {
  readonly contact_id: string;
  readonly display_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram_username: string | null;
  readonly max_identifier: string | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly linked_user_id: string | null;
  readonly archived_at: Date | string | null;
  readonly created_at: Date | string;
  readonly campaign_count: string | null;
  readonly last_activity_at: Date | string | null;
  readonly total_count: string;
}

interface PersonCardRow {
  readonly contact_id: string;
  readonly display_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram_username: string | null;
  readonly max_identifier: string | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly note: string | null;
  readonly linked_user_id: string | null;
  readonly archived_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface PersonCampaignRow {
  readonly campaign_contact_id: string;
  readonly campaign_id: string;
  readonly campaign_name: string;
  readonly pipeline_stage: string;
  readonly stage_label: string;
  readonly assigned_admin_name: string | null;
  readonly removed_at: Date | string | null;
}

interface PersonActivityRow extends ActivityRow {
  readonly campaign_id: string;
  readonly campaign_name: string;
}

interface ExistingContactRow {
  readonly id: string;
}

interface PipelineColumnRow {
  readonly stage: OutreachPipelineColumn["stage"];
  readonly label: string;
  readonly position: number;
  readonly outcome: OutreachPipelineColumnOutcome;
}

interface TaskRow {
  readonly id: string;
  readonly assigned_admin_id: string;
  readonly assigned_admin_name: string;
  readonly created_by_admin_id: string;
  readonly created_by_admin_name: string;
  readonly completed_by_admin_id: string | null;
  readonly completed_by_admin_name: string | null;
  readonly task_type: OutreachTask["type"];
  readonly task_text: string;
  readonly due_at: Date | string;
  readonly status: OutreachTask["status"];
  readonly created_at: Date | string;
  readonly completed_at: Date | string | null;
}

interface StageHistoryRow {
  readonly id: string;
  readonly actor_admin_id: string | null;
  readonly actor_name: string;
  readonly from_stage: OutreachStageHistoryEntry["fromStage"];
  readonly to_stage: OutreachStageHistoryEntry["toStage"];
  readonly lost_reason: OutreachStageHistoryEntry["lostReason"];
  readonly occurred_at: Date | string;
}

export class PostgresAdminOutreachRepository
implements AdminOutreachRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  listCampaigns(includeArchived: boolean): Promise<readonly OutreachCampaignSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<CampaignRow>(
        `${CAMPAIGN_SUMMARY_SELECT}
         where $1::boolean or campaign.archived_at is null
         group by campaign.id, event.title
         order by campaign.created_at desc, campaign.id desc
         limit 200`,
        [includeArchived]
      );
      return result.rows.map(mapCampaign);
    });
  }

  getCampaign(campaignId: string): Promise<OutreachCampaignSummary | null> {
    return this.read(async (connection) => {
      const result = await connection.query<CampaignRow>(
        `${CAMPAIGN_SUMMARY_SELECT}
         where campaign.id = $1
         group by campaign.id, event.title`,
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
           created_at, updated_at, completed_at, event_id
         ) values (
           $1::uuid, $2::text, $3::text, $4::text, $5::uuid,
           $6::timestamptz, $6::timestamptz,
           case
             when $4::text = 'completed' then $6::timestamptz
             else null::timestamptz
           end,
           $7::uuid
         )`,
        [
          input.id,
          input.name,
          input.description,
          input.status,
          input.createdByAdminId,
          input.now,
          input.eventId
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
      if (input.eventId !== undefined) {
        values.push(input.eventId);
        sets.push(`event_id = $${values.length}::uuid`);
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

  /**
   * Участники мероприятия строками для импорта: покупатели из оплаченных заказов и те,
   * кого завели руками. Телефон и ник берём те же, что показываем в расселении.
   */
  listEventParticipantRows(eventId: string): Promise<readonly OutreachImportRow[]> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly name: string | null;
        readonly phone: string | null;
        readonly telegram: string | null;
        readonly source: string;
      }>(
        `select
           nullif(btrim(u.display_name), '') as name,
           contact.value_normalized as phone,
           identity.username as telegram,
           'Мероприятие' as source
         from public.orders o
         join public.users u on u.id = o.user_id
         left join lateral (
           select username
           from public.messenger_identities
           where user_id = o.user_id and username is not null
           order by last_seen_at desc, id
           limit 1
         ) identity on true
         left join lateral (
           select value_normalized
           from public.user_contacts
           where user_id = o.user_id and contact_type = 'phone'
           order by is_primary desc, created_at
           limit 1
         ) contact on true
         where o.event_id = $1::uuid
           and o.status = 'paid'
           and o.excluded_at is null
         union
         select
           nullif(btrim(p.display_name), '') as name,
           p.phone_e164 as phone,
           null as telegram,
           'Мероприятие' as source
         from public.event_participants p
         where p.event_id = $1::uuid
           and p.deleted_at is null`,
        [eventId]
      );

      // Без телефона и ника контакт завести нельзя — база их и различает.
      return result.rows
        .filter((row) => row.phone !== null || row.telegram !== null)
        .map((row) => ({
          ...(row.name === null ? {} : { name: row.name }),
          ...(row.phone === null ? {} : { phone: row.phone }),
          ...(row.telegram === null ? {} : { telegram: row.telegram }),
          source: row.source
        }));
    });
  }

  /**
   * Контакты общей базы. Архивированные не показываем: их убрали намеренно.
   * `in_campaign` считаем здесь же, чтобы панель могла показать уже добавленных серым,
   * а не делать вид, что их нет.
   */
  listBaseContacts(input: {
    readonly campaignId: string;
    readonly search: string | null;
    readonly onlyMissing: boolean;
    readonly limit: number;
  }): Promise<readonly OutreachBaseContact[]> {
    return this.read(async (connection) => {
      const result = await connection.query<BaseContactRow>(
        `select
           contact.id as contact_id,
           contact.display_name,
           contact.phone_e164,
           contact.telegram_username,
           contact.max_identifier,
           contact.source,
           (member.id is not null) as in_campaign,
           (
             select count(*)::text
             from public.outreach_campaign_contacts other
             where other.contact_id = contact.id
               and other.removed_at is null
           ) as campaign_count
         from public.outreach_contacts contact
         left join public.outreach_campaign_contacts member
           on member.contact_id = contact.id
          and member.campaign_id = $1::uuid
          and member.removed_at is null
         where contact.archived_at is null
           and ($4::boolean is false or member.id is null)
           and (
             $2::text is null
             or coalesce(contact.display_name, '') ilike $2 escape '\\'
             or coalesce(contact.phone_e164, '') ilike $2 escape '\\'
             or coalesce(contact.telegram_username, '') ilike $2 escape '\\'
             or coalesce(contact.max_identifier, '') ilike $2 escape '\\'
           )
         order by contact.display_name nulls last, contact.created_at desc
         limit $3`,
        [
          input.campaignId,
          input.search ? `%${escapeLike(input.search.toLowerCase())}%` : null,
          input.limit,
          input.onlyMissing
        ]
      );

      return result.rows.map((row) => ({
        contactId: row.contact_id,
        displayName: row.display_name,
        phone: row.phone_e164,
        telegramUsername: row.telegram_username,
        maxIdentifier: row.max_identifier,
        source: row.source,
        inCampaign: row.in_campaign,
        campaignCount: Number(row.campaign_count)
      }));
    });
  }

  async addExistingContacts(input: {
    readonly campaignId: string;
    readonly contacts: readonly {
      readonly contactId: string;
      readonly campaignContactId: string;
    }[];
    readonly assignedAdminId: string;
    readonly now: Date;
  }): Promise<AddExistingContactsResult> {
    return this.write(async (connection) => {
      const campaign = await connection.query<{ readonly id: string }>(
        `select id from public.outreach_campaigns
          where id = $1::uuid and status <> 'completed'
          for update`,
        [input.campaignId]
      );
      if (!campaign.rows[0]) {
        throw new Error("Outreach campaign was not found or is completed");
      }

      const result = await connection.query(
        `insert into public.outreach_campaign_contacts (
           id, campaign_id, contact_id, assigned_admin_id, created_at, updated_at
         )
         select
           entry.campaign_contact_id::uuid,
           $1::uuid,
           entry.contact_id::uuid,
           $2::uuid,
           $3::timestamptz,
           $3::timestamptz
         from jsonb_to_recordset($4::jsonb)
           as entry(contact_id text, campaign_contact_id text)
         join public.outreach_contacts contact
           on contact.id = entry.contact_id::uuid
          and contact.archived_at is null
         on conflict (campaign_id, contact_id) do update
           set removed_at = null,
               removed_by_admin_id = null,
               updated_at = excluded.updated_at
         where public.outreach_campaign_contacts.removed_at is not null`,
        [
          input.campaignId,
          input.assignedAdminId,
          input.now.toISOString(),
          JSON.stringify(input.contacts.map((entry) => ({
            contact_id: entry.contactId,
            campaign_contact_id: entry.campaignContactId
          })))
        ]
      );

      return {
        added: result.rowCount,
        alreadyInCampaign: input.contacts.length - result.rowCount
      };
    });
  }

  async archiveCampaign(input: {
    readonly campaignId: string;
    readonly adminId: string;
    readonly at: Date;
  }): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_campaigns
            set archived_at = $2::timestamptz,
                archived_by_admin_id = $3::uuid,
                updated_at = $2::timestamptz
          where id = $1::uuid and archived_at is null`,
        [input.campaignId, input.at.toISOString(), input.adminId]
      );
      return result.rowCount > 0;
    });
  }

  async restoreCampaign(campaignId: string): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_campaigns
            set archived_at = null,
                archived_by_admin_id = null,
                updated_at = now()
          where id = $1::uuid and archived_at is not null`,
        [campaignId]
      );
      return result.rowCount > 0;
    });
  }

  /**
   * Мягко убирает контакты из кампании. Звонки, сообщения, задачи и история стадий
   * привязаны к строке участия — удалить её значит потерять их, а именно они отвечают
   * на вопрос «что человеку уже говорили».
   */
  async removeContacts(input: {
    readonly campaignId: string;
    readonly campaignContactIds: readonly string[];
    readonly adminId: string;
    readonly now: Date;
  }): Promise<number> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_campaign_contacts
            set removed_at = $3::timestamptz,
                removed_by_admin_id = $4::uuid,
                updated_at = $3::timestamptz
          where id = any($1::uuid[])
            and campaign_id = $2::uuid
            and removed_at is null`,
        [
          [...input.campaignContactIds],
          input.campaignId,
          input.now.toISOString(),
          input.adminId
        ]
      );
      return result.rowCount;
    });
  }

  async moveContacts(input: {
    readonly campaignContactIds: readonly string[];
    readonly targetCampaignId: string;
    readonly now: Date;
  }): Promise<MoveOutreachContactsResult> {
    return this.write(async (connection) => {
      const target = await connection.query<{ readonly stage: string }>(
        `select stage
           from public.outreach_pipeline_columns
          where campaign_id = $1::uuid
          order by position
          limit 1`,
        [input.targetCampaignId]
      );
      const firstStage = target.rows[0]?.stage;
      if (firstStage === undefined) {
        throw new Error("Outreach target campaign was not found");
      }

      const requested = [...input.campaignContactIds];
      // Тот же человек уже может числиться в кампании назначения — переносить нечего,
      // иначе упрёмся в уникальность (campaign_id, contact_id).
      const moved = await connection.query(
        `update public.outreach_campaign_contacts moving
            set campaign_id = $2::uuid,
                pipeline_stage = $3::text,
                updated_at = $4::timestamptz
          where moving.id = any($1::uuid[])
            and moving.removed_at is null
            and moving.campaign_id <> $2::uuid
            and not exists (
              select 1
                from public.outreach_campaign_contacts existing
               where existing.campaign_id = $2::uuid
                 and existing.contact_id = moving.contact_id
                 and existing.removed_at is null
            )`,
        [requested, input.targetCampaignId, firstStage, input.now.toISOString()]
      );

      return {
        moved: moved.rowCount,
        alreadyThere: requested.length - moved.rowCount
      };
    });
  }

  listPipelineColumns(
    campaignId: string
  ): Promise<readonly OutreachPipelineColumn[]> {
    return this.read(async (connection) => {
      const result = await connection.query<PipelineColumnRow>(
        `select stage, label, position, outcome
         from public.outreach_pipeline_columns
         where campaign_id = $1::uuid
         order by position`,
        [campaignId]
      );
      return result.rows.map((row) => ({
        stage: row.stage,
        label: row.label,
        position: row.position,
        outcome: row.outcome
      }));
    });
  }

  async updatePipelineColumns(
    input: Parameters<AdminOutreachRepository["updatePipelineColumns"]>[0]
  ): Promise<"updated" | "not_found" | "stage_in_use"> {
    // A failed delete leaves the Postgres transaction aborted: every
    // statement after it (including COMMIT) would fail until a ROLLBACK is
    // issued. So the foreign key violation must propagate out of `write`
    // and let its own catch block roll back, rather than being swallowed
    // here and treated as a normal, committable result.
    try {
      return await this.write((connection) => this.applyPipelineColumns(connection, input));
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return "stage_in_use";
      }
      throw error;
    }
  }

  private async applyPipelineColumns(
    connection: SqlConnection,
    input: Parameters<AdminOutreachRepository["updatePipelineColumns"]>[0]
  ): Promise<"updated" | "not_found"> {
    {
      const campaign = await connection.query<{ readonly id: string }>(
        `select id
         from public.outreach_campaigns
         where id = $1::uuid
         for update`,
        [input.campaignId]
      );
      if (!campaign.rows[0]) {
        return "not_found";
      }
      const existing = await connection.query<{ readonly stage: string }>(
        `select stage
         from public.outreach_pipeline_columns
         where campaign_id = $1::uuid`,
        [input.campaignId]
      );
      const existingStages = new Set(existing.rows.map((row) => row.stage));
      const nextStages = new Set(input.columns.map((column) => column.stage));
      const removedStages = [...existingStages].filter(
        (stage) => !nextStages.has(stage)
      );
      if (removedStages.length > 0) {
        await connection.query(
          `delete from public.outreach_pipeline_columns
           where campaign_id = $1::uuid
             and stage = any($2::text[])`,
          [input.campaignId, removedStages]
        );
      }
      for (const column of input.columns) {
        if (existingStages.has(column.stage)) {
          await connection.query(
            `update public.outreach_pipeline_columns
             set label = $3::text,
                 position = $4::integer,
                 outcome = $5::text,
                 updated_at = $6::timestamptz
             where campaign_id = $1::uuid
               and stage = $2::text`,
            [
              input.campaignId,
              column.stage,
              column.label,
              column.position,
              column.outcome,
              input.now
            ]
          );
        } else {
          await connection.query(
            `insert into public.outreach_pipeline_columns (
               campaign_id, stage, label, position, outcome,
               created_at, updated_at
             ) values (
               $1::uuid, $2::text, $3::text, $4::integer, $5::text,
               $6::timestamptz, $6::timestamptz
             )`,
            [
              input.campaignId,
              column.stage,
              column.label,
              column.position,
              column.outcome,
              input.now
            ]
          );
        }
      }
      return "updated";
    }
  }

  getPipelineColumnOutcome(
    input: Parameters<AdminOutreachRepository["getPipelineColumnOutcome"]>[0]
  ): Promise<OutreachPipelineColumnOutcome | null> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly outcome: OutreachPipelineColumnOutcome;
      }>(
        `select pipeline_column.outcome
         from public.outreach_campaign_contacts campaign_contact
         join public.outreach_pipeline_columns pipeline_column
           on pipeline_column.campaign_id = campaign_contact.campaign_id
          and pipeline_column.stage = $2::text
         where campaign_contact.id = $1::uuid`,
        [input.campaignContactId, input.stage]
      );
      return result.rows[0]?.outcome ?? null;
    });
  }

  listCustomFieldDefinitions(
    campaignId: string
  ): Promise<readonly OutreachCustomFieldDefinition[]> {
    return this.read(async (connection) => {
      const result = await connection.query<CustomFieldDefinitionRow>(
        `select id, campaign_id, field_key, label, field_type, options, position
         from public.outreach_custom_field_definitions
         where campaign_id is null or campaign_id = $1::uuid
         order by position, created_at`,
        [campaignId]
      );
      return result.rows.map(mapCustomFieldDefinition);
    });
  }

  createCustomFieldDefinition(
    input: Parameters<
      AdminOutreachRepository["createCustomFieldDefinition"]
    >[0]
  ): Promise<OutreachCustomFieldDefinition> {
    return this.write(async (connection) => {
      const position = await connection.query<{ readonly next: number }>(
        `select coalesce(max(position), 0) + 1 as next
         from public.outreach_custom_field_definitions
         where campaign_id is not distinct from $1::uuid`,
        [input.campaignId]
      );
      const result = await connection.query<CustomFieldDefinitionRow>(
        `insert into public.outreach_custom_field_definitions (
           id, campaign_id, field_key, label, field_type, options,
           position, created_by_admin_id, created_at, updated_at
         ) values (
           $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb,
           $7::integer, $8::uuid, $9::timestamptz, $9::timestamptz
         )
         returning id, campaign_id, field_key, label, field_type, options, position`,
        [
          input.id,
          input.campaignId,
          input.key,
          input.label,
          input.type,
          input.options === null ? null : JSON.stringify(input.options),
          position.rows[0]?.next ?? 1,
          input.createdByAdminId,
          input.now
        ]
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Outreach custom field creation failed");
      }
      return mapCustomFieldDefinition(row);
    });
  }

  deleteCustomFieldDefinition(fieldId: string): Promise<boolean> {
    return this.write(async (connection) => {
      await connection.query(
        `delete from public.outreach_custom_field_values
         where field_definition_id = $1::uuid`,
        [fieldId]
      );
      const result = await connection.query(
        `delete from public.outreach_custom_field_definitions
         where id = $1::uuid`,
        [fieldId]
      );
      return result.rowCount === 1;
    });
  }

  setCustomFieldValue(
    input: Parameters<AdminOutreachRepository["setCustomFieldValue"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const definition = await connection.query<{
        readonly field_type: OutreachCustomFieldType;
      }>(
        `select field_type
         from public.outreach_custom_field_definitions
         where id = $1::uuid`,
        [input.fieldId]
      );
      const fieldType = definition.rows[0]?.field_type;
      if (!fieldType) {
        return false;
      }
      if (input.value === null) {
        await connection.query(
          `insert into public.outreach_custom_field_values (
             campaign_contact_id, field_definition_id,
             value_text, value_number, value_date, updated_at
           ) values ($1::uuid, $2::uuid, null, null, null, $3::timestamptz)
           on conflict (campaign_contact_id, field_definition_id)
           do update set value_text = null, value_number = null,
             value_date = null, updated_at = $3::timestamptz`,
          [input.campaignContactId, input.fieldId, input.now]
        );
        return true;
      }
      if (fieldType === "number" && !Number.isFinite(Number(input.value))) {
        throw new Error("Outreach custom field number value is invalid");
      }
      if (
        fieldType === "date"
        && Number.isNaN(new Date(input.value).getTime())
      ) {
        throw new Error("Outreach custom field date value is invalid");
      }
      await connection.query(
        `insert into public.outreach_custom_field_values (
           campaign_contact_id, field_definition_id,
           value_text, value_number, value_date, updated_at
         ) values (
           $1::uuid, $2::uuid,
           case when $3::text = 'text' or $3::text = 'select' then $4::text end,
           case when $3::text = 'number' then $4::numeric end,
           case when $3::text = 'date' then $4::date end,
           $5::timestamptz
         )
         on conflict (campaign_contact_id, field_definition_id)
         do update set
           value_text = case when $3::text = 'text' or $3::text = 'select' then $4::text end,
           value_number = case when $3::text = 'number' then $4::numeric end,
           value_date = case when $3::text = 'date' then $4::date end,
           updated_at = $5::timestamptz`,
        [input.campaignContactId, input.fieldId, fieldType, input.value, input.now]
      );
      return true;
    });
  }

  listTaskBoard(
    input: Parameters<AdminOutreachRepository["listTaskBoard"]>[0]
  ): Promise<readonly Omit<OutreachTaskBoardItem, "urgency">[]> {
    return this.read(async (connection) => {
      const startOfToday = new Date(Date.UTC(
        input.now.getUTCFullYear(),
        input.now.getUTCMonth(),
        input.now.getUTCDate()
      ));
      const result = await connection.query<TaskBoardRow>(
        `select task.id, task.campaign_contact_id,
                campaign.id as campaign_id, campaign.name as campaign_name,
                contact.display_name as contact_name,
                contact.phone_e164 as contact_phone,
                task.assigned_admin_id,
                coalesce(assignee.display_name, assignee.email_normalized, 'Менеджер') as assigned_admin_name,
                task.task_type, task.task_text, task.due_at, task.status
         from public.outreach_tasks task
         join public.outreach_campaign_contacts campaign_contact
           on campaign_contact.id = task.campaign_contact_id
         join public.outreach_campaigns campaign
           on campaign.id = campaign_contact.campaign_id
         join public.outreach_contacts contact
           on contact.id = campaign_contact.contact_id
         join public.admin_accounts assignee
           on assignee.id = task.assigned_admin_id
         where ($1::uuid is null or task.assigned_admin_id = $1)
           and campaign_contact.removed_at is null
           and (
             task.status = 'open'
             or (task.status = 'completed' and task.completed_at >= $2::timestamptz)
           )
         order by task.status, task.due_at, task.id`,
        [input.assignedAdminId, startOfToday]
      );
      return result.rows.map((row) => ({
        id: row.id,
        campaignContactId: row.campaign_contact_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        assignedAdminId: row.assigned_admin_id,
        assignedAdminName: row.assigned_admin_name,
        type: row.task_type,
        text: row.task_text,
        dueAt: toIso(row.due_at),
        status: row.status
      }));
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
         left join lateral (
           select task.id, task.assigned_admin_id,
                  coalesce(task_assignee.display_name, task_assignee.email_normalized, 'Менеджер') as assigned_admin_name,
                  task.created_by_admin_id,
                  coalesce(task_creator.display_name, task_creator.email_normalized, 'Менеджер') as created_by_admin_name,
                  task.task_type, task.task_text, task.due_at, task.created_at
           from public.outreach_tasks task
           join public.admin_accounts task_assignee
             on task_assignee.id = task.assigned_admin_id
           join public.admin_accounts task_creator
             on task_creator.id = task.created_by_admin_id
           where task.campaign_contact_id = campaign_contact.id
             and task.status = 'open'
           limit 1
         ) open_task on true
         left join public.outreach_pipeline_columns pipeline_column
           on pipeline_column.campaign_id = campaign_contact.campaign_id
          and pipeline_column.stage = campaign_contact.pipeline_stage
         ${CUSTOM_FIELDS_LATERAL_JOIN}
         where campaign_contact.campaign_id = $1
           and campaign_contact.removed_at is null
           and ($2::text is null or (
             coalesce(contact.display_name, '') ilike $2 escape '\\'
             or coalesce(contact.phone_e164, '') ilike $2 escape '\\'
             or coalesce(contact.telegram_username_normalized, '') ilike $2 escape '\\'
             or coalesce(contact.max_identifier_normalized, '') ilike $2 escape '\\'
           ))
           and ($3::text is null or campaign_contact.current_status = $3)
           and ($4::text is null or campaign_contact.pipeline_stage = $4)
           and ($5::uuid is null or campaign_contact.assigned_admin_id = $5)
         order by
           coalesce(pipeline_column.position, 999),
           open_task.due_at nulls last,
           campaign_contact.created_at desc,
           campaign_contact.id desc
         limit $6 offset $7`,
        [
          input.campaignId,
          search,
          input.status,
          input.stage,
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

  listPeople(
    input: Parameters<AdminOutreachRepository["listPeople"]>[0]
  ): Promise<Awaited<ReturnType<AdminOutreachRepository["listPeople"]>>> {
    return this.read(async (connection) => {
      const search = input.search
        ? `%${escapeLike(input.search.toLowerCase())}%`
        : null;
      const result = await connection.query<PersonRow>(
        `select
           contact.id as contact_id,
           contact.display_name,
           contact.phone_e164,
           contact.telegram_username,
           contact.max_identifier,
           contact.email,
           contact.source,
           contact.linked_user_id,
           contact.archived_at,
           contact.created_at,
           membership.campaign_count,
           membership.last_activity_at,
           count(*) over()::text as total_count
         from public.outreach_contacts contact
         left join lateral (
           select
             count(*) filter (where member.removed_at is null)::text as campaign_count,
             max(member.last_activity_at) as last_activity_at
           from public.outreach_campaign_contacts member
           where member.contact_id = contact.id
         ) membership on true
         where
           -- Архивные видно только в своём фильтре: иначе убранный контакт продолжает
           -- мозолить глаза в общем списке и убирать его было незачем.
           (case when $2::text = 'archived'
                 then contact.archived_at is not null
                 else contact.archived_at is null end)
           and ($2::text <> 'without_phone' or contact.phone_e164 is null)
           and ($2::text <> 'without_name' or contact.display_name is null)
           and ($2::text <> 'without_campaign' or coalesce(membership.campaign_count::bigint, 0) = 0)
           and ($2::text <> 'in_bot' or contact.linked_user_id is not null)
           and ($1::text is null or (
             coalesce(contact.display_name, '') ilike $1 escape '\\'
             or coalesce(contact.phone_e164, '') ilike $1 escape '\\'
             or coalesce(contact.telegram_username_normalized, '') ilike $1 escape '\\'
             or coalesce(contact.max_identifier_normalized, '') ilike $1 escape '\\'
             or coalesce(contact.email_normalized, '') ilike $1 escape '\\'
           ))
         order by
           membership.last_activity_at desc nulls last,
           contact.created_at desc,
           contact.id desc
         limit $3 offset $4`,
        [
          search,
          input.filter,
          input.limit,
          (input.page - 1) * input.limit
        ]
      );
      return {
        items: result.rows.map(mapPerson),
        total: Number(result.rows[0]?.total_count ?? 0),
        page: input.page,
        limit: input.limit
      };
    });
  }

  getPerson(contactId: string): Promise<OutreachPersonCard | null> {
    return this.read(async (connection) => {
      const contactResult = await connection.query<PersonCardRow>(
        `select
           contact.id as contact_id,
           contact.display_name,
           contact.phone_e164,
           contact.telegram_username,
           contact.max_identifier,
           contact.email,
           contact.source,
           contact.note,
           contact.linked_user_id,
           contact.archived_at,
           contact.created_at,
           contact.updated_at
         from public.outreach_contacts contact
         where contact.id = $1::uuid`,
        [contactId]
      );
      const contact = contactResult.rows[0];
      if (!contact) {
        return null;
      }

      // Убранные из кампании тоже показываем: вопрос «что человеку уже говорили» они
      // закрывают не хуже действующих, а скрыть их — значит потерять половину истории.
      const campaigns = await connection.query<PersonCampaignRow>(
        `select
           member.id as campaign_contact_id,
           member.campaign_id,
           campaign.name as campaign_name,
           member.pipeline_stage,
           coalesce(pipeline_column.label, member.pipeline_stage) as stage_label,
           assignee.display_name as assigned_admin_name,
           member.removed_at
         from public.outreach_campaign_contacts member
         join public.outreach_campaigns campaign on campaign.id = member.campaign_id
         left join public.outreach_pipeline_columns pipeline_column
           on pipeline_column.campaign_id = member.campaign_id
          and pipeline_column.stage = member.pipeline_stage
         left join public.admin_accounts assignee
           on assignee.id = member.assigned_admin_id
         where member.contact_id = $1::uuid
         order by member.removed_at nulls first, member.created_at desc
         limit 50`,
        [contactId]
      );

      const activities = await connection.query<PersonActivityRow>(
        `select activity.id, activity.actor_admin_id,
                coalesce(actor.display_name, actor.email_normalized, 'Менеджер') as actor_name,
                activity.channel, activity.result, activity.note, activity.occurred_at,
                member.campaign_id,
                campaign.name as campaign_name
         from public.outreach_activities activity
         join public.admin_accounts actor on actor.id = activity.actor_admin_id
         join public.outreach_campaign_contacts member
           on member.id = activity.campaign_contact_id
         join public.outreach_campaigns campaign on campaign.id = member.campaign_id
         where activity.contact_id = $1::uuid
         order by activity.occurred_at desc, activity.id desc
         limit 200`,
        [contactId]
      );

      const participations = await connection.query<ParticipationRow>(
        `select participant.id as participant_id,
                participant.event_id,
                event.title as event_title,
                participant.adults,
                participant.children,
                participant.sleeping_places
         from public.event_participants participant
         join public.events event on event.id = participant.event_id
         where participant.outreach_contact_id = $1::uuid
           and participant.deleted_at is null
         order by event.starts_at desc
         limit 20`,
        [contactId]
      );

      return {
        contactId: contact.contact_id,
        displayName: contact.display_name,
        phone: contact.phone_e164,
        telegramUsername: contact.telegram_username,
        maxIdentifier: contact.max_identifier,
        email: contact.email,
        source: contact.source,
        note: contact.note,
        linkedUserId: contact.linked_user_id,
        archivedAt: nullableIso(contact.archived_at),
        createdAt: toIso(contact.created_at),
        updatedAt: toIso(contact.updated_at),
        campaigns: campaigns.rows.map((row) => ({
          campaignContactId: row.campaign_contact_id,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          stage: row.pipeline_stage,
          stageLabel: row.stage_label,
          assignedAdminName: row.assigned_admin_name,
          removedAt: nullableIso(row.removed_at)
        })),
        activities: activities.rows.map((row) => ({
          ...mapActivity(row),
          campaignId: row.campaign_id,
          campaignName: row.campaign_name
        })),
        participations: participations.rows.map((participation) => ({
          participantId: participation.participant_id,
          eventId: participation.event_id,
          eventTitle: participation.event_title,
          guests: participation.adults + participation.children,
          sleepingPlaces: participation.sleeping_places
        }))
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
         left join lateral (
           select task.id, task.assigned_admin_id,
                  coalesce(task_assignee.display_name, task_assignee.email_normalized, 'Менеджер') as assigned_admin_name,
                  task.created_by_admin_id,
                  coalesce(task_creator.display_name, task_creator.email_normalized, 'Менеджер') as created_by_admin_name,
                  task.task_type, task.task_text, task.due_at, task.created_at
           from public.outreach_tasks task
           join public.admin_accounts task_assignee
             on task_assignee.id = task.assigned_admin_id
           join public.admin_accounts task_creator
             on task_creator.id = task.created_by_admin_id
           where task.campaign_contact_id = campaign_contact.id
             and task.status = 'open'
           limit 1
         ) open_task on true
         ${CUSTOM_FIELDS_LATERAL_JOIN}
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
      const tasks = await connection.query<TaskRow>(
        `select task.id, task.assigned_admin_id,
                coalesce(assignee.display_name, assignee.email_normalized, 'Менеджер') as assigned_admin_name,
                task.created_by_admin_id,
                coalesce(creator.display_name, creator.email_normalized, 'Менеджер') as created_by_admin_name,
                task.completed_by_admin_id,
                coalesce(completer.display_name, completer.email_normalized) as completed_by_admin_name,
                task.task_type, task.task_text, task.due_at, task.status,
                task.created_at, task.completed_at
         from public.outreach_tasks task
         join public.admin_accounts assignee on assignee.id = task.assigned_admin_id
         join public.admin_accounts creator on creator.id = task.created_by_admin_id
         left join public.admin_accounts completer on completer.id = task.completed_by_admin_id
         where task.campaign_contact_id = $1
         order by
           case when task.status = 'open' then 0 else 1 end,
           task.created_at desc,
           task.id desc
         limit 100`,
        [campaignContactId]
      );
      // Участия ищем по контакту, а не по строке кампании: один и тот же человек может
      // числиться в нескольких кампаниях, а едет он всё равно один раз.
      const participations = await connection.query<ParticipationRow>(
        `select participant.id as participant_id,
                participant.event_id,
                event.title as event_title,
                participant.adults,
                participant.children,
                participant.sleeping_places
         from public.event_participants participant
         join public.events event on event.id = participant.event_id
         where participant.outreach_contact_id = $1::uuid
           and participant.deleted_at is null
         order by event.starts_at desc
         limit 20`,
        [row.contact_id]
      );
      const stageHistory = await connection.query<StageHistoryRow>(
        `select history.id, history.actor_admin_id,
                coalesce(actor.display_name, actor.email_normalized, 'Система') as actor_name,
                history.from_stage, history.to_stage,
                history.lost_reason, history.occurred_at
         from public.outreach_stage_history history
         left join public.admin_accounts actor on actor.id = history.actor_admin_id
         where history.campaign_contact_id = $1
         order by history.occurred_at desc, history.id desc
         limit 100`,
        [campaignContactId]
      );
      return {
        ...mapContact(row),
        activities: activities.rows.map(mapActivity),
        tasks: tasks.rows.map(mapTask),
        stageHistory: stageHistory.rows.map(mapStageHistory),
        participations: participations.rows.map((participation) => ({
          participantId: participation.participant_id,
          eventId: participation.event_id,
          eventTitle: participation.event_title,
          guests: participation.adults + participation.children,
          sleepingPlaces: participation.sleeping_places
        }))
      };
    });
  }

  importContacts(
    input: Parameters<AdminOutreachRepository["importContacts"]>[0]
  ): Promise<OutreachImportCounts> {
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
      const ambiguousRowIndexes: number[] = [];
      for (const [rowIndex, row] of input.rows.entries()) {
        const matches = await connection.query<ExistingContactRow>(
          `select id
           from public.outreach_contacts
           where ($1::text is not null and phone_e164 = $1)
              or ($2::text is not null and telegram_username_normalized = $2)
              or ($3::text is not null and max_identifier_normalized = $3)
              or ($4::text is not null and email_normalized = $4)
           order by created_at
           limit 2`,
          [
            row.phoneE164,
            row.telegramUsernameNormalized,
            row.maxIdentifierNormalized,
            row.emailNormalized
          ]
        );
        if (matches.rows.length > 1) {
          // Телефон ведёт на один контакт, ник на другой. Какой из них правильный, знает
          // только человек, поэтому строку пропускаем и называем её номер — но соседние
          // сто пятьдесят из-за неё не теряем.
          if (!input.skipAmbiguous) {
            throw new Error("Outreach contact identifiers belong to different contacts");
          }
          ambiguousRowIndexes.push(rowIndex);
          continue;
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
        ambiguousRowIndexes,
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
        const contact = await connection.query<{
          readonly contact_id: string;
          readonly pipeline_stage: OutreachCampaignContactSummary["stage"];
          readonly assigned_admin_id: string | null;
        }>(
          `select contact_id, pipeline_stage, assigned_admin_id
           from public.outreach_campaign_contacts
           where id = $1::uuid
           for update`,
          [activity.campaignContactId]
        );
        const current = contact.rows[0];
        if (!current) {
          continue;
        }
        const inserted = await connection.query<{ readonly id: string }>(
          `insert into public.outreach_activities (
             id, campaign_contact_id, contact_id, actor_admin_id,
             action, channel, result, note, batch_id, occurred_at
           )
           values (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5::text, $6::text, $7::text, $8::text,
             $9::uuid, $10::timestamptz
           )
           returning id`,
          [
            activity.id,
            activity.campaignContactId,
            current.contact_id,
            input.actorAdminId,
            input.action,
            input.channel,
            input.result,
            input.note,
            input.batchId,
            input.occurredAt
          ]
        );
        await connection.query(
          `update public.outreach_campaign_contacts
           set current_status = $2::text,
               pipeline_stage = coalesce($3::text, pipeline_stage),
               lost_reason = case
                 when $3::text = 'lost' then $4::text
                 when $3::text is not null then null
                 else lost_reason
               end,
               last_activity_at = $5::timestamptz,
               next_contact_at = coalesce($6::timestamptz, next_contact_at),
               updated_at = $5::timestamptz
           where id = $1::uuid`,
          [
            activity.campaignContactId,
            input.result,
            input.stage,
            input.lostReason,
            input.occurredAt,
            input.nextContactAt
          ]
        );
        if (
          input.stage
          && activity.stageHistoryId
          && input.stage !== current.pipeline_stage
        ) {
          await connection.query(
            `insert into public.outreach_stage_history (
               id, campaign_contact_id, actor_admin_id,
               from_stage, to_stage, lost_reason, occurred_at
             ) values (
               $1::uuid, $2::uuid, $3::uuid,
               $4::text, $5::text, $6::text, $7::timestamptz
             )`,
            [
              activity.stageHistoryId,
              activity.campaignContactId,
              input.actorAdminId,
              current.pipeline_stage,
              input.stage,
              input.lostReason,
              input.occurredAt
            ]
          );
        }
        if (input.nextContactAt && activity.taskId) {
          await connection.query(
            `update public.outreach_tasks
             set status = 'cancelled'
             where campaign_contact_id = $1::uuid
               and status = 'open'`,
            [activity.campaignContactId]
          );
          await connection.query(
            `insert into public.outreach_tasks (
               id, campaign_contact_id, assigned_admin_id,
               created_by_admin_id, task_type, task_text,
               due_at, status, created_at
             ) values (
               $1::uuid, $2::uuid, coalesce($3::uuid, $4::uuid),
               $4::uuid, $5::text, $6::text,
               $7::timestamptz, 'open', $8::timestamptz
             )`,
            [
              activity.taskId,
              activity.campaignContactId,
              current.assigned_admin_id,
              input.actorAdminId,
              input.action === "call" ? "call" : "message",
              input.action === "call" ? "Позвонить клиенту" : "Написать клиенту",
              input.nextContactAt,
              input.occurredAt
            ]
          );
        }
        if (!inserted.rows[0]) {
          continue;
        }
        recorded += 1;
      }
      return recorded;
    });
  }

  updateContactStage(
    input: Parameters<AdminOutreachRepository["updateContactStage"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const current = await connection.query<{
        readonly pipeline_stage: OutreachCampaignContactSummary["stage"];
        readonly lost_reason: OutreachCampaignContactSummary["lostReason"];
      }>(
        `select pipeline_stage, lost_reason
         from public.outreach_campaign_contacts
         where id = $1::uuid
         for update`,
        [input.campaignContactId]
      );
      const row = current.rows[0];
      if (!row) {
        return false;
      }
      await connection.query(
        `update public.outreach_campaign_contacts
         set pipeline_stage = $2::text,
             lost_reason = $3::text,
             updated_at = $4::timestamptz
         where id = $1::uuid`,
        [
          input.campaignContactId,
          input.stage,
          input.lostReason,
          input.now
        ]
      );
      if (
        row.pipeline_stage !== input.stage
        || row.lost_reason !== input.lostReason
      ) {
        await connection.query(
          `insert into public.outreach_stage_history (
             id, campaign_contact_id, actor_admin_id,
             from_stage, to_stage, lost_reason, occurred_at
           ) values (
             $1::uuid, $2::uuid, $3::uuid,
             $4::text, $5::text, $6::text, $7::timestamptz
           )`,
          [
            input.historyId,
            input.campaignContactId,
            input.actorAdminId,
            row.pipeline_stage,
            input.stage,
            input.lostReason,
            input.now
          ]
        );
      }
      return true;
    });
  }

  createTask(
    input: Parameters<AdminOutreachRepository["createTask"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const contact = await connection.query<{
        readonly assigned_admin_id: string | null;
      }>(
        `select assigned_admin_id
         from public.outreach_campaign_contacts
         where id = $1::uuid
         for update`,
        [input.campaignContactId]
      );
      const row = contact.rows[0];
      if (!row) {
        return false;
      }
      await connection.query(
        `update public.outreach_tasks
         set status = 'cancelled'
         where campaign_contact_id = $1::uuid
           and status = 'open'`,
        [input.campaignContactId]
      );
      await connection.query(
        `insert into public.outreach_tasks (
           id, campaign_contact_id, assigned_admin_id,
           created_by_admin_id, task_type, task_text,
           due_at, status, created_at
         ) values (
           $1::uuid, $2::uuid, coalesce($3::uuid, $4::uuid, $5::uuid),
           $5::uuid, $6::text, $7::text,
           $8::timestamptz, 'open', $9::timestamptz
         )`,
        [
          input.id,
          input.campaignContactId,
          input.assignedAdminId,
          row.assigned_admin_id,
          input.createdByAdminId,
          input.type,
          input.text,
          input.dueAt,
          input.now
        ]
      );
      await connection.query(
        `update public.outreach_campaign_contacts
         set next_contact_at = $2::timestamptz,
             updated_at = $3::timestamptz
         where id = $1::uuid`,
        [input.campaignContactId, input.dueAt, input.now]
      );
      return true;
    });
  }

  completeTask(
    input: Parameters<AdminOutreachRepository["completeTask"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const task = await connection.query<{
        readonly campaign_contact_id: string;
      }>(
        `update public.outreach_tasks
         set status = 'completed',
             completed_by_admin_id = $2::uuid,
             completed_at = $3::timestamptz
         where id = $1::uuid
           and status = 'open'
         returning campaign_contact_id`,
        [input.taskId, input.completedByAdminId, input.now]
      );
      const row = task.rows[0];
      if (!row) {
        return false;
      }
      await connection.query(
        `update public.outreach_campaign_contacts
         set next_contact_at = null,
             updated_at = $2::timestamptz
         where id = $1::uuid`,
        [row.campaign_contact_id, input.now]
      );
      return true;
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
         group by campaign.id, event.title`,
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
         left join lateral (
           select task.id, task.assigned_admin_id,
                  coalesce(task_assignee.display_name, task_assignee.email_normalized, 'Менеджер') as assigned_admin_name,
                  task.created_by_admin_id,
                  coalesce(task_creator.display_name, task_creator.email_normalized, 'Менеджер') as created_by_admin_name,
                  task.task_type, task.task_text, task.due_at, task.created_at
           from public.outreach_tasks task
           join public.admin_accounts task_assignee
             on task_assignee.id = task.assigned_admin_id
           join public.admin_accounts task_creator
             on task_creator.id = task.created_by_admin_id
           where task.campaign_contact_id = campaign_contact.id
             and task.status = 'open'
           limit 1
         ) open_task on true
         ${CUSTOM_FIELDS_LATERAL_JOIN}
         where campaign_contact.campaign_id = $1
           and campaign_contact.removed_at is null
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
          stage: row.pipeline_stage,
          lostReason: row.lost_reason,
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
       email, email_normalized,
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
       $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13
     )`,
    [
      contactId,
      row.displayName,
      row.phoneE164,
      row.telegramUsername,
      row.telegramUsernameNormalized,
      row.maxIdentifier,
      row.maxIdentifierNormalized,
      row.email,
      row.emailNormalized,
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
         email = coalesce($8, email),
         email_normalized = coalesce($9, email_normalized),
         source = coalesce($10, source),
         note = coalesce($11, note),
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
         updated_at = $12
     where id = $1`,
    [
      contactId,
      row.displayName,
      row.phoneE164,
      row.telegramUsername,
      row.telegramUsernameNormalized,
      row.maxIdentifier,
      row.maxIdentifierNormalized,
      row.email,
      row.emailNormalized,
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
    eventId: row.event_id,
    eventTitle: row.event_title,
    archivedAt: nullableIso(row.archived_at),
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
    stage: row.pipeline_stage,
    lostReason: row.lost_reason,
    status: row.current_status,
    lastActivityAt: nullableIso(row.last_activity_at),
    nextContactAt: nullableIso(row.next_contact_at),
    lastChannel: row.last_channel,
    lastResult: row.last_result,
    openTask: row.open_task_id && row.open_task_assigned_admin_id
      && row.open_task_assigned_admin_name && row.open_task_created_by_admin_id
      && row.open_task_created_by_admin_name && row.open_task_type
      && row.open_task_text && row.open_task_due_at && row.open_task_created_at
      ? {
          id: row.open_task_id,
          assignedAdminId: row.open_task_assigned_admin_id,
          assignedAdminName: row.open_task_assigned_admin_name,
          createdByAdminId: row.open_task_created_by_admin_id,
          createdByAdminName: row.open_task_created_by_admin_name,
          completedByAdminId: null,
          completedByAdminName: null,
          type: row.open_task_type,
          text: row.open_task_text,
          dueAt: toIso(row.open_task_due_at),
          status: "open",
          createdAt: toIso(row.open_task_created_at),
          completedAt: null
        }
      : null,
    customFields: (row.custom_fields ?? []).map(mapCustomFieldValue)
  };
}

function mapCustomFieldValue(row: CustomFieldJsonRow): OutreachCustomFieldValue {
  return {
    fieldId: row.field_id,
    key: row.key,
    label: row.label,
    type: row.field_type,
    options: row.options,
    value: row.value
  };
}

function mapCustomFieldDefinition(
  row: CustomFieldDefinitionRow
): OutreachCustomFieldDefinition {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    key: row.field_key,
    label: row.label,
    type: row.field_type,
    options: row.options,
    position: row.position
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "23503";
}

function mapPerson(row: PersonRow): OutreachPerson {
  return {
    contactId: row.contact_id,
    displayName: row.display_name,
    phone: row.phone_e164,
    telegramUsername: row.telegram_username,
    maxIdentifier: row.max_identifier,
    email: row.email,
    source: row.source,
    linkedUserId: row.linked_user_id,
    campaignCount: Number(row.campaign_count ?? 0),
    lastActivityAt: nullableIso(row.last_activity_at),
    archivedAt: nullableIso(row.archived_at),
    createdAt: toIso(row.created_at)
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

function mapTask(row: TaskRow): OutreachTask {
  return {
    id: row.id,
    assignedAdminId: row.assigned_admin_id,
    assignedAdminName: row.assigned_admin_name,
    createdByAdminId: row.created_by_admin_id,
    createdByAdminName: row.created_by_admin_name,
    completedByAdminId: row.completed_by_admin_id,
    completedByAdminName: row.completed_by_admin_name,
    type: row.task_type,
    text: row.task_text,
    dueAt: toIso(row.due_at),
    status: row.status,
    createdAt: toIso(row.created_at),
    completedAt: nullableIso(row.completed_at)
  };
}

function mapStageHistory(row: StageHistoryRow): OutreachStageHistoryEntry {
  return {
    id: row.id,
    actorAdminId: row.actor_admin_id,
    actorName: row.actor_name,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    lostReason: row.lost_reason,
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
           where stage_column.outcome = 'won'
         )::text as converted_contacts,
         campaign.created_at, campaign.completed_at,
         campaign.event_id, event.title as event_title, campaign.archived_at
  from public.outreach_campaigns campaign
  left join public.events event on event.id = campaign.event_id
  left join public.outreach_campaign_contacts campaign_contact
    on campaign_contact.campaign_id = campaign.id
   and campaign_contact.removed_at is null
  left join public.outreach_pipeline_columns stage_column
    on stage_column.campaign_id = campaign_contact.campaign_id
   and stage_column.stage = campaign_contact.pipeline_stage`;

const CONTACT_SUMMARY_SELECT = `
  select campaign_contact.id, contact.id as contact_id,
         contact.display_name, contact.phone_e164,
         contact.telegram_username, contact.max_identifier,
         contact.source, contact.note, contact.linked_user_id,
         campaign_contact.assigned_admin_id,
         coalesce(assignee.display_name, assignee.email_normalized) as assigned_admin_name,
         campaign_contact.pipeline_stage,
         campaign_contact.lost_reason,
         campaign_contact.current_status,
         campaign_contact.last_activity_at,
         campaign_contact.next_contact_at,
         last_activity.channel as last_channel,
         last_activity.result as last_result,
         open_task.id as open_task_id,
         open_task.assigned_admin_id as open_task_assigned_admin_id,
         open_task.assigned_admin_name as open_task_assigned_admin_name,
         open_task.created_by_admin_id as open_task_created_by_admin_id,
         open_task.created_by_admin_name as open_task_created_by_admin_name,
         open_task.task_type as open_task_type,
         open_task.task_text as open_task_text,
         open_task.due_at as open_task_due_at,
         open_task.created_at as open_task_created_at,
         custom_fields.fields as custom_fields`;

// Shared lateral join adding every custom field (global + campaign-scoped)
// with this contact's saved value, if any. Reused by both listContacts and
// getContact alongside CONTACT_SUMMARY_SELECT.
const CUSTOM_FIELDS_LATERAL_JOIN = `
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'field_id', def.id,
          'key', def.field_key,
          'label', def.label,
          'field_type', def.field_type,
          'options', def.options,
          'value', coalesce(
            val.value_text, val.value_number::text, val.value_date::text
          )
        )
        order by def.position, def.created_at
      ) filter (where def.id is not null),
      '[]'::jsonb
    ) as fields
    from public.outreach_custom_field_definitions def
    left join public.outreach_custom_field_values val
      on val.field_definition_id = def.id
     and val.campaign_contact_id = campaign_contact.id
    where def.campaign_id is null or def.campaign_id = campaign_contact.campaign_id
  ) custom_fields on true`;
