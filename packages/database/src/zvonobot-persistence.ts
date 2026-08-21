import type {
  StoreZvonobotCallInput,
  ZvonobotCallRecord,
  ZvonobotCampaign,
  ZvonobotIntakeRepository,
  ZvonobotLeadToCreate,
  ZvonobotProcessingRepository,
  ZvonobotSettings
} from "@ticket-platform/application";
import { ZVONOBOT_CONTACT_SOURCE, zvonobotNote } from "@ticket-platform/application";
import { resolveParticipantContact } from "./participant-contact-link.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool,
  type SqlExecutor
} from "./postgres.js";

interface PendingCallRow {
  readonly id: string;
  readonly external_call_id: string;
  readonly campaign_name: string;
  readonly phone_e164: string | null;
  readonly pressed_button: string | null;
  readonly duration_seconds: number | null;
  readonly payload: unknown;
  readonly received_at: Date | string;
}

interface SettingsRow {
  readonly lead_buttons: readonly string[];
  readonly lead_min_duration_seconds: number | null;
  readonly campaign_slug_prefix: string;
}

interface CampaignRow {
  readonly campaign_id: string;
  readonly stage: string;
  readonly call_window_start: number;
  readonly call_window_end: number;
  readonly call_window_timezone: string;
  readonly rule_id: string | null;
  readonly is_enabled: boolean | null;
  readonly task_text: string | null;
}

/**
 * Приём вебхука: одна вставка и ничего больше.
 *
 * Здесь намеренно нет ни поиска человека, ни воронки. Приёмник отвечает Звоноботу, и всё,
 * что он делает до ответа, — это время, в течение которого их сторона ждёт и решает
 * повторить. Разбор стоит дороже вставки на порядок и живёт в проходе воркера.
 */
export class PostgresZvonobotIntakeRepository implements ZvonobotIntakeRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async store(input: StoreZvonobotCallInput): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{ readonly id: string }>(
        `insert into public.zvonobot_calls (
           id, external_call_id, campaign_name, phone_e164,
           pressed_button, duration_seconds, payload, received_at
         ) values (
           $1::uuid, $2::text, $3::text, $4::text,
           $5::text, $6::int, $7::jsonb, $8::timestamptz
         )
         on conflict (external_call_id) do nothing
         returning id`,
        [
          input.id,
          input.externalCallId,
          input.campaignName,
          input.phoneE164,
          input.pressedButton,
          input.durationSeconds,
          JSON.stringify(input.payload),
          input.receivedAt
        ]
      );
      return result.rows.length > 0;
    } finally {
      connection.release();
    }
  }
}

/**
 * Разбор принятого.
 *
 * Отбор идёт по самым старым непрочитанным: если Звонобот прислал тысячу звонков за
 * кампанию, они разберутся пачками, а не одним запросом на всю таблицу.
 */
export class PostgresZvonobotProcessingRepository
implements ZvonobotProcessingRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly pool: SqlConnectionPool
  ) {}

  async loadSettings(): Promise<ZvonobotSettings> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<SettingsRow>(
        `select lead_buttons, lead_min_duration_seconds, campaign_slug_prefix
           from public.zvonobot_settings
          where id
          limit 1`
      );
      const row = result.rows[0];
      return row
        ? {
            leadButtons: row.lead_buttons ?? [],
            leadMinDurationSeconds: row.lead_min_duration_seconds,
            campaignSlugPrefix: row.campaign_slug_prefix
          }
        : { leadButtons: [], leadMinDurationSeconds: null, campaignSlugPrefix: "sreda" };
    } finally {
      connection.release();
    }
  }

  /**
   * Воронка направления, её окно обзвона и правило автозадачи по обратной связи.
   *
   * Запрос тот же, что у заявки с сайта, и отличается одним словом — кодом повода. Это
   * сделано нарочно: заявка из робота обязана попадать туда же, куда заявка с формы, и
   * второе представление о том, «где ведётся работа по среде», сломало бы обе.
   */
  async findCampaign(slugPrefix: string): Promise<ZvonobotCampaign | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<CampaignRow>(
        `select campaign.id as campaign_id,
                pipeline_column.stage,
                campaign.call_window_start,
                campaign.call_window_end,
                campaign.call_window_timezone,
                rule.id as rule_id,
                rule.is_enabled,
                rule.task_text
           from public.outreach_campaigns campaign
           left join public.outreach_task_rules rule
             on rule.campaign_id = campaign.id
            and rule.trigger_code = 'zvonobot_feedback'
            and rule.deleted_at is null
           join lateral (
             select stage
               from public.outreach_pipeline_columns
              where campaign_id = campaign.id
              order by position
              limit 1
           ) pipeline_column on true
          where campaign.event_slug_prefix = $1::text
            and campaign.archived_at is null
            and campaign.status <> 'completed'
          limit 1`,
        [slugPrefix]
      );
      const row = result.rows[0];
      return row
        ? {
            campaignId: row.campaign_id,
            stage: row.stage,
            callWindowStart: row.call_window_start,
            callWindowEnd: row.call_window_end,
            callWindowTimezone: row.call_window_timezone,
            taskRule: row.rule_id
              ? {
                  ruleId: row.rule_id,
                  isEnabled: row.is_enabled ?? false,
                  taskText: row.task_text ?? ""
                }
              : null
          }
        : null;
    } finally {
      connection.release();
    }
  }

  async claimPending(batchSize: number): Promise<readonly ZvonobotCallRecord[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<PendingCallRow>(
        `select id, external_call_id, campaign_name, phone_e164,
                pressed_button, duration_seconds, payload, received_at
           from public.zvonobot_calls
          where status = 'pending'
          order by received_at
          limit $1::int`,
        [batchSize]
      );
      return result.rows.map((row) => ({
        id: row.id,
        externalCallId: row.external_call_id,
        campaignName: row.campaign_name,
        phoneE164: row.phone_e164,
        pressedButton: row.pressed_button,
        durationSeconds: row.duration_seconds,
        payload: row.payload,
        receivedAt: new Date(row.received_at)
      }));
    } finally {
      connection.release();
    }
  }

  /**
   * Человек, карточка в воронке, звонок по ней и отметка на самом вебхуке — одной
   * транзакцией. Половина записанного здесь хуже, чем ничего: карточка без отметки
   * заведётся заново следующим проходом, а отметка без карточки потеряет человека молча.
   */
  async createLead(input: ZvonobotLeadToCreate): Promise<void> {
    const contactId = await resolveParticipantContact(this.session, {
      contactId: input.contactSeedId,
      // Имени Звонобот не присылает: он звонил по номеру из нашего же списка. Номер и
      // становится именем до первого разговора — пустая карточка в воронке читается хуже.
      displayName: input.phoneE164,
      phoneE164: input.phoneE164,
      telegram: null,
      email: null,
      adminId: input.assignedAdminId,
      source: ZVONOBOT_CONTACT_SOURCE
    });

    if (contactId === null) {
      await this.markSettledIn(this.session, {
        callId: input.callId,
        status: "unparsed",
        processedAt: input.processedAt
      });
      return;
    }

    const membership = await this.session.query<{ readonly id: string }>(
      `insert into public.outreach_campaign_contacts (
         id, campaign_id, contact_id, pipeline_stage, current_status
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, 'new')
       on conflict (campaign_id, contact_id) do update
          set removed_at = null,
              updated_at = now()
       returning id`,
      [input.campaignContactId, input.campaignId, contactId, input.stage]
    );
    const campaignContactId = membership.rows[0]?.id ?? null;

    // Откуда взялась заявка — примечанием в карточке, а не в поле `note` самого контакта:
    // то поле приезжает из импорта и перезаписывается целиком. Примечания копятся, у
    // каждого есть автор и дата, и «Звонобот, кампания такая-то» читается там, где
    // менеджер и смотрит перед звонком.
    await this.session.query(
      `insert into public.outreach_notes (id, contact_id, author_admin_id, body)
       values ($1::uuid, $2::uuid, $3::uuid, $4::text)`,
      [
        input.noteId,
        contactId,
        input.assignedAdminId,
        zvonobotNote(input.campaignName, input.pressedButton)
      ]
    );

    let taskId: string | null = null;
    if (campaignContactId !== null && input.task !== null) {
      const created = await this.session.query<{ readonly id: string }>(
        `insert into public.outreach_tasks (
           id, contact_id, campaign_contact_id, assigned_admin_id,
           created_by_admin_id, task_type, task_text, due_at, status, created_at,
           auto_rule_id, auto_key
         )
         select $1::uuid, $2::uuid, $3::uuid,
                coalesce(contact.assigned_admin_id, member.assigned_admin_id, $4::uuid),
                $4::uuid, 'call', $5::text, $6::timestamptz, 'open', now(),
                $7::uuid, $8::text
           from public.outreach_campaign_contacts member
           join public.outreach_contacts contact on contact.id = member.contact_id
          where member.id = $3::uuid
            and not exists (
              select 1 from public.outreach_tasks open_task
               where open_task.campaign_contact_id = member.id
                 and open_task.status = 'open'
            )
         on conflict do nothing
         returning id`,
        [
          input.task.taskId,
          contactId,
          campaignContactId,
          input.assignedAdminId,
          input.task.text,
          input.task.dueAt,
          input.task.ruleId,
          // Ключ повтора описывает повод: один звонок робота — один перезвон. Открытая
          // задача по карточке всё равно главнее, и второй она не станет.
          input.task.ruleId ? `zvonobot:${input.callId}` : null
        ]
      );
      taskId = created.rows[0]?.id ?? null;
    }

    await this.session.query(
      `update public.zvonobot_calls
          set status = 'lead',
              contact_id = $2::uuid,
              campaign_contact_id = $3::uuid,
              task_id = $4::uuid,
              processed_at = $5::timestamptz
        where id = $1::uuid`,
      [input.callId, contactId, campaignContactId, taskId, input.processedAt]
    );
  }

  async markSettled(input: {
    readonly callId: string;
    readonly status: "ignored" | "unparsed";
    readonly processedAt: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await this.markSettledIn(connection, input);
    } finally {
      connection.release();
    }
  }

  private async markSettledIn(
    executor: SqlExecutor,
    input: {
      readonly callId: string;
      readonly status: "ignored" | "unparsed";
      readonly processedAt: Date;
    }
  ): Promise<void> {
    await executor.query(
      `update public.zvonobot_calls
          set status = $2::text,
              processed_at = $3::timestamptz
        where id = $1::uuid
          and status = 'pending'`,
      [input.callId, input.status, input.processedAt]
    );
  }
}

export function createZvonobotIntakePersistence(pool: SqlConnectionPool) {
  return { repository: new PostgresZvonobotIntakeRepository(pool) } as const;
}

export function createZvonobotProcessingPersistence(pool: SqlConnectionPool) {
  const session = new TransactionSession();
  const repository = new PostgresZvonobotProcessingRepository(session, pool);
  const unitOfWork = new PostgresUnitOfWork(pool, session);

  // Заявка заводится целиком или не заводится: транзакция оборачивает только её, а отметки
  // «не заявка» идут отдельными запросами — им нечего терять.
  return {
    repository: {
      loadSettings: () => repository.loadSettings(),
      findCampaign: (slugPrefix: string) => repository.findCampaign(slugPrefix),
      claimPending: (batchSize: number) => repository.claimPending(batchSize),
      createLead: (input: ZvonobotLeadToCreate) =>
        unitOfWork.transact(() => repository.createLead(input)),
      markSettled: (input: {
        readonly callId: string;
        readonly status: "ignored" | "unparsed";
        readonly processedAt: Date;
      }) => repository.markSettled(input)
    } satisfies ZvonobotProcessingRepository
  } as const;
}
