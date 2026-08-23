import type {
  AdminOutreachRepository,
  NormalizedOutreachImportRow,
  OutreachBaseImportCounts,
  OutreachExportRow,
  OutreachImportCounts
} from "@ticket-platform/application";
import type {
  AdminSiteRegistration,
  AdminSiteRegistrationPage,
  OutreachActivity,
  OutreachCampaignContactDetail,
  OutreachContactParticipation,
  OutreachPersonBotProfile,
  OutreachPersonOrder,
  OutreachPersonQuestionnaire,
  OutreachCampaignContactSummary,
  OutreachCampaignSummary,
  OutreachCustomFieldDefinition,
  OutreachCustomFieldType,
  OutreachTaskRule,
  OutreachCustomFieldValue,
  AddExistingContactsResult,
  MoveOutreachContactsResult,
  OutreachBaseContact,
  OutreachImportRow,
  OutreachImportRowRecord,
  OutreachImportRun,
  RetryOutreachImportRowResult,
  DeleteOutreachPersonResult,
  MergeOutreachPeopleResult,
  OutreachDeleteBlocker,
  OutreachManager,
  OutreachPerson,
  OutreachPersonCard,
  OutreachChannelLookup,
  OutreachChannelLookupState,
  RequestChannelLookupResult,
  OutreachParticipationAnswer,
  OutreachPersonConflict,
  OutreachPersonUpdateResult,
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
  readonly event_slug_prefix: string | null;
  readonly require_open_task: boolean;
  readonly call_window_start: number;
  readonly call_window_end: number;
  readonly call_window_timezone: string;
  readonly archived_at: Date | string | null;
}

interface BaseContactRow {
  readonly contact_id: string;
  readonly display_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram_username: string | null;
  readonly max_identifier: string | null;
  readonly source: string | null;
  readonly is_own: boolean;
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
  readonly ticket_title: string;
  readonly amount_kopecks: string | null;
  readonly checked_in_at: Date | string | null;
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
  readonly is_own: boolean;
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
  readonly open_task_auto_rule_id: string | null;
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
  readonly campaign_contact_id: string | null;
  readonly campaign_id: string | null;
  readonly campaign_name: string | null;
  readonly contact_id: string;
  readonly contact_name: string | null;
  readonly contact_phone: string | null;
  readonly contact_telegram_username: string | null;
  readonly contact_max_identifier: string | null;
  readonly contact_is_own: boolean;
  readonly assigned_admin_id: string;
  readonly assigned_admin_name: string;
  readonly task_type: OutreachTask["type"];
  readonly task_text: string;
  readonly due_at: Date | string;
  readonly status: OutreachTask["status"];
}

interface ActivityRow {
  readonly id: string;
  readonly actor_admin_id: string | null;
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
  readonly is_own: boolean;
  readonly archived_at: Date | string | null;
  readonly created_at: Date | string;
  readonly campaign_count: string | null;
  readonly last_activity_at: Date | string | null;
  readonly telegram_state: string | null;
  readonly max_state: string | null;
  readonly whatsapp_state: string | null;
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
  readonly archived_reason: string | null;
  readonly merged_into_contact_id: string | null;
  readonly merged_into_display_name: string | null;
  readonly is_own: boolean;
  readonly assigned_admin_id: string | null;
  readonly assigned_admin_name: string | null;
  readonly next_meeting_at: Date | string | null;
  readonly own_note: string | null;
  readonly own_marked_at: Date | string | null;
  readonly own_marked_by_name: string | null;
  readonly created_by_name: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ChannelLookupRow {
  readonly status: "queued" | "found" | "not_found" | "failed";
  readonly phone_e164: string;
  readonly channel: OutreachChannelLookup["channel"];
  readonly external_user_id: string | null;
  readonly username: string | null;
  readonly is_stale: boolean;
  readonly conversation_id: string | null;
  readonly requested_at: Date | string;
  readonly checked_at: Date | string | null;
  readonly failure_reason: string | null;
}

/**
 * Ответ Telegram по номеру вместе с веткой переписки, которая из него выросла.
 *
 * Ветка ищется по идентификатору человека, а не хранится ссылкой: диалог могли завести и
 * раньше — человек написал аккаунту сам, а карточку тогда не опознали. Ссылка в этом случае
 * указывала бы на второй, пустой диалог, а переписка лежала бы в первом.
 */
const CHANNEL_LOOKUP_SELECT = `select
     lookup.channel,
     lookup.status,
     lookup.phone_e164,
     lookup.external_user_id,
     lookup.username,
     lookup.requested_at,
     lookup.checked_at,
     lookup.failure_reason,
     (lookup.phone_e164 is distinct from contact.phone_e164) as is_stale,
     conversation.id as conversation_id
   from public.contact_channel_lookups lookup
   join public.outreach_contacts contact on contact.id = lookup.contact_id
   left join public.conversations conversation
     on conversation.channel = lookup.channel
    and conversation.transport = 'account'
    and conversation.external_chat_id = lookup.external_user_id
  where lookup.contact_id = $1::uuid
  order by lookup.channel`;

function mapChannelLookup(row: ChannelLookupRow): OutreachChannelLookup {
  return {
    channel: row.channel,
    state: row.status === "not_found" ? "notFound" : row.status,
    phone: row.phone_e164,
    isStale: row.is_stale,
    conversationId: row.conversation_id,
    username: row.username,
    requestedAt: toIso(row.requested_at),
    checkedAt: nullableIso(row.checked_at),
    failureReason: row.failure_reason
  };
}

interface TaskRuleRow {
  readonly id: string;
  readonly campaign_id: string;
  readonly trigger_code: OutreachTaskRule["trigger"];
  readonly stage: string | null;
  readonly stage_label: string | null;
  readonly is_enabled: boolean;
  readonly offset_days: number;
  readonly use_call_window: boolean;
  readonly at_hour: number | null;
  readonly task_type: OutreachTaskRule["taskType"];
  readonly task_text: string;
}

interface PersonFieldRow {
  readonly field_id: string;
  readonly field_key: string;
  readonly label: string;
  readonly field_type: string;
  readonly options: readonly string[] | null;
  readonly value: string | null;
}

interface PersonTaskRow extends TaskRow {
  readonly campaign_contact_id: string | null;
  readonly campaign_id: string | null;
  readonly campaign_name: string | null;
}

interface SiteRegistrationRow {
  readonly id: string;
  readonly display_name: string;
  readonly phone_e164: string;
  readonly event_id: string | null;
  readonly event_title: string | null;
  readonly participant_id: string | null;
  readonly contact_id: string | null;
  readonly page: string;
  readonly status: AdminSiteRegistration["state"];
  readonly consent_at: Date | string;
  readonly created_at: Date | string;
  readonly total_count: string;
}

interface NoteRow {
  readonly id: string;
  readonly body: string;
  readonly author_admin_id: string;
  readonly author_name: string;
  readonly created_at: Date | string;
  readonly deleted_at: Date | string | null;
  readonly can_delete: boolean;
}

interface PersonStageChangeRow extends StageHistoryRow {
  readonly campaign_id: string;
  readonly campaign_name: string;
  readonly from_label: string | null;
  readonly to_label: string;
}

interface PersonCustomFieldRow {
  readonly field_id: string;
  readonly label: string;
  readonly campaign_name: string;
  readonly value: string;
}

interface PersonBotRow {
  readonly id: string;
  readonly registered_at: Date | string;
  readonly last_seen_at: Date | string | null;
  readonly is_blocked: boolean;
  readonly phone_status: string;
  readonly wallet_available_kopecks: string;
}

interface PersonTouchpointRow {
  readonly channel: string;
  readonly source: string | null;
  readonly campaign: string | null;
  readonly partner_code: string | null;
  readonly occurred_at: Date | string;
  readonly is_first_touch: boolean;
}

interface PersonOrderRow {
  readonly id: string;
  readonly number: string;
  readonly status: OutreachPersonOrder["status"];
  readonly event_id: string;
  readonly event_title: string;
  readonly total_kopecks: string;
  readonly created_at: Date | string;
  readonly paid_at: Date | string | null;
  readonly excluded_at: Date | string | null;
}

interface PersonConsentRow {
  readonly order_id: string;
  readonly order_number: string;
  readonly version_number: number;
  readonly public_url: string;
  readonly accepted_at: Date | string;
  readonly channel: string;
}

interface PersonSiteRegistrationRow {
  readonly id: string;
  readonly event_title: string | null;
  readonly page: string;
  readonly status: string;
  readonly consent_at: Date | string;
  readonly created_at: Date | string;
}

interface PersonOrderAnswerRow {
  readonly order_id: string;
  readonly event_id: string;
  readonly event_title: string;
  readonly field_definition_id: string;
  readonly label: string;
  readonly value_text: string;
  readonly updated_at: Date | string;
}

interface MergeContactRow {
  readonly id: string;
  readonly display_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram_username: string | null;
  readonly telegram_username_normalized: string | null;
  readonly max_identifier: string | null;
  readonly max_identifier_normalized: string | null;
  readonly email: string | null;
  readonly email_normalized: string | null;
  readonly source: string | null;
  readonly note: string | null;
  readonly merged_into_contact_id: string | null;
}

/**
 * Переносит признак с дубля на главного. Двумя запросами и именно в этом порядке: уникальный
 * индекс проверяется на уровне запроса, поэтому одно значение не может принадлежать обоим
 * контактам даже на мгновение внутри транзакции.
 *
 * Значение берётся из строки, прочитанной до снятия, — после первого запроса его на дубле
 * уже нет.
 */
async function moveIdentifier(
  connection: SqlConnection,
  field: OutreachPersonConflict["field"],
  duplicate: MergeContactRow,
  masterId: string,
  now: Date
): Promise<void> {
  const moved = describeIdentifier(field, duplicate);
  const clearList = moved.normalizedColumn === null
    ? `${moved.column} = null`
    : `${moved.column} = null, ${moved.normalizedColumn} = null`;
  const setList = moved.normalizedColumn === null
    ? `${moved.column} = $2::text`
    : `${moved.column} = $2::text, ${moved.normalizedColumn} = $3::text`;

  await connection.query(
    `update public.outreach_contacts
        set ${clearList}, updated_at = $2::timestamptz
      where id = $1::uuid`,
    [duplicate.id, now]
  );
  await connection.query(
    `update public.outreach_contacts
        set ${setList}, updated_at = $4::timestamptz
      where id = $1::uuid`,
    [masterId, moved.value, moved.normalizedValue, now]
  );
}

/**
 * Колонки и значения одного признака. Switch, а не таблица: при индексации по объединению
 * TypeScript всё равно допускает промах, а здесь его быть не может.
 */
function describeIdentifier(
  field: OutreachPersonConflict["field"],
  contact: MergeContactRow
): {
  readonly column: string;
  readonly normalizedColumn: string | null;
  readonly value: string | null;
  readonly normalizedValue: string | null;
} {
  switch (field) {
    case "phone":
      return {
        column: "phone_e164",
        normalizedColumn: null,
        value: contact.phone_e164,
        normalizedValue: null
      };
    case "telegram":
      return {
        column: "telegram_username",
        normalizedColumn: "telegram_username_normalized",
        value: contact.telegram_username,
        normalizedValue: contact.telegram_username_normalized
      };
    case "max":
      return {
        column: "max_identifier",
        normalizedColumn: "max_identifier_normalized",
        value: contact.max_identifier,
        normalizedValue: contact.max_identifier_normalized
      };
    case "email":
      return {
        column: "email",
        normalizedColumn: "email_normalized",
        value: contact.email,
        normalizedValue: contact.email_normalized
      };
  }
}

/**
 * Ответы анкет всех участий человека одним запросом. Анкета заполняется на вкладке
 * мероприятия и висит на участнике, а в карточке она отвечает на вопрос «что мы про человека
 * знаем» — без неё приходится помнить, на какое событие он ездил, и идти туда.
 *
 * Запрос один на все участия: их до двадцати, и отдельное обращение на каждое превратило бы
 * открытие карточки в два десятка походов в базу.
 */
async function loadParticipationAnswers(
  connection: SqlConnection,
  contactIds: readonly string[]
): Promise<Map<string, OutreachParticipationAnswer[]>> {
  const result = await connection.query<ParticipationAnswerRow>(
    `select value.participant_id,
            value.field_definition_id,
            definition.label,
            value.value_text
       from public.event_participant_field_values value
       join public.event_participant_field_definitions definition
         on definition.id = value.field_definition_id
       join public.event_participants participant
         on participant.id = value.participant_id
      where participant.outreach_contact_id = any($1::uuid[])
        and participant.deleted_at is null
        and value.value_text is not null
        and btrim(value.value_text) <> ''
      order by definition.position, definition.created_at`,
    [contactIds]
  );

  const byParticipant = new Map<string, OutreachParticipationAnswer[]>();
  for (const row of result.rows) {
    const list = byParticipant.get(row.participant_id) ?? [];
    list.push({
      fieldId: row.field_definition_id,
      label: row.label,
      value: row.value_text
    });
    byParticipant.set(row.participant_id, list);
  }
  return byParticipant;
}

function refusedMerge(
  blocker?: MergeOutreachPeopleResult["blocker"]
): MergeOutreachPeopleResult {
  return {
    merged: false,
    ...(blocker ? { blocker } : {}),
    movedCampaigns: 0,
    movedParticipations: 0,
    takenIdentifiers: []
  };
}

interface ImportRunRow {
  readonly id: string;
  readonly filename: string | null;
  readonly campaign_id: string | null;
  readonly campaign_name: string | null;
  readonly created_by_name: string;
  readonly received: number;
  readonly created_contacts: number;
  readonly updated_contacts: number;
  readonly invalid_rows: number;
  readonly ambiguous_rows: number;
  readonly pending_rows: string;
  readonly created_at: Date | string;
}

interface ImportRowRecordRow {
  readonly id: string;
  readonly import_id: string;
  readonly filename: string | null;
  readonly line_number: number;
  readonly status: OutreachImportRowRecord["status"];
  readonly reason: string | null;
  readonly raw: OutreachImportRow;
  readonly created_at: Date | string;
}

interface ParticipationAnswerRow {
  readonly participant_id: string;
  readonly field_definition_id: string;
  readonly label: string;
  readonly value_text: string;
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

interface PersonPipelineColumnRow {
  readonly campaign_id: string;
  readonly stage: string;
  readonly label: string;
  readonly position: number;
  readonly outcome: OutreachPipelineColumn["outcome"];
}

interface PersonActivityRow extends ActivityRow {
  // Пусто у касания вне кампании: человек написал сам, ни в какой воронке не состоя.
  readonly campaign_id: string | null;
  readonly campaign_name: string | null;
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
  readonly auto_rule_id: string | null;
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
      if (input.requireOpenTask !== undefined) {
        values.push(input.requireOpenTask);
        sets.push(`require_open_task = $${values.length}::boolean`);
      }
      if (input.callWindowStart !== undefined) {
        values.push(input.callWindowStart);
        sets.push(`call_window_start = $${values.length}::smallint`);
      }
      if (input.callWindowEnd !== undefined) {
        values.push(input.callWindowEnd);
        sets.push(`call_window_end = $${values.length}::smallint`);
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
        readonly email: string | null;
        readonly source: string;
      }>(
        `select
           nullif(btrim(u.display_name), '') as name,
           contact.value_normalized as phone,
           identity.username as telegram,
           null::text as email,
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
           null::text as telegram,
           p.email as email,
           'Мероприятие' as source
         from public.event_participants p
         where p.event_id = $1::uuid
           and p.deleted_at is null`,
        [eventId]
      );

      // Признаков четыре, и достаточно любого: у людей из Timepad телефона часто нет, а
      // почта есть у всех. Отбор по одному телефону выбрасывал их молча — контакт не
      // заводился, и после встречи связаться с человеком было нечем.
      return result.rows
        .filter((row) => row.phone !== null || row.telegram !== null || row.email !== null)
        .map((row) => ({
          ...(row.name === null ? {} : { name: row.name }),
          ...(row.phone === null ? {} : { phone: row.phone }),
          ...(row.telegram === null ? {} : { telegram: row.telegram }),
          ...(row.email === null ? {} : { email: row.email }),
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
           contact.is_own,
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
        isOwn: row.is_own,
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
        // Правила автозадач по удалённым стадиям снимаются вместе с ними: повода больше
        // нет, а правило, которое молча никогда не сработает, хуже его отсутствия.
        await connection.query(
          `update public.outreach_task_rules
              set deleted_at = $3::timestamptz, updated_at = $3::timestamptz
            where campaign_id = $1::uuid
              and stage = any($2::text[])
              and deleted_at is null`,
          [input.campaignId, removedStages, input.now]
        );
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
                contact.id as contact_id,
                contact.display_name as contact_name,
                contact.phone_e164 as contact_phone,
                contact.telegram_username as contact_telegram_username,
                contact.max_identifier as contact_max_identifier,
                contact.is_own as contact_is_own,
                task.assigned_admin_id,
                coalesce(assignee.display_name, assignee.email_normalized, 'Менеджер') as assigned_admin_name,
                task.task_type, task.task_text, task.due_at, task.status
         from public.outreach_tasks task
         join public.outreach_contacts contact on contact.id = task.contact_id
         left join public.outreach_campaign_contacts campaign_contact
           on campaign_contact.id = task.campaign_contact_id
         left join public.outreach_campaigns campaign
           on campaign.id = campaign_contact.campaign_id
         join public.admin_accounts assignee
           on assignee.id = task.assigned_admin_id
         where ($1::uuid is null or task.assigned_admin_id = $1)
           -- Убранного из кампании не тревожим, а задачу про человека вообще убирать
           -- неоткуда: она к кампаниям не привязана и остаётся видна.
           and (task.campaign_contact_id is null or campaign_contact.removed_at is null)
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
        contactId: row.contact_id,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        contactTelegramUsername: row.contact_telegram_username,
        contactMaxIdentifier: row.contact_max_identifier,
        contactIsOwn: row.contact_is_own,
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
                  task.task_type, task.task_text, task.due_at, task.created_at,
                  task.auto_rule_id
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
           greatest(membership.last_activity_at, wrote.last_inbound_at) as last_activity_at,
           reach.telegram_state,
           reach.max_state,
           reach.whatsapp_state,
           count(*) over()::text as total_count
         from public.outreach_contacts contact
         left join lateral (
           select
             count(*) filter (where member.removed_at is null)::text as campaign_count,
             max(member.last_activity_at) as last_activity_at
           from public.outreach_campaign_contacts member
           where member.contact_id = contact.id
         ) membership on true
         -- Когда человек последний раз написал нам сам. Без этого тот, кто пишет прямо
         -- сейчас, оказывается в конце списка — за всеми, у кого есть касания в кампаниях,
         -- то есть за тысячами импортированных. Найти его тогда можно только запросом к базе.
         left join lateral (
           select max(conversation.last_inbound_at) as last_inbound_at
           from public.conversations conversation
           where conversation.contact_id = contact.id
         ) wrote on true
         -- Куда до человека дотянемся. Три состояния вытаскиваются одним проходом по
         -- строкам очереди: три отдельных подзапроса стоили бы трёх проходов на строку
         -- списка, а список рисуют по пятьдесят строк за раз.
         left join lateral (
           select
             max(state.status) filter (where state.channel = 'telegram') as telegram_state,
             max(state.status) filter (where state.channel = 'max') as max_state,
             max(state.status) filter (where state.channel = 'whatsapp') as whatsapp_state
           from public.contact_channel_lookups state
           where state.contact_id = contact.id
         ) reach on true
         where
           -- Архивные видно только в своём фильтре: иначе убранный контакт продолжает
           -- мозолить глаза в общем списке и убирать его было незачем.
           (case when $2::text = 'archived'
                 then contact.archived_at is not null
                 else contact.archived_at is null end)
           and ($2::text <> 'wrote_in_messenger' or wrote.last_inbound_at is not null)
           and ($2::text <> 'without_phone' or contact.phone_e164 is null)
           and ($2::text <> 'without_name' or contact.display_name is null)
           and ($2::text <> 'without_campaign' or coalesce(membership.campaign_count::bigint, 0) = 0)
           and ($2::text <> 'in_bot' or contact.linked_user_id is not null)
           -- «Кому можно написать»: хоть один мессенджер ответил «есть такой». Это не то
           -- же самое, что «есть ник в карточке»: ник мог быть переписан руками из
           -- старой выгрузки и не значить ничего.
           and ($2::text <> 'reachable' or coalesce(reach.telegram_state, '') = 'found'
                or coalesce(reach.max_state, '') = 'found'
                or coalesce(reach.whatsapp_state, '') = 'found')
           and ($1::text is null or (
             coalesce(contact.display_name, '') ilike $1 escape '\\'
             or coalesce(contact.phone_e164, '') ilike $1 escape '\\'
             or coalesce(contact.telegram_username_normalized, '') ilike $1 escape '\\'
             or coalesce(contact.max_identifier_normalized, '') ilike $1 escape '\\'
             or coalesce(contact.email_normalized, '') ilike $1 escape '\\'
           ))
         order by
           -- greatest в Postgres пропускает пустые значения, поэтому одного выражения
           -- хватает на оба случая: есть только касание, есть только сообщение, есть оба.
           greatest(membership.last_activity_at, wrote.last_inbound_at) desc nulls last,
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

  getPerson(
    contactId: string,
    viewerAdminId: string
  ): Promise<OutreachPersonCard | null> {
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
           contact.is_own,
           contact.assigned_admin_id,
           coalesce(assignee.display_name, assignee.email_normalized)
             as assigned_admin_name,
           contact.next_meeting_at,
           contact.own_note,
           contact.own_marked_at,
           coalesce(owner.display_name, owner.email_normalized) as own_marked_by_name,
           contact.archived_at,
           contact.archived_reason,
           contact.merged_into_contact_id,
           master.display_name as merged_into_display_name,
           coalesce(creator.display_name, creator.email_normalized) as created_by_name,
           contact.created_at,
           contact.updated_at
         from public.outreach_contacts contact
         left join public.outreach_contacts master
           on master.id = contact.merged_into_contact_id
         left join public.admin_accounts creator
           on creator.id = contact.created_by_admin_id
         left join public.admin_accounts owner
           on owner.id = contact.own_marked_by_admin_id
         left join public.admin_accounts assignee
           on assignee.id = contact.assigned_admin_id
         where contact.id = $1::uuid`,
        [contactId]
      );
      const contact = contactResult.rows[0];
      if (!contact) {
        return null;
      }

      // Вся цепочка сведённых сюда дублей. История привязана к той карточке, по которой
      // звонили, и переписать её нельзя — журнал защищён от изменений. Поэтому карточка
      // главного собирает свою историю обходом вниз по указателям.
      const duplicates = await connection.query<{ readonly id: string }>(
        `with recursive chain as (
           select id from public.outreach_contacts where id = $1::uuid
           union all
           select child.id
             from public.outreach_contacts child
             join chain on child.merged_into_contact_id = chain.id
         )
         select id from chain`,
        [contactId]
      );
      const chain = duplicates.rows.map((row) => row.id);

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
         where member.contact_id = any($1::uuid[])
         order by member.removed_at nulls first, member.created_at desc
         limit 50`,
        [chain]
      );

      // Стадии всех воронок, где человек состоит: карточка перебрасывает его между ними
      // прямо у имени, и без списка стадий выпадающему списку неоткуда взяться.
      const campaignIds = [...new Set(campaigns.rows.map((row) => row.campaign_id))];
      const pipelineColumns = campaignIds.length === 0
        ? { rows: [] as readonly PersonPipelineColumnRow[] }
        : await connection.query<PersonPipelineColumnRow>(
          `select pipeline_column.campaign_id, pipeline_column.stage,
                  pipeline_column.label, pipeline_column.position,
                  pipeline_column.outcome
             from public.outreach_pipeline_columns pipeline_column
            where pipeline_column.campaign_id = any($1::uuid[])
            order by pipeline_column.campaign_id, pipeline_column.position`,
          [campaignIds]
        );
      const stagesByCampaign = new Map<string, OutreachPipelineColumn[]>();
      for (const row of pipelineColumns.rows) {
        const known = stagesByCampaign.get(row.campaign_id) ?? [];
        known.push({
          stage: row.stage,
          label: row.label,
          position: row.position,
          outcome: row.outcome
        });
        stagesByCampaign.set(row.campaign_id, known);
      }

      const activities = await connection.query<PersonActivityRow>(
        // Все три связи необязательны, и каждая по своей причине. Сотрудника нет у
        // входящего сообщения: его написал сам человек. Кампании нет у того, кто написал
        // боту, не состоя ни в одной воронке. Обычный join выкинул бы такие касания из
        // ленты целиком — то есть спрятал бы ровно то, ради чего запись и заводилась.
        `select activity.id, activity.actor_admin_id,
                case
                  when activity.actor_admin_id is null then 'Человек'
                  else coalesce(actor.display_name, actor.email_normalized, 'Менеджер')
                end as actor_name,
                activity.channel, activity.result, activity.note, activity.occurred_at,
                member.campaign_id,
                campaign.name as campaign_name
         from public.outreach_activities activity
         left join public.admin_accounts actor on actor.id = activity.actor_admin_id
         left join public.outreach_campaign_contacts member
           on member.id = activity.campaign_contact_id
         left join public.outreach_campaigns campaign on campaign.id = member.campaign_id
         where activity.contact_id = any($1::uuid[])
         order by activity.occurred_at desc, activity.id desc
         limit 200`,
        [chain]
      );

      const participations = await connection.query<ParticipationRow>(
        `select participant.id as participant_id,
                participant.event_id,
                event.title as event_title,
                participant.adults,
                participant.children,
                participant.sleeping_places,
                participant.ticket_title,
                participant.amount_kopecks::text as amount_kopecks,
                attendance.checked_in_at
         from public.event_participants participant
         join public.events event on event.id = participant.event_id
         left join public.event_attendance attendance
           on attendance.participant_id = participant.id
         where participant.outreach_contact_id = any($1::uuid[])
           and participant.deleted_at is null
         order by event.starts_at desc
         limit 20`,
        [chain]
      );

      const answersByParticipant = await loadParticipationAnswers(connection, chain);

      const tasks = await connection.query<PersonTaskRow>(
        `select task.id, task.campaign_contact_id,
                member.campaign_id, campaign.name as campaign_name,
                task.assigned_admin_id,
                coalesce(assignee.display_name, assignee.email_normalized, 'Менеджер') as assigned_admin_name,
                task.created_by_admin_id,
                coalesce(creator.display_name, creator.email_normalized, 'Менеджер') as created_by_admin_name,
                task.completed_by_admin_id,
                coalesce(completer.display_name, completer.email_normalized) as completed_by_admin_name,
                task.task_type, task.task_text, task.due_at, task.status,
                task.created_at, task.completed_at, task.auto_rule_id
         from public.outreach_tasks task
         left join public.outreach_campaign_contacts member
           on member.id = task.campaign_contact_id
         left join public.outreach_campaigns campaign on campaign.id = member.campaign_id
         join public.admin_accounts assignee on assignee.id = task.assigned_admin_id
         join public.admin_accounts creator on creator.id = task.created_by_admin_id
         left join public.admin_accounts completer
           on completer.id = task.completed_by_admin_id
         where task.contact_id = any($1::uuid[])
         order by
           case when task.status = 'open' then 0 else 1 end,
           task.due_at desc, task.id desc
         limit 100`,
        [chain]
      );

      const stageChanges = await connection.query<PersonStageChangeRow>(
        `select history.id, history.actor_admin_id,
                coalesce(actor.display_name, actor.email_normalized, 'Система') as actor_name,
                history.from_stage, history.to_stage, history.lost_reason,
                history.occurred_at,
                member.campaign_id, campaign.name as campaign_name,
                from_column.label as from_label,
                coalesce(to_column.label, history.to_stage) as to_label
         from public.outreach_stage_history history
         join public.outreach_campaign_contacts member
           on member.id = history.campaign_contact_id
         join public.outreach_campaigns campaign on campaign.id = member.campaign_id
         left join public.admin_accounts actor on actor.id = history.actor_admin_id
         left join public.outreach_pipeline_columns from_column
           on from_column.campaign_id = member.campaign_id
          and from_column.stage = history.from_stage
         left join public.outreach_pipeline_columns to_column
           on to_column.campaign_id = member.campaign_id
          and to_column.stage = history.to_stage
         where member.contact_id = any($1::uuid[])
         order by history.occurred_at desc, history.id desc
         limit 200`,
        [chain]
      );

      // Дополнительные поля заводятся по кампаниям, поэтому в карточке человека рядом со
      // значением всегда стоит кампания: одно и то же поле в двух кампаниях — два ответа.
      const customFields = await connection.query<PersonCustomFieldRow>(
        `select value.field_definition_id as field_id,
                definition.label,
                campaign.name as campaign_name,
                coalesce(
                  value.value_text,
                  value.value_number::text,
                  value.value_date::text
                ) as value
         from public.outreach_custom_field_values value
         join public.outreach_custom_field_definitions definition
           on definition.id = value.field_definition_id
         join public.outreach_campaign_contacts member
           on member.id = value.campaign_contact_id
         join public.outreach_campaigns campaign on campaign.id = member.campaign_id
         where member.contact_id = any($1::uuid[])
           and coalesce(
                 value.value_text,
                 value.value_number::text,
                 value.value_date::text
               ) is not null
         order by definition.position, definition.id
         limit 100`,
        [chain]
      );

      // Общие поля приезжают вместе с определениями, а не только заполненные: пустое поле
      // в карточке — это приглашение его заполнить, и без определения его негде показать.
      // Значение берём по всей цепочке дублей: заполнить его могли в карточке дубля.
      const sharedFields = await connection.query<PersonFieldRow>(
        `select definition.id as field_id,
                definition.field_key,
                definition.label,
                definition.field_type,
                definition.options,
                coalesce(
                  value.value_text,
                  value.value_number::text,
                  value.value_date::text
                ) as value
         from public.outreach_custom_field_definitions definition
         left join lateral (
           select field_value.value_text, field_value.value_number, field_value.value_date
             from public.outreach_contact_field_values field_value
            where field_value.field_definition_id = definition.id
              and field_value.contact_id = any($1::uuid[])
            order by field_value.updated_at desc
            limit 1
         ) value on true
         where definition.campaign_id is null
         order by definition.position, definition.id
         limit 50`,
        [chain]
      );

      // Снятые заметки в карточку не едут: пометка нужна базе, а не менеджеру.
      const notes = await connection.query<NoteRow>(
        `select note.id, note.body, note.author_admin_id,
                coalesce(author.display_name, author.email_normalized, 'Менеджер') as author_name,
                note.created_at, note.deleted_at,
                note.author_admin_id = $2::uuid as can_delete
         from public.outreach_notes note
         join public.admin_accounts author on author.id = note.author_admin_id
         where note.contact_id = any($1::uuid[])
           and note.deleted_at is null
         order by note.created_at desc, note.id desc
         limit 200`,
        [chain, viewerAdminId]
      );

      // Заявки с сайта ищем по телефону: человек оставляет там имя и номер, и только по
      // номеру заявка и связывается с карточкой.
      const siteRegistrations = await connection.query<PersonSiteRegistrationRow>(
        `select registration.id, event.title as event_title, registration.page,
                registration.status, registration.consent_at, registration.created_at
         from public.site_registrations registration
         left join public.events event on event.id = registration.event_id
         where registration.phone_e164 in (
           select linked.phone_e164 from public.outreach_contacts linked
           where linked.id = any($1::uuid[]) and linked.phone_e164 is not null
         )
         order by registration.created_at desc
         limit 20`,
        [chain]
      );

      // Ручные оплаты живут на участнике, а не на заказе: наличные и переводы мимо бота
      // заводит организатор. Без них «сколько заплатил» врало бы в меньшую сторону.
      const manualPaid = await connection.query<{ readonly total: string }>(
        `select coalesce(sum(participant.amount_kopecks), 0)::text as total
         from public.event_participants participant
         where participant.outreach_contact_id = any($1::uuid[])
           and participant.deleted_at is null`,
        [chain]
      );

      // Пользователь бота ищется по всей цепочке дублей: привязку мог получить любой из них.
      const linked = await connection.query<{ readonly linked_user_id: string }>(
        `select linked_user_id from public.outreach_contacts
         where id = any($1::uuid[]) and linked_user_id is not null
         limit 1`,
        [chain]
      );
      const userId = linked.rows[0]?.linked_user_id ?? null;
      const botProfile = userId === null
        ? null
        : await loadBotProfile(connection, userId);
      const orders = userId === null
        ? []
        : (await connection.query<PersonOrderRow>(
            `select orders.id, orders.number, orders.status, orders.event_id,
                    event.title as event_title,
                    orders.total_kopecks::text as total_kopecks,
                    orders.created_at, orders.paid_at, orders.excluded_at
             from public.orders orders
             join public.events event on event.id = orders.event_id
             where orders.user_id = $1::uuid
             order by orders.created_at desc, orders.id desc
             limit 50`,
            [userId]
          )).rows;
      const consents = userId === null
        ? []
        : (await connection.query<PersonConsentRow>(
            `select acceptance.order_id, orders.number as order_number,
                    version.version_number, version.public_url,
                    acceptance.accepted_at, acceptance.channel
             from public.offer_acceptances acceptance
             join public.orders orders on orders.id = acceptance.order_id
             join public.offer_versions version
               on version.id = acceptance.offer_version_id
             where acceptance.user_id = $1::uuid
             order by acceptance.accepted_at desc, acceptance.order_id desc
             limit 50`,
            [userId]
          )).rows;
      const orderAnswers = userId === null
        ? []
        : (await connection.query<PersonOrderAnswerRow>(
            `select value.order_id, orders.event_id, event.title as event_title,
                    value.field_definition_id, definition.label,
                    value.value_text, value.updated_at
             from public.event_order_field_values value
             join public.event_participant_field_definitions definition
               on definition.id = value.field_definition_id
             join public.orders orders on orders.id = value.order_id
             join public.events event on event.id = orders.event_id
             where orders.user_id = $1::uuid
               and value.value_text is not null
               and btrim(value.value_text) <> ''
             order by definition.position, definition.created_at
             limit 200`,
            [userId]
          )).rows;

      const participationList = participations.rows.map((participation) =>
        mapParticipation(
          participation,
          answersByParticipant.get(participation.participant_id) ?? []
        ));

      // Искали ли человека в Telegram по телефону. Отдельным запросом, а не join к
      // карточке: строки у большинства людей нет вовсе, а join ради пустоты платится на
      // каждом открытии карточки.
      const channelLookups = await connection.query<ChannelLookupRow>(
        CHANNEL_LOOKUP_SELECT,
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
        isOwn: contact.is_own,
        assignedAdminId: contact.assigned_admin_id,
        assignedAdminName: contact.assigned_admin_name,
        nextMeetingAt: nullableIso(contact.next_meeting_at),
        ownNote: contact.own_note,
        ownMarkedAt: nullableIso(contact.own_marked_at),
        ownMarkedByName: contact.own_marked_by_name,
        archivedAt: nullableIso(contact.archived_at),
        archivedReason: contact.archived_reason,
        mergedIntoContactId: contact.merged_into_contact_id,
        mergedIntoDisplayName: contact.merged_into_display_name,
        // Сама карточка тоже в цепочке, поэтому дублей на единицу меньше.
        mergedDuplicates: chain.length - 1,
        createdAt: toIso(contact.created_at),
        updatedAt: toIso(contact.updated_at),
        campaigns: campaigns.rows.map((row) => ({
          campaignContactId: row.campaign_contact_id,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          stage: row.pipeline_stage,
          stageLabel: row.stage_label,
          stages: stagesByCampaign.get(row.campaign_id) ?? [],
          assignedAdminName: row.assigned_admin_name,
          removedAt: nullableIso(row.removed_at)
        })),
        activities: activities.rows.map((row) => ({
          ...mapActivity(row),
          campaignId: row.campaign_id,
          campaignName: row.campaign_name
        })),
        participations: participationList,
        createdByName: contact.created_by_name,
        tasks: tasks.rows.map((row) => ({
          ...mapTask(row),
          campaignContactId: row.campaign_contact_id,
          campaignId: row.campaign_id,
          campaignName: row.campaign_name
        })),
        notes: notes.rows.map((row) => ({
          id: row.id,
          body: row.body,
          authorAdminId: row.author_admin_id,
          authorName: row.author_name,
          createdAt: toIso(row.created_at),
          deletedAt: nullableIso(row.deleted_at),
          canDelete: row.can_delete
        })),
        stageChanges: stageChanges.rows.map((row) => ({
          ...mapStageHistory(row),
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          fromLabel: row.from_label,
          toLabel: row.to_label
        })),
        customFields: customFields.rows.map((row) => ({
          fieldId: row.field_id,
          label: row.label,
          campaignName: row.campaign_name,
          value: row.value
        })),
        fields: sharedFields.rows.map((row) => ({
          fieldId: row.field_id,
          key: row.field_key,
          label: row.label,
          type: row.field_type as OutreachCustomFieldType,
          options: row.options,
          value: row.value
        })),
        questionnaires: buildQuestionnaires(participationList, orderAnswers),
        bot: botProfile,
        orders: orders.map((row) => ({
          id: row.id,
          number: row.number,
          status: row.status,
          eventId: row.event_id,
          eventTitle: row.event_title,
          totalKopecks: row.total_kopecks,
          createdAt: toIso(row.created_at),
          paidAt: nullableIso(row.paid_at),
          excludedAt: nullableIso(row.excluded_at)
        })),
        paidTotalKopecks: sumPaid(orders, manualPaid.rows[0]?.total ?? "0"),
        consents: consents.map((row) => ({
          orderId: row.order_id,
          orderNumber: row.order_number,
          versionNumber: row.version_number,
          publicUrl: row.public_url,
          acceptedAt: toIso(row.accepted_at),
          channel: row.channel
        })),
        siteRegistrations: siteRegistrations.rows.map((row) => ({
          id: row.id,
          eventTitle: row.event_title,
          page: row.page,
          status: row.status,
          consentAt: toIso(row.consent_at),
          createdAt: toIso(row.created_at)
        })),
        channelLookups: channelLookups.rows.map(mapChannelLookup)
      };
    });
  }

  /**
   * Попросить аккаунт компании поискать человека в Telegram по его телефону.
   *
   * Сам поиск здесь не происходит и произойти не может: спросить Telegram умеет только
   * процесс с открытой сессией TDLib. Панель кладёт просьбу, он её разбирает.
   *
   * Повторно ищем не всегда. Уже найденного искать заново незачем — идентификатор не
   * протухает, а лишний вопрос про чужой номер аккаунту дорог. Исключение — телефон в
   * карточке с тех пор поправили: тогда прежний ответ относится к другому человеку.
   */
  requestChannelLookups(input: {
    readonly contactId: string;
    readonly actorAdminId: string;
    readonly now: Date;
  }): Promise<RequestChannelLookupResult | null> {
    return this.write(async (connection) => {
      const contact = await connection.query<{ readonly phone_e164: string | null }>(
        `select phone_e164 from public.outreach_contacts where id = $1::uuid`,
        [input.contactId]
      );
      const phone = contact.rows[0]?.phone_e164;
      if (phone === undefined) {
        return null;
      }

      const before = await connection.query<ChannelLookupRow>(
        CHANNEL_LOOKUP_SELECT,
        [input.contactId]
      );
      const previous = before.rows.map(mapChannelLookup);

      if (phone === null) {
        return { status: "noPhone", lookups: previous } as const;
      }

      // Заново спрашиваем не всё. Найденного искать второй раз незачем — идентификатор не
      // протухает, а лишний вопрос про чужой номер аккаунту дорог. Исключение — телефон в
      // карточке с тех пор поправили: тогда прежний ответ относится к другому человеку.
      // Условие живёт в `where` самой записи, а не в коде: так три канала проверяются
      // одним запросом, и «что считается свежим» описано в одном месте.
      const requeued = await connection.query<{ readonly channel: string }>(
        `insert into public.contact_channel_lookups (
           contact_id, channel, phone_e164, requested_by_admin_id, requested_at,
           created_at, updated_at
         )
         select $1::uuid, channel, $2::text, $3::uuid, $4::timestamptz,
                $4::timestamptz, $4::timestamptz
           from unnest(array['telegram', 'max', 'whatsapp']) as channel
         on conflict (contact_id, channel) do update
            set phone_e164 = excluded.phone_e164,
                status = 'queued',
                external_user_id = null,
                username = null,
                attempts = 0,
                next_attempt_at = null,
                failure_reason = null,
                checked_at = null,
                requested_by_admin_id = excluded.requested_by_admin_id,
                requested_at = excluded.requested_at,
                updated_at = excluded.updated_at
          where public.contact_channel_lookups.status <> 'found'
             or public.contact_channel_lookups.phone_e164
                is distinct from excluded.phone_e164
        returning channel`,
        [input.contactId, phone, input.actorAdminId, input.now]
      );

      const saved = await connection.query<ChannelLookupRow>(
        CHANNEL_LOOKUP_SELECT,
        [input.contactId]
      );
      const lookups = saved.rows.map(mapChannelLookup);

      return {
        status: requeued.rows.length === 0 ? "alreadyChecked" : "queued",
        lookups
      } as const;
    });
  }

  updatePerson(
    input: Parameters<AdminOutreachRepository["updatePerson"]>[0]
  ): Promise<OutreachPersonUpdateResult> {
    return this.write(async (connection) => {
      const existing = await connection.query<PersonCardRow>(
        `select id as contact_id, display_name, phone_e164, telegram_username,
                max_identifier, email, source, note,
                assigned_admin_id, next_meeting_at
           from public.outreach_contacts
          where id = $1::uuid
          for update`,
        [input.contactId]
      );
      const before = existing.rows[0];
      if (!before) {
        return { status: "not_found" as const };
      }

      // Ошибку уникального индекса можно было бы просто поймать, но она не говорит, у кого
      // именно занят номер. Человеку в панели нужно имя второго контакта — иначе он не поймёт,
      // это опечатка или дубль, который пора объединить.
      for (const candidate of input.conflictCandidates) {
        const owner = await connection.query<{
          readonly id: string;
          readonly display_name: string | null;
        }>(
          `select id, display_name
             from public.outreach_contacts
            where id <> $1::uuid
              and case $2::text
                    when 'phone' then phone_e164 = $3::text
                    when 'telegram' then telegram_username_normalized = $3::text
                    when 'max' then max_identifier_normalized = $3::text
                    else email_normalized = $3::text
                  end
            limit 1`,
          [input.contactId, candidate.field, candidate.value]
        );
        const conflict = owner.rows[0];
        if (conflict) {
          return {
            status: "conflict" as const,
            conflict: {
              field: candidate.field,
              contactId: conflict.id,
              displayName: conflict.display_name
            }
          };
        }
      }

      await connection.query(
        `update public.outreach_contacts
            set display_name = $2::text,
                phone_e164 = $3::text,
                telegram_username = $4::text,
                telegram_username_normalized = $5::text,
                max_identifier = $6::text,
                max_identifier_normalized = $7::text,
                email = $8::text,
                email_normalized = $9::text,
                source = $10::text,
                note = $11::text,
                -- Пропущенное поле оставляем как было: правка ответственного не должна
                -- отменять назначенную встречу и наоборот.
                assigned_admin_id = case
                  when $13::boolean then $14::uuid else assigned_admin_id
                end,
                next_meeting_at = case
                  when $15::boolean then $16::timestamptz else next_meeting_at
                end,
                updated_at = $12::timestamptz
          where id = $1::uuid`,
        [
          input.contactId,
          input.fields.displayName,
          input.fields.phoneE164,
          input.fields.telegramUsername,
          input.fields.telegramUsernameNormalized,
          input.fields.maxIdentifier,
          input.fields.maxIdentifierNormalized,
          input.fields.email,
          input.fields.emailNormalized,
          input.fields.source,
          input.fields.note,
          input.now,
          input.assignedAdminId !== undefined,
          input.assignedAdminId ?? null,
          input.nextMeetingAt !== undefined,
          input.nextMeetingAt ?? null
        ]
      );
      await writeOutreachAudit(connection, {
        auditId: input.auditId,
        actorAdminId: input.actorAdminId,
        action: "outreach.contact.updated",
        contactId: input.contactId,
        reason: null,
        before: {
          displayName: before.display_name,
          phone: before.phone_e164,
          telegram: before.telegram_username,
          max: before.max_identifier,
          email: before.email,
          source: before.source,
          note: before.note,
          assignedAdminId: before.assigned_admin_id ?? null,
          nextMeetingAt: before.next_meeting_at
            ? toIso(before.next_meeting_at)
            : null
        },
        after: {
          ...input.fields,
          ...(input.assignedAdminId !== undefined
            ? { assignedAdminId: input.assignedAdminId }
            : {}),
          ...(input.nextMeetingAt !== undefined
            ? {
                nextMeetingAt: input.nextMeetingAt
                  ? input.nextMeetingAt.toISOString()
                  : null
              }
            : {})
        },
        occurredAt: input.now
      });
      return { status: "updated" as const };
    });
  }

  listTaskRules(campaignId: string): Promise<readonly OutreachTaskRule[]> {
    return this.read(async (connection) => {
      const result = await connection.query<TaskRuleRow>(
        `${TASK_RULE_SELECT}
          where rule.campaign_id = $1::uuid
            and rule.deleted_at is null
          order by rule.trigger_code, pipeline_column.position nulls first`,
        [campaignId]
      );
      return result.rows.map(mapTaskRule);
    });
  }

  /**
   * Заводит правило. `null` — такое уже есть: повод с той же стадией занят, и второе
   * правило означало бы две задачи на одно событие.
   */
  createTaskRule(
    input: Parameters<AdminOutreachRepository["createTaskRule"]>[0]
  ): Promise<OutreachTaskRule | null> {
    return this.write(async (connection) => {
      const inserted = await connection.query<{ readonly id: string }>(
        `insert into public.outreach_task_rules (
           id, campaign_id, trigger_code, stage, is_enabled, offset_days,
           use_call_window, at_hour, task_type, task_text, created_at, updated_at
         ) values (
           $1::uuid, $2::uuid, $3::text, $4::text, true, $5::smallint,
           $6::boolean, $7::smallint, $8::text, $9::text, $10::timestamptz,
           $10::timestamptz
         )
         on conflict do nothing
         returning id`,
        [
          input.ruleId,
          input.campaignId,
          input.trigger,
          input.stage,
          input.offsetDays,
          input.useCallWindow,
          input.atHour,
          input.taskType,
          input.taskText,
          input.now
        ]
      );
      if (inserted.rows.length === 0) {
        return null;
      }
      const result = await connection.query<TaskRuleRow>(
        `${TASK_RULE_SELECT} where rule.id = $1::uuid`,
        [input.ruleId]
      );
      const row = result.rows[0];
      return row ? mapTaskRule(row) : null;
    });
  }

  /**
   * Снимает правило. Задачи, которые оно уже поставило, остаются: это работа, которую
   * менеджеру всё ещё делать, а ссылка на правило нужна ленте карточки.
   */
  deleteTaskRule(
    input: Parameters<AdminOutreachRepository["deleteTaskRule"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const deleted = await connection.query(
        `update public.outreach_task_rules
            set deleted_at = $2::timestamptz,
                deleted_by_admin_id = $3::uuid,
                updated_at = $2::timestamptz
          where id = $1::uuid
            and deleted_at is null`,
        [input.ruleId, input.now, input.deletedByAdminId]
      );
      return (deleted.rowCount ?? 0) > 0;
    });
  }

  updateTaskRule(
    input: Parameters<AdminOutreachRepository["updateTaskRule"]>[0]
  ): Promise<OutreachTaskRule | null> {
    return this.write(async (connection) => {
      const sets = ["updated_at = $2"];
      const values: unknown[] = [input.ruleId, input.now];
      const push = (column: string, value: unknown, cast: string) => {
        values.push(value);
        sets.push(`${column} = $${values.length}${cast}`);
      };
      const changes = input.changes;
      if (changes.isEnabled !== undefined) {
        push("is_enabled", changes.isEnabled, "::boolean");
      }
      if (changes.offsetDays !== undefined) {
        push("offset_days", changes.offsetDays, "::smallint");
      }
      if (changes.useCallWindow !== undefined) {
        push("use_call_window", changes.useCallWindow, "::boolean");
      }
      if (changes.atHour !== undefined) {
        push("at_hour", changes.atHour, "::smallint");
      }
      if (changes.taskType !== undefined) {
        push("task_type", changes.taskType, "::text");
      }
      if (changes.taskText !== undefined) {
        push("task_text", changes.taskText, "::text");
      }
      await connection.query(
        `update public.outreach_task_rules
            set ${sets.join(", ")}
          where id = $1::uuid`,
        values
      );
      const result = await connection.query<TaskRuleRow>(
        `${TASK_RULE_SELECT} where rule.id = $1::uuid`,
        [input.ruleId]
      );
      const row = result.rows[0];
      return row ? mapTaskRule(row) : null;
    });
  }

  getTaskGuard(
    input: Parameters<AdminOutreachRepository["getTaskGuard"]>[0]
  ): Promise<{
    readonly requireOpenTask: boolean;
    readonly hasOpenTask: boolean;
  } | null> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly require_open_task: boolean;
        readonly has_open_task: boolean;
      }>(
        `select campaign.require_open_task,
                exists (
                  select 1 from public.outreach_tasks task
                   where task.campaign_contact_id = member.id
                     and task.status = 'open'
                ) as has_open_task
           from public.outreach_campaign_contacts member
           join public.outreach_campaigns campaign on campaign.id = member.campaign_id
          where member.id = $1::uuid`,
        [input.campaignContactId]
      );
      const row = result.rows[0];
      return row
        ? {
            requireOpenTask: row.require_open_task,
            hasOpenTask: row.has_open_task
          }
        : null;
    });
  }

  setPersonFieldValue(
    input: Parameters<AdminOutreachRepository["setPersonFieldValue"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      // Пустое значение — это «стереть», а не «сохранить пустую строку»: пустая строка
      // выглядела бы в карточке заполненным полем без содержимого.
      if (input.value === null) {
        const removed = await connection.query(
          `delete from public.outreach_contact_field_values
            where contact_id = $1::uuid and field_definition_id = $2::uuid`,
          [input.contactId, input.fieldId]
        );
        return (removed.rowCount ?? 0) > 0;
      }
      const definition = await connection.query<{
        readonly field_type: string;
      }>(
        `select field_type from public.outreach_custom_field_definitions
          where id = $1::uuid and campaign_id is null`,
        [input.fieldId]
      );
      const type = definition.rows[0]?.field_type;
      if (!type) {
        return false;
      }
      await connection.query(
        `insert into public.outreach_contact_field_values (
           contact_id, field_definition_id, value_text, value_number, value_date, updated_at
         ) values (
           $1::uuid, $2::uuid,
           case when $3::text = 'text' or $3::text = 'select' then $4::text end,
           case when $3::text = 'number' then $4::numeric end,
           case when $3::text = 'date' then $4::date end,
           $5::timestamptz
         )
         on conflict (contact_id, field_definition_id) do update
            set value_text = excluded.value_text,
                value_number = excluded.value_number,
                value_date = excluded.value_date,
                updated_at = excluded.updated_at`,
        [input.contactId, input.fieldId, type, input.value, input.now]
      );
      return true;
    });
  }

  /**
   * Сводит дубль к главному. Историю не переносит и не может: журнал активностей и история
   * стадий защищены триггерами «только на добавление». Вместо этого дубль остаётся указателем
   * на главного, а карточка главного собирает историю по цепочке.
   */
  mergePeople(
    input: Parameters<AdminOutreachRepository["mergePeople"]>[0]
  ): Promise<MergeOutreachPeopleResult> {
    return this.write(async (connection) => {
      if (input.contactId === input.targetContactId) {
        return refusedMerge("same_contact");
      }

      // Порядок блокировки по идентификатору: две встречные попытки объединить одну пару
      // иначе встанут намертво, каждая держа то, что нужно другой.
      const [first, second] = [input.contactId, input.targetContactId].sort();
      const locked = await connection.query<MergeContactRow>(
        `select id, display_name, phone_e164,
                telegram_username, telegram_username_normalized,
                max_identifier, max_identifier_normalized,
                email, email_normalized,
                source, note, merged_into_contact_id
           from public.outreach_contacts
          where id in ($1::uuid, $2::uuid)
          for update`,
        [first, second]
      );
      const duplicate = locked.rows.find((row) => row.id === input.contactId);
      const master = locked.rows.find((row) => row.id === input.targetContactId);
      if (!duplicate || !master) {
        return refusedMerge();
      }
      if (duplicate.merged_into_contact_id !== null) {
        return refusedMerge("already_merged");
      }
      // Сводить в того, кто сам дубль, значит строить цепочку из ниоткуда в никуда.
      if (master.merged_into_contact_id !== null) {
        return refusedMerge("target_already_merged");
      }

      // Признаки переезжают только в пустые места: у главного своя правда, и затирать её
      // значением дубля нельзя. Сначала снимаем признак с дубля, потом ставим главному —
      // иначе уникальный индекс не пропустит промежуточное состояние.
      const taken: OutreachPersonConflict["field"][] = [];
      const moves: { readonly field: OutreachPersonConflict["field"] }[] = [];
      if (master.phone_e164 === null && duplicate.phone_e164 !== null) {
        moves.push({ field: "phone" });
      }
      if (
        master.telegram_username_normalized === null
        && duplicate.telegram_username_normalized !== null
      ) {
        moves.push({ field: "telegram" });
      }
      if (
        master.max_identifier_normalized === null
        && duplicate.max_identifier_normalized !== null
      ) {
        moves.push({ field: "max" });
      }
      if (master.email_normalized === null && duplicate.email_normalized !== null) {
        moves.push({ field: "email" });
      }
      for (const move of moves) {
        await moveIdentifier(
          connection,
          move.field,
          duplicate,
          input.targetContactId,
          input.now
        );
        taken.push(move.field);
      }

      // Участия переезжают там, где главный в этой кампании ещё не состоит. Где состоит —
      // строка дубля остаётся при своих звонках и помечается убранной: слить две строки в
      // одну нельзя, к каждой привязана своя история.
      const movedCampaigns = await connection.query(
        `update public.outreach_campaign_contacts member
            set contact_id = $2::uuid, updated_at = $3::timestamptz
          where member.contact_id = $1::uuid
            and not exists (
              select 1 from public.outreach_campaign_contacts other
               where other.contact_id = $2::uuid
                 and other.campaign_id = member.campaign_id
            )`,
        [input.contactId, input.targetContactId, input.now]
      );
      await connection.query(
        `update public.outreach_campaign_contacts
            set removed_at = $2::timestamptz,
                removed_by_admin_id = $3::uuid,
                updated_at = $2::timestamptz
          where contact_id = $1::uuid and removed_at is null`,
        [input.contactId, input.now, input.actorAdminId]
      );

      const movedParticipations = await connection.query(
        `update public.event_participants
            set outreach_contact_id = $2::uuid, updated_at = $3::timestamptz
          where outreach_contact_id = $1::uuid`,
        [input.contactId, input.targetContactId, input.now]
      );

      // Источник и примечание дописываем, а не заменяем: откуда человек пришёл во второй раз —
      // такой же факт, как и первый.
      await connection.query(
        `update public.outreach_contacts master
            set source = case
                  when master.source is null then duplicate.source
                  when duplicate.source is null then master.source
                  when master.source = duplicate.source then master.source
                  else left(master.source || '; ' || duplicate.source, 200)
                end,
                note = case
                  when duplicate.note is null then master.note
                  when master.note is null then duplicate.note
                  else left(master.note || E'\\n' || duplicate.note, 2000)
                end,
                updated_at = $3::timestamptz
           from public.outreach_contacts duplicate
          where master.id = $2::uuid and duplicate.id = $1::uuid`,
        [input.contactId, input.targetContactId, input.now]
      );

      await connection.query(
        `update public.outreach_contacts
            set merged_into_contact_id = $2::uuid,
                merged_at = $3::timestamptz,
                merged_by_admin_id = $4::uuid,
                archived_at = coalesce(archived_at, $3::timestamptz),
                archived_reason = coalesce(archived_reason, $5::text),
                archived_by_admin_id = coalesce(archived_by_admin_id, $4::uuid),
                updated_at = $3::timestamptz
          where id = $1::uuid`,
        [
          input.contactId,
          input.targetContactId,
          input.now,
          input.actorAdminId,
          "Объединён с другим контактом"
        ]
      );

      await writeOutreachAudit(connection, {
        auditId: input.auditId,
        actorAdminId: input.actorAdminId,
        action: "outreach.contact.merged",
        contactId: input.contactId,
        reason: input.reason,
        before: {
          displayName: duplicate.display_name,
          phone: duplicate.phone_e164,
          telegram: duplicate.telegram_username,
          max: duplicate.max_identifier,
          email: duplicate.email
        },
        after: {
          mergedInto: input.targetContactId,
          movedCampaigns: movedCampaigns.rowCount,
          movedParticipations: movedParticipations.rowCount,
          takenIdentifiers: taken
        },
        occurredAt: input.now
      });

      return {
        merged: true,
        movedCampaigns: movedCampaigns.rowCount,
        movedParticipations: movedParticipations.rowCount,
        takenIdentifiers: taken
      };
    });
  }

  archivePerson(
    input: Parameters<AdminOutreachRepository["archivePerson"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_contacts
            set archived_at = $2::timestamptz,
                archived_reason = $3::text,
                archived_by_admin_id = $4::uuid,
                updated_at = $2::timestamptz
          where id = $1::uuid and archived_at is null`,
        [input.contactId, input.now, input.reason, input.actorAdminId]
      );
      if (result.rowCount === 0) {
        return false;
      }
      await writeOutreachAudit(connection, {
        auditId: input.auditId,
        actorAdminId: input.actorAdminId,
        action: "outreach.contact.archived",
        contactId: input.contactId,
        reason: input.reason,
        before: null,
        after: { archived: true },
        occurredAt: input.now
      });
      return true;
    });
  }

  restorePerson(
    input: Parameters<AdminOutreachRepository["restorePerson"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_contacts
            set archived_at = null,
                archived_reason = null,
                archived_by_admin_id = null,
                updated_at = $2::timestamptz
          where id = $1::uuid and archived_at is not null`,
        [input.contactId, input.now]
      );
      if (result.rowCount === 0) {
        return false;
      }
      await writeOutreachAudit(connection, {
        auditId: input.auditId,
        actorAdminId: input.actorAdminId,
        action: "outreach.contact.restored",
        contactId: input.contactId,
        reason: null,
        before: null,
        after: { archived: false },
        occurredAt: input.now
      });
      return true;
    });
  }

  deletePerson(
    input: Parameters<AdminOutreachRepository["deletePerson"]>[0]
  ): Promise<DeleteOutreachPersonResult> {
    return this.write(async (connection) => {
      const existing = await connection.query<{
        readonly id: string;
        readonly display_name: string | null;
        readonly phone_e164: string | null;
        readonly linked_user_id: string | null;
      }>(
        `select id, display_name, phone_e164, linked_user_id
           from public.outreach_contacts
          where id = $1::uuid
          for update`,
        [input.contactId]
      );
      const contact = existing.rows[0];
      if (!contact) {
        return { deleted: false, blockers: [] };
      }

      const blockers: OutreachDeleteBlocker[] = [];
      if (contact.linked_user_id !== null) {
        blockers.push("in_bot");
      }

      // Журнал активностей и история стадий защищены триггерами «только на добавление»:
      // удалить их нельзя физически, а обе таблицы ссылаются на строку участия. Без этой
      // проверки удаление падало бы на внешнем ключе вместо понятного отказа.
      const history = await connection.query<{ readonly id: string }>(
        `select activity.id
           from public.outreach_activities activity
          where activity.contact_id = $1::uuid
          union all
         select stage_history.id
           from public.outreach_stage_history stage_history
           join public.outreach_campaign_contacts member
             on member.id = stage_history.campaign_contact_id
          where member.contact_id = $1::uuid
          limit 1`,
        [input.contactId]
      );
      if (history.rows[0]) {
        blockers.push("has_activity");
      }

      // Ищем участие и по связи, и по телефону. Связь проставляется только когда человека
      // завели участником из карточки кампании; у заведённых на вкладке мероприятия и у
      // покупателей бота она пустая. Проверка по одной связи пропустила бы их всех.
      const participation = await connection.query<{ readonly id: string }>(
        `select id from public.event_participants
          where deleted_at is null
            and (
              outreach_contact_id = $1::uuid
              or ($2::text is not null and phone_e164 = $2::text)
            )
          limit 1`,
        [input.contactId, contact.phone_e164]
      );
      if (participation.rows[0]) {
        blockers.push("has_participation");
      }

      if (blockers.length > 0) {
        return { deleted: false, blockers };
      }

      // Порядок важен: сначала то, что ссылается на строку участия, потом сама строка.
      await connection.query(
        `delete from public.outreach_custom_field_values
          where campaign_contact_id in (
            select id from public.outreach_campaign_contacts where contact_id = $1::uuid
          )`,
        [input.contactId]
      );
      await connection.query(
        `delete from public.outreach_tasks
          where campaign_contact_id in (
            select id from public.outreach_campaign_contacts where contact_id = $1::uuid
          )`,
        [input.contactId]
      );
      await connection.query(
        `delete from public.outreach_campaign_contacts where contact_id = $1::uuid`,
        [input.contactId]
      );
      await connection.query(
        `delete from public.outreach_contacts where id = $1::uuid`,
        [input.contactId]
      );
      // Аудит пишется после удаления и переживает его: строки больше нет, и единственный
      // след того, что человек вообще был, — эта запись.
      await writeOutreachAudit(connection, {
        auditId: input.auditId,
        actorAdminId: input.actorAdminId,
        action: "outreach.contact.deleted",
        contactId: input.contactId,
        reason: input.reason,
        before: {
          displayName: contact.display_name,
          phone: contact.phone_e164
        },
        after: {},
        occurredAt: input.now
      });
      return { deleted: true, blockers: [] };
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
                  task.task_type, task.task_text, task.due_at, task.created_at,
                  task.auto_rule_id
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
                case
                  when activity.actor_admin_id is null then 'Человек'
                  else coalesce(actor.display_name, actor.email_normalized, 'Менеджер')
                end as actor_name,
                activity.channel, activity.result, activity.note, activity.occurred_at
         from public.outreach_activities activity
         left join public.admin_accounts actor on actor.id = activity.actor_admin_id
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
                task.created_at, task.completed_at, task.auto_rule_id
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
                participant.sleeping_places,
                participant.ticket_title,
                participant.amount_kopecks::text as amount_kopecks,
                attendance.checked_in_at
         from public.event_participants participant
         join public.events event on event.id = participant.event_id
         left join public.event_attendance attendance
           on attendance.participant_id = participant.id
         where participant.outreach_contact_id = $1::uuid
           and participant.deleted_at is null
         order by event.starts_at desc
         limit 20`,
        [row.contact_id]
      );
      const participationAnswers = await loadParticipationAnswers(
        connection,
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
        participations: participations.rows.map((participation) =>
          mapParticipation(
            participation,
            participationAnswers.get(participation.participant_id) ?? []
          ))
      };
    });
  }

  startImport(
    input: Parameters<AdminOutreachRepository["startImport"]>[0]
  ): Promise<void> {
    return this.write(async (connection) => {
      await connection.query(
        `insert into public.outreach_imports (
           id, created_by_admin_id, filename, campaign_id, created_at, updated_at
         ) values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::timestamptz, $5::timestamptz)`,
        [
          input.importId,
          input.createdByAdminId,
          input.filename,
          input.campaignId,
          input.now
        ]
      );
    });
  }

  /**
   * Дописывает итог одной пачки к загрузке и запоминает строки, которые не легли. Пачек на
   * восьми тысячах строк полсотни, поэтому счётчики именно прибавляются, а не переписываются.
   */
  recordImportOutcome(
    input: Parameters<AdminOutreachRepository["recordImportOutcome"]>[0]
  ): Promise<void> {
    return this.write(async (connection) => {
      await connection.query(
        `update public.outreach_imports
            set received = received + $2::integer,
                created_contacts = created_contacts + $3::integer,
                updated_contacts = updated_contacts + $4::integer,
                invalid_rows = invalid_rows + $5::integer,
                ambiguous_rows = ambiguous_rows + $6::integer,
                updated_at = $7::timestamptz
          where id = $1::uuid`,
        [
          input.importId,
          input.received,
          input.createdContacts,
          input.updatedContacts,
          input.failedRows.filter((row) => row.status === "invalid").length,
          input.failedRows.filter((row) => row.status === "ambiguous").length,
          input.now
        ]
      );
      for (const row of input.failedRows) {
        await connection.query(
          `insert into public.outreach_import_rows (
             id, import_id, line_number, raw, status, reason, created_at
           ) values (
             $1::uuid, $2::uuid, $3::integer, $4::jsonb, $5::text, $6::text, $7::timestamptz
           )`,
          [
            row.id,
            input.importId,
            row.lineNumber,
            JSON.stringify(row.raw),
            row.status,
            row.reason,
            input.now
          ]
        );
      }
    });
  }

  listImports(limit: number): Promise<readonly OutreachImportRun[]> {
    return this.read(async (connection) => {
      const result = await connection.query<ImportRunRow>(
        `select
           run.id, run.filename, run.campaign_id,
           campaign.name as campaign_name,
           coalesce(admin.display_name, admin.email_normalized, 'Администратор')
             as created_by_name,
           run.received, run.created_contacts, run.updated_contacts,
           run.invalid_rows, run.ambiguous_rows, run.created_at,
           (
             select count(*)::text
               from public.outreach_import_rows pending
              where pending.import_id = run.id
                and pending.status in ('invalid', 'ambiguous')
           ) as pending_rows
         from public.outreach_imports run
         join public.admin_accounts admin on admin.id = run.created_by_admin_id
         left join public.outreach_campaigns campaign on campaign.id = run.campaign_id
         order by run.created_at desc, run.id desc
         limit $1`,
        [limit]
      );
      return result.rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        createdByName: row.created_by_name,
        received: row.received,
        createdContacts: row.created_contacts,
        updatedContacts: row.updated_contacts,
        invalidRows: row.invalid_rows,
        ambiguousRows: row.ambiguous_rows,
        pendingRows: Number(row.pending_rows),
        createdAt: toIso(row.created_at)
      }));
    });
  }

  /** Неразобранные строки. Без importId — по всем загрузкам: вопрос обычно звучит именно так. */
  listPendingImportRows(input: {
    readonly importId: string | null;
    readonly limit: number;
  }): Promise<readonly OutreachImportRowRecord[]> {
    return this.read(async (connection) => {
      const result = await connection.query<ImportRowRecordRow>(
        `select row.id, row.import_id, run.filename, row.line_number,
                row.status, row.reason, row.raw, row.created_at
           from public.outreach_import_rows row
           join public.outreach_imports run on run.id = row.import_id
          where row.status in ('invalid', 'ambiguous')
            and ($1::uuid is null or row.import_id = $1::uuid)
          order by row.created_at desc, row.line_number
          limit $2`,
        [input.importId, input.limit]
      );
      return result.rows.map((row) => ({
        id: row.id,
        importId: row.import_id,
        filename: row.filename,
        lineNumber: row.line_number,
        status: row.status,
        reason: row.reason,
        raw: row.raw,
        createdAt: toIso(row.created_at)
      }));
    });
  }

  getPendingImportRow(rowId: string): Promise<OutreachImportRowRecord | null> {
    return this.read(async (connection) => {
      const result = await connection.query<ImportRowRecordRow>(
        `select row.id, row.import_id, run.filename, row.line_number,
                row.status, row.reason, row.raw, row.created_at
           from public.outreach_import_rows row
           join public.outreach_imports run on run.id = row.import_id
          where row.id = $1::uuid
            and row.status in ('invalid', 'ambiguous')`,
        [rowId]
      );
      const row = result.rows[0];
      return row
        ? {
          id: row.id,
          importId: row.import_id,
          filename: row.filename,
          lineNumber: row.line_number,
          status: row.status,
          reason: row.reason,
          raw: row.raw,
          createdAt: toIso(row.created_at)
        }
        : null;
    });
  }

  /**
   * Повторная попытка по исправленной строке. Разбор и запись — те же, что у загрузки файла:
   * иначе починенная руками строка легла бы по другим правилам, чем её соседки.
   */
  retryImportRow(
    input: Parameters<AdminOutreachRepository["retryImportRow"]>[0]
  ): Promise<RetryOutreachImportRowResult> {
    return this.write(async (connection) => {
      const upserted = await upsertImportedContact(connection, {
        row: input.row,
        createdByAdminId: input.actorAdminId,
        skipAmbiguous: true,
        now: input.now
      });
      if (upserted === null) {
        // Спор остаётся спором: строку не трогаем, человек сначала объединяет дубли.
        return {
          resolved: false,
          reason: "Признаки ведут на разных людей — сначала объедините их карточки",
          contactId: null
        };
      }
      await connection.query(
        `update public.outreach_import_rows
            set status = 'resolved',
                resolved_contact_id = $2::uuid,
                resolved_by_admin_id = $3::uuid,
                resolved_at = $4::timestamptz
          where id = $1::uuid and status in ('invalid', 'ambiguous')`,
        [input.rowId, upserted.contactId, input.actorAdminId, input.now]
      );
      return {
        resolved: true,
        reason: null,
        contactId: upserted.contactId
      };
    });
  }

  dismissImportRow(
    input: Parameters<AdminOutreachRepository["dismissImportRow"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_import_rows
            set status = 'dismissed',
                resolved_by_admin_id = $2::uuid,
                resolved_at = $3::timestamptz
          where id = $1::uuid and status in ('invalid', 'ambiguous')`,
        [input.rowId, input.actorAdminId, input.now]
      );
      return result.rowCount > 0;
    });
  }

  /**
   * Загрузка прямо в базу, без кампании. Кампания — временная работа по человеку, и требовать
   * её, чтобы просто пополнить базу, значит заводить пустышки ради загрузки файла.
   */
  importPeople(
    input: Parameters<AdminOutreachRepository["importPeople"]>[0]
  ): Promise<OutreachBaseImportCounts> {
    return this.write(async (connection) => {
      let createdContacts = 0;
      let updatedContacts = 0;
      const ambiguousRowIndexes: number[] = [];
      for (const [rowIndex, row] of input.rows.entries()) {
        const upserted = await upsertImportedContact(connection, {
          row,
          createdByAdminId: input.createdByAdminId,
          skipAmbiguous: input.skipAmbiguous,
          now: input.now
        });
        if (upserted === null) {
          ambiguousRowIndexes.push(rowIndex);
          continue;
        }
        if (upserted.created) {
          createdContacts += 1;
        } else {
          updatedContacts += 1;
        }
      }
      return {
        received: input.rows.length,
        createdContacts,
        updatedContacts,
        ambiguousRowIndexes
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
        const upserted = await upsertImportedContact(connection, {
          row,
          createdByAdminId: input.createdByAdminId,
          skipAmbiguous: input.skipAmbiguous,
          now: input.now
        });
        if (upserted === null) {
          ambiguousRowIndexes.push(rowIndex);
          continue;
        }
        const contactId = upserted.contactId;
        if (upserted.created) {
          createdContacts += 1;
        } else {
          updatedContacts += 1;
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
               -- Причина отказа приходит уже разобранной: служба обнуляет её всюду,
               -- кроме колонок с исходом «проигран». Сравнивать здесь с именем стадии
               -- нельзя — колонки переименовывают из кабинета, и «lost» у воронки может
               -- называться иначе.
               lost_reason = case
                 when $3::text is not null then $4::text
                 else lost_reason
               end,
               last_activity_at = $5::timestamptz,
               next_contact_at = $6::timestamptz,
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
        // Касание и есть выполнение задачи «связаться»: менеджер сделал ровно то, что она
        // просила. Раньше задача закрывалась только заодно с назначением следующей, и тот,
        // кто позвонил и не наметил следующий шаг, продолжал видеть её в «Просрочено».
        await connection.query(
          `update public.outreach_tasks
           set status = 'completed',
               completed_at = $2::timestamptz,
               completed_by_admin_id = $3::uuid
           where campaign_contact_id = $1::uuid
             and status = 'open'`,
          [activity.campaignContactId, input.occurredAt, input.actorAdminId]
        );
        if (input.nextContactAt && activity.taskId) {
          await connection.query(
            // Человек у задачи обязателен: задачи умеют относиться к нему целиком, а не
            // только к его работе в кампании. Здесь он берётся из строки участия — она
            // уже заблокирована выше.
            `insert into public.outreach_tasks (
               id, contact_id, campaign_contact_id, assigned_admin_id,
               created_by_admin_id, task_type, task_text,
               due_at, status, created_at
             ) values (
               $1::uuid, $9::uuid, $2::uuid, coalesce($3::uuid, $4::uuid),
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
              input.occurredAt,
              current.contact_id
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
      // Задача внутри кампании берёт человека и ответственного из строки участия: иначе
      // она попадёт в воронку одного, а в карточку другого.
      if (input.campaignContactId !== null) {
        const membership = await connection.query<{
          readonly contact_id: string;
          readonly assigned_admin_id: string | null;
        }>(
          `select contact_id, assigned_admin_id
           from public.outreach_campaign_contacts
           where id = $1::uuid
           for update`,
          [input.campaignContactId]
        );
        const row = membership.rows[0];
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
             id, contact_id, campaign_contact_id, assigned_admin_id,
             created_by_admin_id, task_type, task_text,
             due_at, status, created_at
           ) values (
             $1::uuid, $2::uuid, $3::uuid, coalesce($4::uuid, $5::uuid, $6::uuid),
             $6::uuid, $7::text, $8::text,
             $9::timestamptz, 'open', $10::timestamptz
           )`,
          [
            input.id,
            row.contact_id,
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
      }

      const contact = await connection.query<{ readonly id: string }>(
        `select id from public.outreach_contacts
         where id = $1::uuid
         for update`,
        [input.contactId]
      );
      if (!contact.rows[0]) {
        return false;
      }
      // Заменяем только задачу про человека вообще. Задачи по кампаниям — отдельная работа,
      // и гасить их из карточки значило бы тихо отменить чужой запланированный звонок.
      await connection.query(
        `update public.outreach_tasks
         set status = 'cancelled'
         where contact_id = $1::uuid
           and campaign_contact_id is null
           and status = 'open'`,
        [input.contactId]
      );
      await connection.query(
        `insert into public.outreach_tasks (
           id, contact_id, campaign_contact_id, assigned_admin_id,
           created_by_admin_id, task_type, task_text,
           due_at, status, created_at
         ) values (
           $1::uuid, $2::uuid, null, coalesce($3::uuid, $4::uuid),
           $4::uuid, $5::text, $6::text,
           $7::timestamptz, 'open', $8::timestamptz
         )`,
        [
          input.id,
          input.contactId,
          input.assignedAdminId,
          input.createdByAdminId,
          input.type,
          input.text,
          input.dueAt,
          input.now
        ]
      );
      return true;
    });
  }

  completeTask(
    input: Parameters<AdminOutreachRepository["completeTask"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const task = await connection.query<{
        readonly campaign_contact_id: string | null;
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
      // У задачи про человека вообще строки участия нет, и обнулять в ней нечего.
      if (row.campaign_contact_id === null) {
        return true;
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

  listSiteRegistrations(
    input: Parameters<AdminOutreachRepository["listSiteRegistrations"]>[0]
  ): Promise<AdminSiteRegistrationPage> {
    return this.read(async (connection) => {
      const offset = (input.page - 1) * input.limit;
      const result = await connection.query<SiteRegistrationRow>(
        `select registration.id,
                registration.display_name,
                registration.phone_e164,
                registration.event_id,
                event.title as event_title,
                registration.participant_id,
                contact.id as contact_id,
                registration.page,
                registration.status,
                registration.consent_at,
                registration.created_at,
                count(*) over()::text as total_count
         from public.site_registrations registration
         left join public.events event on event.id = registration.event_id
         -- Человек в базе ищется по телефону: заявка с сайта его не знает, а карточка
         -- клиента — единственное место, где по заявке видно всю историю.
         left join public.outreach_contacts contact
           on contact.phone_e164 = registration.phone_e164
         where $1::boolean is false or registration.status <> 'registered'
         order by registration.created_at desc, registration.id desc
         limit $2::int offset $3::int`,
        [input.onlyNeedsAttention, input.limit, offset]
      );
      const pending = await connection.query<{ readonly total: string }>(
        `select count(*)::text as total
         from public.site_registrations
         where status <> 'registered'`
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          phone: row.phone_e164,
          eventId: row.event_id,
          eventTitle: row.event_title,
          participantId: row.participant_id,
          contactId: row.contact_id,
          page: row.page,
          state: row.status,
          consentAt: toIso(row.consent_at),
          createdAt: toIso(row.created_at)
        })),
        total: Number(result.rows[0]?.total_count ?? "0"),
        page: input.page,
        limit: input.limit,
        needsAttention: Number(pending.rows[0]?.total ?? "0")
      };
    });
  }

  /**
   * Помечает человека «своим» или снимает пометку.
   *
   * Снятие стирает и объяснение, и автора: иначе в карточке висело бы «отметил Иван» рядом
   * с отсутствующей плашкой, и понять, действует она или нет, стало бы нельзя.
   */
  markPersonOwn(
    input: Parameters<AdminOutreachRepository["markPersonOwn"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_contacts
         set is_own = $2::boolean,
             own_note = case when $2::boolean then $3::text else null end,
             own_marked_at = case when $2::boolean then $4::timestamptz else null end,
             own_marked_by_admin_id = case when $2::boolean then $5::uuid else null end,
             updated_at = $4::timestamptz
         where id = $1::uuid`,
        [input.contactId, input.isOwn, input.note, input.now, input.actorAdminId]
      );
      return result.rowCount > 0;
    });
  }

  createNote(
    input: Parameters<AdminOutreachRepository["createNote"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const contact = await connection.query<{ readonly id: string }>(
        `select id from public.outreach_contacts where id = $1::uuid`,
        [input.contactId]
      );
      if (!contact.rows[0]) {
        return false;
      }
      await connection.query(
        `insert into public.outreach_notes (
           id, contact_id, author_admin_id, body, created_at
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz)`,
        [input.id, input.contactId, input.authorAdminId, input.body, input.now]
      );
      return true;
    });
  }

  /**
   * Снять заметку может только её автор.
   *
   * Не из вредности: заметка подписана именем, и стирать чужую подпись — значит менять то,
   * что человек сказал. Чужую заметку можно только прокомментировать своей.
   */
  deleteNote(
    input: Parameters<AdminOutreachRepository["deleteNote"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.outreach_notes
         set deleted_at = $3::timestamptz,
             deleted_by_admin_id = $2::uuid
         where id = $1::uuid
           and author_admin_id = $2::uuid
           and deleted_at is null`,
        [input.noteId, input.actorAdminId, input.now]
      );
      return result.rowCount > 0;
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
                  task.task_type, task.task_text, task.due_at, task.created_at,
                  task.auto_rule_id
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

/**
 * Находит человека по любому из четырёх признаков и обновляет его — либо заводит нового.
 * Общая часть двух загрузок: в кампанию и просто в базу. Возвращает null, когда признаки
 * строки ведут на разных людей и решать должен человек.
 */
async function upsertImportedContact(
  connection: SqlConnection,
  input: {
    readonly row: NormalizedOutreachImportRow & { readonly contactId: string };
    readonly createdByAdminId: string;
    readonly skipAmbiguous: boolean;
    readonly now: Date;
  }
): Promise<{ readonly contactId: string; readonly created: boolean } | null> {
  const { row } = input;
  const matches = await connection.query<ExistingContactRow>(
    // Указатель на главного важен: после объединения у дубля остаются те признаки,
    // которых у главного не было пусто, и без coalesce импорт положил бы человека на
    // надгробие. Distinct нужен там же — два признака, ведущие на два дубля одного
    // человека, спором уже не являются.
    `select distinct coalesce(contact.merged_into_contact_id, contact.id) as id
     from public.outreach_contacts contact
     where ($1::text is not null and contact.phone_e164 = $1)
        or ($2::text is not null and contact.telegram_username_normalized = $2)
        or ($3::text is not null and contact.max_identifier_normalized = $3)
        or ($4::text is not null and contact.email_normalized = $4)
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
    return null;
  }

  const existing = matches.rows[0];
  const contactId = existing?.id ?? row.contactId;
  if (existing) {
    await updateContact(connection, contactId, row, input.now);
    return { contactId, created: false };
  }
  await insertContact(connection, contactId, row, input.createdByAdminId, input.now);
  return { contactId, created: true };
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

const TASK_RULE_SELECT = `
  select rule.id, rule.campaign_id, rule.trigger_code, rule.is_enabled,
         rule.offset_days, rule.use_call_window, rule.at_hour,
         rule.task_type, rule.task_text, rule.stage,
         pipeline_column.label as stage_label
    from public.outreach_task_rules rule
    left join public.outreach_pipeline_columns pipeline_column
      on pipeline_column.campaign_id = rule.campaign_id
     and pipeline_column.stage = rule.stage`;

function mapTaskRule(row: TaskRuleRow): OutreachTaskRule {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    trigger: row.trigger_code,
    stage: row.stage,
    stageLabel: row.stage_label,
    isEnabled: row.is_enabled,
    offsetDays: row.offset_days,
    useCallWindow: row.use_call_window,
    atHour: row.at_hour,
    taskType: row.task_type,
    taskText: row.task_text
  };
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
    eventSlugPrefix: row.event_slug_prefix,
    requireOpenTask: row.require_open_task,
    callWindowStart: row.call_window_start,
    callWindowEnd: row.call_window_end,
    callWindowTimezone: row.call_window_timezone,
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
    isOwn: row.is_own,
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
          completedAt: null,
          autoRuleId: row.open_task_auto_rule_id
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

/**
 * Запись в общий журнал действий. Для удаления это единственный след того, что человек был:
 * строки уже нет, восстановить её неоткуда.
 *
 * request_id, ip и user_agent остаются пустыми: до слоя работы с базой они не доходят, а
 * выдумывать их хуже, чем честно не заполнить.
 */
async function writeOutreachAudit(
  connection: SqlConnection,
  input: {
    readonly auditId: string;
    readonly actorAdminId: string;
    readonly action: string;
    readonly contactId: string;
    readonly reason: string | null;
    readonly before: Readonly<Record<string, unknown>> | null;
    readonly after: Readonly<Record<string, unknown>>;
    readonly occurredAt: Date;
  }
): Promise<void> {
  await connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, action, target_type, target_id,
       reason, before_masked, after_masked, created_at
     ) values (
       $1::uuid, $2::uuid, $3::text, 'outreach_contact', $4::text,
       $5::text, $6::jsonb, $7::jsonb, $8::timestamptz
     )`,
    [
      input.auditId,
      input.actorAdminId,
      input.action,
      input.contactId,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.occurredAt
    ]
  );
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
    isOwn: row.is_own,
    campaignCount: Number(row.campaign_count ?? 0),
    lastActivityAt: nullableIso(row.last_activity_at),
    archivedAt: nullableIso(row.archived_at),
    createdAt: toIso(row.created_at),
    reach: {
      telegram: lookupState(row.telegram_state),
      max: lookupState(row.max_state),
      whatsapp: lookupState(row.whatsapp_state)
    }
  };
}

/**
 * Состояние проверки для списка.
 *
 * Пусто значит «не спрашивали»: строки в очереди нет вовсе. Это не то же самое, что
 * `notFound`, где мы спросили и получили ответ, — и в списке это два разных значка.
 */
function lookupState(value: string | null): OutreachChannelLookupState | null {
  if (value === null) {
    return null;
  }

  return value === "not_found" ? "notFound" : value as OutreachChannelLookupState;
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

/**
 * Пользователь бота и то, откуда он пришёл. Кошелёк берём рублёвый: других счетов у нас нет,
 * а складывать валюты в одно число значило бы показать сумму, которой не существует.
 */
async function loadBotProfile(
  connection: SqlConnection,
  userId: string
): Promise<OutreachPersonBotProfile | null> {
  const profile = await connection.query<PersonBotRow>(
    `select users.id, users.registered_at, users.last_seen_at,
            users.is_blocked, users.phone_status,
            coalesce((
              select wallet.cached_available_kopecks
              from public.wallet_accounts wallet
              where wallet.user_id = users.id and wallet.currency = 'RUB'
            ), 0)::text as wallet_available_kopecks
     from public.users users
     where users.id = $1::uuid`,
    [userId]
  );
  const row = profile.rows[0];
  if (!row) {
    return null;
  }
  const touchpoints = await connection.query<PersonTouchpointRow>(
    `select channel, source, campaign, partner_code, occurred_at, is_first_touch
     from public.user_touchpoints
     where user_id = $1::uuid
     order by occurred_at, id
     limit 20`,
    [userId]
  );
  return {
    userId: row.id,
    registeredAt: toIso(row.registered_at),
    lastSeenAt: nullableIso(row.last_seen_at),
    isBlocked: row.is_blocked,
    phoneStatus: row.phone_status,
    walletAvailableKopecks: row.wallet_available_kopecks,
    touchpoints: touchpoints.rows.map((touchpoint) => ({
      channel: touchpoint.channel,
      source: touchpoint.source,
      campaign: touchpoint.campaign,
      partnerCode: touchpoint.partner_code,
      occurredAt: toIso(touchpoint.occurred_at),
      isFirstTouch: touchpoint.is_first_touch
    }))
  };
}

/**
 * Анкеты одним списком. Вопросы у обоих источников общие — их заводит организатор во вкладке
 * мероприятия; отличается только то, к чему ответ прикреплён: к участнику или к заказу.
 */
function buildQuestionnaires(
  participations: readonly OutreachContactParticipation[],
  orderAnswers: readonly PersonOrderAnswerRow[]
): readonly OutreachPersonQuestionnaire[] {
  const fromParticipants = participations
    .filter((participation) => participation.answers.length > 0)
    .map((participation) => ({
      source: "participant" as const,
      eventId: participation.eventId,
      eventTitle: participation.eventTitle,
      filledAt: null,
      answers: participation.answers
    }));

  const byOrder = new Map<string, {
    readonly eventId: string;
    readonly eventTitle: string;
    filledAt: string;
    readonly answers: OutreachParticipationAnswer[];
  }>();
  for (const row of orderAnswers) {
    const filledAt = toIso(row.updated_at);
    const existing = byOrder.get(row.order_id);
    if (existing) {
      existing.answers.push({
        fieldId: row.field_definition_id,
        label: row.label,
        value: row.value_text
      });
      // Анкету заполняют по частям и в разное время; для карточки важна последняя правка.
      if (filledAt > existing.filledAt) {
        existing.filledAt = filledAt;
      }
      continue;
    }
    byOrder.set(row.order_id, {
      eventId: row.event_id,
      eventTitle: row.event_title,
      filledAt,
      answers: [{
        fieldId: row.field_definition_id,
        label: row.label,
        value: row.value_text
      }]
    });
  }

  return [
    ...fromParticipants,
    ...[...byOrder.values()].map((entry) => ({
      source: "order" as const,
      eventId: entry.eventId,
      eventTitle: entry.eventTitle,
      filledAt: entry.filledAt,
      answers: entry.answers
    }))
  ];
}

/**
 * Сколько человек заплатил всего: заказы бота плюс оплаты, заведённые организатором руками.
 *
 * Исключённые из отчётов заказы не в счёт — их для того и исключают. Полностью возвращённые
 * тоже: денег у нас не осталось. Частичный возврат из суммы не вычитается — сколько именно
 * вернули, видно в самом заказе, а сумма отвечает на вопрос «сколько человек принёс».
 */
function sumPaid(
  orders: readonly PersonOrderRow[],
  manualKopecks: string
): string {
  let total = BigInt(manualKopecks);
  for (const order of orders) {
    if (order.excluded_at !== null || order.paid_at === null) {
      continue;
    }
    if (order.status === "refunded") {
      continue;
    }
    total += BigInt(order.total_kopecks);
  }
  return total.toString();
}

function mapParticipation(
  row: ParticipationRow,
  answers: readonly OutreachParticipationAnswer[]
): OutreachContactParticipation {
  return {
    participantId: row.participant_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    guests: row.adults + row.children,
    sleepingPlaces: row.sleeping_places,
    ticketTitle: row.ticket_title,
    amountKopecks: row.amount_kopecks,
    checkedInAt: nullableIso(row.checked_in_at),
    answers
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
    completedAt: nullableIso(row.completed_at),
    autoRuleId: row.auto_rule_id
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
         campaign.event_id, event.title as event_title,
         campaign.event_slug_prefix, campaign.require_open_task,
         campaign.call_window_start, campaign.call_window_end,
         campaign.call_window_timezone,
         campaign.archived_at
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
         contact.source, contact.note, contact.linked_user_id, contact.is_own,
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
         open_task.auto_rule_id as open_task_auto_rule_id,
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
