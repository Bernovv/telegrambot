import type { TelegramUserResolver } from "./phone.js";

/**
 * The 7-question participant questionnaire (docs/bots/BOT_FLOWS.md "После оплаты" → "Анкета
 * участника" — designed there but never implemented in either bot). Fires once per paid order;
 * `start()` is called by the notification worker right after PaymentConfirmed (see
 * ParticipantQuestionnaireRequested in payment-confirmation.ts), the rest is driven by chat
 * messages/button taps exactly like TelegramPurchaseFlowService in telegram-purchase-flow.ts —
 * same in-progress-draft-in-users.metadata pattern, same reuse of TelegramUserResolver.
 */

export type QuestionnaireStep =
  | "awaiting_name"
  | "awaiting_city"
  | "awaiting_niche"
  | "awaiting_stage"
  | "awaiting_wish"
  | "awaiting_focus_area"
  | "awaiting_join_chat";

export type QuestionnaireStage =
  | "only_building_product"
  | "have_product_or_service"
  | "have_clients_want_structure"
  | "want_more_sales"
  | "want_environment_reset";

export type QuestionnaireFocusArea =
  | "packaging"
  | "content"
  | "sales"
  | "positioning"
  | "energy_resource"
  | "environment";

export interface QuestionnaireDraft {
  readonly orderId: string;
  readonly eventId: string;
  readonly step: QuestionnaireStep;
  readonly name: string | null;
  readonly city: string | null;
  readonly niche: string | null;
  readonly stage: QuestionnaireStage | null;
  readonly wish: string | null;
  readonly focusArea: QuestionnaireFocusArea | null;
  readonly startedAt: string;
}

export interface QuestionnaireDraftRepository {
  getDraft(userId: string): Promise<QuestionnaireDraft | null>;
  setDraft(userId: string, draft: QuestionnaireDraft): Promise<void>;
  clearDraft(userId: string): Promise<void>;
}

export interface SaveQuestionnaireResponseInput {
  readonly orderId: string;
  readonly userId: string;
  readonly eventId: string;
  readonly name: string;
  readonly city: string;
  readonly niche: string;
  readonly stage: QuestionnaireStage;
  readonly wish: string;
  readonly focusArea: QuestionnaireFocusArea;
  readonly joinChat: boolean;
  readonly completedAt: Date;
}

export interface QuestionnaireResponseRepository {
  saveResponse(input: SaveQuestionnaireResponseInput): Promise<void>;
}

export type QuestionnaireFlowResult =
  | { readonly kind: "ask_name" }
  | { readonly kind: "ask_city" }
  | { readonly kind: "ask_niche" }
  | { readonly kind: "ask_stage" }
  | { readonly kind: "ask_wish" }
  | { readonly kind: "ask_focus_area" }
  | { readonly kind: "ask_join_chat" }
  | { readonly kind: "invalid_text" }
  | { readonly kind: "completed" }
  | { readonly kind: "no_active_draft" };

const FIELD_LIMITS = {
  name: 200,
  city: 200,
  niche: 500,
  wish: 1000
} as const;

/**
 * Shared by TelegramQuestionnaireService.start() and the notification worker (which needs to
 * initialize the draft from an internal userId, without depending on TelegramUserResolver or
 * QuestionnaireResponseRepository just to do that one thing) — see notification-delivery.ts.
 */
export async function startQuestionnaireDraft(
  draftRepository: QuestionnaireDraftRepository,
  input: {
    readonly orderId: string;
    readonly userId: string;
    readonly eventId: string;
    readonly now: Date;
  }
): Promise<{ readonly alreadyStarted: boolean }> {
  const existing = await draftRepository.getDraft(input.userId);
  if (existing) {
    return { alreadyStarted: true };
  }

  await draftRepository.setDraft(input.userId, {
    orderId: input.orderId,
    eventId: input.eventId,
    step: "awaiting_name",
    name: null,
    city: null,
    niche: null,
    stage: null,
    wish: null,
    focusArea: null,
    startedAt: input.now.toISOString()
  });

  return { alreadyStarted: false };
}

export class TelegramQuestionnaireService {
  constructor(
    private readonly draftRepository: QuestionnaireDraftRepository,
    private readonly responseRepository: QuestionnaireResponseRepository,
    private readonly telegramUserResolver: TelegramUserResolver
  ) {}

  /** Called by the worker (internal userId already known from the paid order), not from chat. */
  async start(input: {
    readonly orderId: string;
    readonly userId: string;
    readonly eventId: string;
    readonly now: Date;
  }): Promise<{ readonly alreadyStarted: boolean }> {
    return startQuestionnaireDraft(this.draftRepository, input);
  }

  async handleText(externalUserId: string, text: string, now: Date): Promise<QuestionnaireFlowResult> {
    void now;
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (!draft) {
      return { kind: "no_active_draft" };
    }

    switch (draft.step) {
      case "awaiting_name": {
        const value = normalizeText(text, FIELD_LIMITS.name);
        if (!value) {
          return { kind: "invalid_text" };
        }
        await this.draftRepository.setDraft(userId, { ...draft, name: value, step: "awaiting_city" });
        return { kind: "ask_city" };
      }
      case "awaiting_city": {
        const value = normalizeText(text, FIELD_LIMITS.city);
        if (!value) {
          return { kind: "invalid_text" };
        }
        await this.draftRepository.setDraft(userId, { ...draft, city: value, step: "awaiting_niche" });
        return { kind: "ask_niche" };
      }
      case "awaiting_niche": {
        const value = normalizeText(text, FIELD_LIMITS.niche);
        if (!value) {
          return { kind: "invalid_text" };
        }
        await this.draftRepository.setDraft(userId, { ...draft, niche: value, step: "awaiting_stage" });
        return { kind: "ask_stage" };
      }
      case "awaiting_wish": {
        const value = normalizeText(text, FIELD_LIMITS.wish);
        if (!value) {
          return { kind: "invalid_text" };
        }
        await this.draftRepository.setDraft(userId, { ...draft, wish: value, step: "awaiting_focus_area" });
        return { kind: "ask_focus_area" };
      }
      default:
        // Stage/focus-area/join-chat are button-only steps; stray free text is silently ignored,
        // matching TelegramPurchaseFlowService's convention for the shared message:text handler.
        return { kind: "no_active_draft" };
    }
  }

  async handleStageChoice(
    externalUserId: string,
    stage: QuestionnaireStage
  ): Promise<QuestionnaireFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (!draft || draft.step !== "awaiting_stage") {
      return { kind: "no_active_draft" };
    }

    await this.draftRepository.setDraft(userId, { ...draft, stage, step: "awaiting_wish" });
    return { kind: "ask_wish" };
  }

  async handleFocusAreaChoice(
    externalUserId: string,
    focusArea: QuestionnaireFocusArea
  ): Promise<QuestionnaireFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (!draft || draft.step !== "awaiting_focus_area") {
      return { kind: "no_active_draft" };
    }

    await this.draftRepository.setDraft(userId, { ...draft, focusArea, step: "awaiting_join_chat" });
    return { kind: "ask_join_chat" };
  }

  async handleJoinChatChoice(
    externalUserId: string,
    joinChat: boolean,
    now: Date
  ): Promise<QuestionnaireFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (
      !draft
      || draft.step !== "awaiting_join_chat"
      || !draft.name
      || !draft.city
      || !draft.niche
      || !draft.stage
      || !draft.wish
      || !draft.focusArea
    ) {
      return { kind: "no_active_draft" };
    }

    await this.responseRepository.saveResponse({
      orderId: draft.orderId,
      userId,
      eventId: draft.eventId,
      name: draft.name,
      city: draft.city,
      niche: draft.niche,
      stage: draft.stage,
      wish: draft.wish,
      focusArea: draft.focusArea,
      joinChat,
      completedAt: now
    });
    await this.draftRepository.clearDraft(userId);

    return { kind: "completed" };
  }
}

function normalizeText(text: string, maxLength: number): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 1 || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}
