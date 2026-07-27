import type {
  IdGenerator,
  QuestionnaireDraft,
  QuestionnaireDraftRepository,
  QuestionnaireFocusArea,
  QuestionnaireResponseRepository,
  QuestionnaireStage,
  QuestionnaireStep,
  SaveQuestionnaireResponseInput
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

/**
 * Same pattern as telegram-purchase-flow-persistence.ts's purchase draft: the in-progress
 * questionnaire lives in `users.metadata` (nested under `participantQuestionnaireDraft`), not a
 * new table — it is disposable per-user single-writer state. The completed answers are durable
 * business data, so they land in `participant_questionnaire_responses`
 * (20260728090000_participant_engagement.sql) once the last question is answered.
 */
interface DraftRow {
  readonly order_id: string | null;
  readonly event_id: string | null;
  readonly step: string | null;
  readonly name: string | null;
  readonly city: string | null;
  readonly niche: string | null;
  readonly stage: string | null;
  readonly wish: string | null;
  readonly focus_area: string | null;
  readonly started_at: string | null;
}

export class PostgresQuestionnaireDraftRepository implements QuestionnaireDraftRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async getDraft(userId: string): Promise<QuestionnaireDraft | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<DraftRow>(
        `select
           metadata #>> '{participantQuestionnaireDraft,orderId}' as order_id,
           metadata #>> '{participantQuestionnaireDraft,eventId}' as event_id,
           metadata #>> '{participantQuestionnaireDraft,step}' as step,
           metadata #>> '{participantQuestionnaireDraft,name}' as name,
           metadata #>> '{participantQuestionnaireDraft,city}' as city,
           metadata #>> '{participantQuestionnaireDraft,niche}' as niche,
           metadata #>> '{participantQuestionnaireDraft,stage}' as stage,
           metadata #>> '{participantQuestionnaireDraft,wish}' as wish,
           metadata #>> '{participantQuestionnaireDraft,focusArea}' as focus_area,
           metadata #>> '{participantQuestionnaireDraft,startedAt}' as started_at
         from public.users
         where id = $1`,
        [userId]
      );
      const row = result.rows[0];
      return row ? toDraft(row) : null;
    } finally {
      connection.release();
    }
  }

  async setDraft(userId: string, draft: QuestionnaireDraft): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.users
         set metadata = jsonb_set(metadata, '{participantQuestionnaireDraft}', $2::jsonb, true),
             updated_at = now()
         where id = $1`,
        [userId, JSON.stringify(draft)]
      );
    } finally {
      connection.release();
    }
  }

  async clearDraft(userId: string): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.users
         set metadata = metadata - 'participantQuestionnaireDraft',
             updated_at = now()
         where id = $1`,
        [userId]
      );
    } finally {
      connection.release();
    }
  }
}

export class PostgresQuestionnaireResponseRepository implements QuestionnaireResponseRepository {
  constructor(
    private readonly pool: SqlConnectionPool,
    private readonly idGenerator: IdGenerator
  ) {}

  async saveResponse(input: SaveQuestionnaireResponseInput): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `insert into public.participant_questionnaire_responses (
           id, order_id, user_id, event_id, name, city, niche, stage, wish, focus_area,
           join_chat, completed_at, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         on conflict (order_id) do nothing`,
        [
          this.idGenerator.newId(),
          input.orderId,
          input.userId,
          input.eventId,
          input.name,
          input.city,
          input.niche,
          input.stage,
          input.wish,
          input.focusArea,
          input.joinChat,
          input.completedAt
        ]
      );
    } finally {
      connection.release();
    }
  }
}

export function createParticipantQuestionnairePersistence(
  pool: SqlConnectionPool,
  idGenerator: IdGenerator
) {
  return {
    questionnaireDraftRepository: new PostgresQuestionnaireDraftRepository(pool),
    questionnaireResponseRepository: new PostgresQuestionnaireResponseRepository(pool, idGenerator)
  } as const;
}

function toDraft(row: DraftRow): QuestionnaireDraft | null {
  if (!row.order_id || !row.event_id || !row.step || !row.started_at) {
    return null;
  }

  return {
    orderId: row.order_id,
    eventId: row.event_id,
    step: row.step as QuestionnaireStep,
    name: row.name,
    city: row.city,
    niche: row.niche,
    stage: row.stage as QuestionnaireStage | null,
    wish: row.wish,
    focusArea: row.focus_area as QuestionnaireFocusArea | null,
    startedAt: row.started_at
  };
}
