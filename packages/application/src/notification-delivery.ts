import { setTimeout as sleep } from "node:timers/promises";
import type { ScenarioPresentationModel } from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";
import { startQuestionnaireDraft, type QuestionnaireDraftRepository } from "./participant-questionnaire.js";

export type NotificationDeliveryKind =
  | "ticket_user"
  | "admin_purchase"
  | "questionnaire_prompt"
  | "event_reminder"
  | "admin_broadcast";

export interface TicketDeliveryContext {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly eventTitle: string;
  readonly recipientExternalUserId: string | null;
  readonly recipientBlocked: boolean;
  readonly tickets: readonly {
    readonly id: string;
    readonly ticketNumber: string;
  }[];
}

export interface AdminPurchaseContext {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly userId: string;
  readonly eventTitle: string;
  readonly username: string | null;
  readonly phone: string | null;
  readonly ticketCount: number;
  readonly totalKopecks: bigint;
  readonly walletKopecks: bigint;
  readonly externalKopecks: bigint;
}

export interface ScenarioDeliveryContext {
  readonly recipientExternalUserId: string | null;
  readonly recipientBlocked: boolean;
}

export interface QuestionnaireIntroContext {
  readonly recipientExternalUserId: string | null;
  readonly recipientBlocked: boolean;
  readonly eventTitle: string;
}

export interface QuestionnaireIntroContextRepository {
  getQuestionnaireIntroContext(orderId: string): Promise<QuestionnaireIntroContext | null>;
}

export interface ReminderRecipientContext {
  readonly recipientExternalUserId: string | null;
  readonly recipientBlocked: boolean;
  readonly eventTitle: string;
}

export interface ReminderContextRepository {
  getReminderContext(userId: string, eventId: string): Promise<ReminderRecipientContext | null>;
}

export interface BroadcastRecipient {
  // Пробная рассылка уходит в административные чаты, за которыми не стоит участник, поэтому
  // получатель бывает без userId. Ключ идемпотентности тогда строится по номеру чата.
  readonly userId: string | null;
  readonly recipientExternalUserId: string;
}

export interface BroadcastImage {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png" | "image/jpeg";
}

export interface BroadcastLinkButton {
  readonly text: string;
  readonly url: string;
}

export interface BroadcastContext {
  readonly messageText: string;
  readonly isTest: boolean;
  readonly image: BroadcastImage | null;
  readonly button: BroadcastLinkButton | null;
  readonly recipients: readonly BroadcastRecipient[];
}

export interface BroadcastContextRepository {
  getBroadcastContext(broadcastId: string): Promise<BroadcastContext | null>;
  markBroadcastSending(broadcastId: string, startedAt: Date): Promise<void>;
  markBroadcastCompleted(
    broadcastId: string,
    sentCount: number,
    failedCount: number,
    completedAt: Date
  ): Promise<void>;
  markRecipientBlocked(userId: string): Promise<void>;
}

export interface BroadcastPacing {
  /** Пауза между сообщениями и перед повтором. */
  wait(milliseconds: number): Promise<void>;
}

export interface BroadcastDeliveryOptions {
  /** Сколько сообщений в секунду отдаём в Telegram. */
  readonly messagesPerSecond: number;
  /** Сколько раз повторяем отправку одному получателю при временной ошибке. */
  readonly transientAttempts: number;
  /**
   * Сколько получателей подряд может упасть с временной ошибкой, прежде чем мы признаём это
   * не единичным сбоем, а недоступностью Telegram, и отдаём задачу очереди на повтор целиком.
   */
  readonly transientFailureStreakLimit: number;
}

export const DEFAULT_BROADCAST_DELIVERY_OPTIONS: BroadcastDeliveryOptions = {
  messagesPerSecond: 20,
  transientAttempts: 3,
  transientFailureStreakLimit: 10
};

export const realTimePacing: BroadcastPacing = {
  async wait(milliseconds: number): Promise<void> {
    if (milliseconds > 0) {
      await sleep(milliseconds);
    }
  }
};

export interface NotificationContextRepository {
  getTicketDeliveryContext(
    orderId: string,
    ticketIds: readonly string[],
    ownerUserId: string | null
  ): Promise<TicketDeliveryContext | null>;
  getAdminPurchaseContext(orderId: string): Promise<AdminPurchaseContext | null>;
  getScenarioDeliveryContext(userId: string): Promise<ScenarioDeliveryContext | null>;
}

export interface ClaimNotificationDeliveryInput {
  readonly deliveryId: string;
  readonly idempotencyKey: string;
  readonly sourceEventId: string;
  readonly kind: NotificationDeliveryKind;
  readonly aggregateId: string;
  readonly recipientId: string;
  readonly workerId: string;
  readonly claimedAt: Date;
  readonly leaseSeconds: number;
}

export type ClaimNotificationDeliveryResult =
  | { readonly state: "claimed"; readonly deliveryId: string }
  | { readonly state: "sent"; readonly deliveryId: string }
  | { readonly state: "busy"; readonly deliveryId: string };

export interface NotificationDeliveryLedger {
  claim(input: ClaimNotificationDeliveryInput): Promise<ClaimNotificationDeliveryResult>;
  markSent(
    deliveryId: string,
    workerId: string,
    providerMessageId: string,
    sentAt: Date
  ): Promise<void>;
  markFailed(
    deliveryId: string,
    workerId: string,
    errorCode: string,
    failedAt: Date
  ): Promise<void>;
}

export interface TextNotificationSender {
  sendText(
    recipientId: string,
    text: string
  ): Promise<{ readonly providerMessageId: string }>;
}

export interface TicketPng {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
}

export interface TicketPngRenderer {
  renderPng(publicToken: string): Promise<TicketPng>;
}

export interface BroadcastMessage {
  readonly text: string;
  readonly image: BroadcastImage | null;
  readonly button: BroadcastLinkButton | null;
}

export interface NotificationSender extends TextNotificationSender {
  /**
   * Сообщение рассылки: текст, при наличии картинки — подписью к ней, и одна кнопка-ссылка.
   * Отдельный метод, а не флаги у sendText: у фотографии другой предел длины и другой вызов
   * Telegram, и путать их с обычным текстовым уведомлением нечем.
   */
  sendBroadcastMessage(
    recipientId: string,
    message: BroadcastMessage
  ): Promise<{ readonly providerMessageId: string }>;
  sendImage(
    recipientId: string,
    image: TicketPng,
    fileName: string,
    caption: string
  ): Promise<{ readonly providerMessageId: string }>;
  sendScenarioPresentation(
    recipientId: string,
    sessionId: string,
    presentation: ScenarioPresentationModel
  ): Promise<{ readonly providerMessageId: string }>;
}

export interface ScenarioPaymentContinuation {
  execute(input: {
    readonly orderId: string;
    readonly sourceEventId: string;
    readonly occurredAt: Date;
  }): Promise<unknown>;
}

export interface TicketPublicTokenGenerator {
  publicToken(ticketId: string): { readonly token: string };
}

export interface HandleNotificationJobInput {
  readonly job: unknown;
  readonly workerId: string;
  readonly handledAt: Date;
  readonly leaseSeconds: number;
}

export interface HandleNotificationJobResult {
  readonly eventType: string;
  readonly delivered: number;
  readonly duplicates: number;
  readonly ignored: boolean;
  /** Заполняется только рассылкой: получатели, которым отправить не удалось. */
  readonly failed?: number;
}

export type BroadcastSendFailure =
  /** Человек заблокировал бота — исключаем его из будущих рассылок. */
  | { readonly kind: "blocked" }
  /** Чата больше нет или аккаунт удалён — повторять бессмысленно, но и флаг ставить не за что. */
  | { readonly kind: "unreachable" }
  /** Лимит, сеть, пятисотка — можно повторить, при 429 Telegram сам говорит через сколько. */
  | { readonly kind: "transient"; readonly retryAfterSeconds: number | null };

/**
 * Разбирает ошибку отправки, не завися от grammy: у её `GrammyError` поля `error_code`,
 * `description` и `parameters.retry_after` лежат прямо на объекте ошибки — ровно так, как их
 * вернул Telegram. Всё, что не опознали (сеть, таймаут, пятисотка), считаем временным:
 * ошибочно счесть сбой постоянным — значит молча не доставить сообщение.
 */
export function classifyBroadcastSendFailure(error: unknown): BroadcastSendFailure {
  const record = error as Record<string, unknown> | null | undefined;
  const code = typeof record?.error_code === "number" ? record.error_code : null;
  const description =
    typeof record?.description === "string" ? record.description.toLowerCase() : "";

  if (code === 429) {
    return { kind: "transient", retryAfterSeconds: retryAfterSeconds(record) };
  }
  if (code === 403) {
    return /blocked|kicked/.test(description)
      ? { kind: "blocked" }
      : { kind: "unreachable" };
  }
  if (
    code === 400
    && /chat not found|user not found|peer_id_invalid|chat_id is empty/.test(description)
  ) {
    return { kind: "unreachable" };
  }
  return { kind: "transient", retryAfterSeconds: null };
}

function retryAfterSeconds(record: Record<string, unknown> | null | undefined): number | null {
  const parameters = record?.parameters;
  if (typeof parameters !== "object" || parameters === null) {
    return null;
  }
  const value = (parameters as Record<string, unknown>).retry_after;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.ceil(value), 300)
    : null;
}

type NotificationEvent =
  | {
      readonly eventType: "TicketsIssued";
      readonly sourceEventId: string;
      readonly orderId: string;
      readonly ticketIds: readonly string[];
      readonly ownerUserId: string | null;
    }
  | {
      readonly eventType: "TicketRedeliveryRequested";
      readonly sourceEventId: string;
      readonly orderId: string;
      readonly ticketIds: readonly string[];
      readonly ownerUserId: string;
    }
  | {
      readonly eventType: "AdminPurchaseNotificationRequested";
      readonly sourceEventId: string;
      readonly orderId: string;
    }
  | {
      readonly eventType: "PaymentConfirmed";
      readonly sourceEventId: string;
      readonly orderId: string;
      readonly occurredAt: Date;
    }
  | {
      readonly eventType: "ScenarioPresentationRequested";
      readonly sourceEventId: string;
      readonly sessionId: string;
      readonly userId: string;
      readonly presentations: readonly ScenarioPresentationModel[];
    }
  | {
      readonly eventType: "ParticipantQuestionnaireRequested";
      readonly sourceEventId: string;
      readonly orderId: string;
      readonly userId: string;
      readonly eventId: string;
    }
  | {
      readonly eventType: "EventReminderDue";
      readonly sourceEventId: string;
      readonly orderId: string;
      readonly userId: string;
      readonly eventId: string;
      readonly cadenceStep: string;
    }
  | {
      readonly eventType: "AdminBroadcastRequested";
      readonly sourceEventId: string;
      readonly broadcastId: string;
    }
  | {
      readonly eventType: string;
      readonly sourceEventId: string;
      readonly ignored: true;
    };

export class HandleNotificationJobService {
  constructor(
    private readonly contexts: NotificationContextRepository,
    private readonly ledger: NotificationDeliveryLedger,
    private readonly sender: NotificationSender,
    private readonly ticketTokens: TicketPublicTokenGenerator,
    private readonly ticketRenderer: TicketPngRenderer,
    private readonly idGenerator: IdGenerator,
    private readonly adminChatIds: readonly string[],
    private readonly scenarioPaymentContinuation?: ScenarioPaymentContinuation,
    private readonly questionnaireContexts?: QuestionnaireIntroContextRepository,
    private readonly questionnaireDrafts?: QuestionnaireDraftRepository,
    private readonly reminderContexts?: ReminderContextRepository,
    private readonly broadcastContexts?: BroadcastContextRepository,
    private readonly broadcastOptions: BroadcastDeliveryOptions =
      DEFAULT_BROADCAST_DELIVERY_OPTIONS,
    private readonly broadcastPacing: BroadcastPacing = realTimePacing
  ) {
    if (adminChatIds.length === 0) {
      throw new Error("Administrator notification chat ID is invalid");
    }
    for (const chatId of adminChatIds) {
      if (!/^-?\d{1,20}$/.test(chatId)) {
        throw new Error("Administrator notification chat ID is invalid");
      }
    }
  }

  async execute(input: HandleNotificationJobInput): Promise<HandleNotificationJobResult> {
    validateExecutionInput(input);
    const event = parseNotificationEvent(input.job);

    if ("ignored" in event) {
      return {
        eventType: event.eventType,
        delivered: 0,
        duplicates: 0,
        ignored: true
      };
    }

    if (event.eventType === "PaymentConfirmed") {
      if (!this.scenarioPaymentContinuation) {
        return {
          eventType: event.eventType,
          delivered: 0,
          duplicates: 0,
          ignored: true
        };
      }
      await this.scenarioPaymentContinuation.execute({
        orderId: event.orderId,
        sourceEventId: event.sourceEventId,
        occurredAt: event.occurredAt
      });
      return {
        eventType: event.eventType,
        delivered: 0,
        duplicates: 0,
        ignored: false
      };
    }
    if (event.eventType === "ScenarioPresentationRequested") {
      return this.deliverScenarioPresentations(event, input);
    }
    if (event.eventType === "TicketsIssued") {
      return this.deliverTickets(event, input);
    }
    if (event.eventType === "TicketRedeliveryRequested") {
      return this.deliverTickets(event, input);
    }
    if (event.eventType === "ParticipantQuestionnaireRequested") {
      return this.deliverQuestionnairePrompt(event, input);
    }
    if (event.eventType === "EventReminderDue") {
      return this.deliverEventReminder(event, input);
    }
    if (event.eventType === "AdminBroadcastRequested") {
      return this.deliverAdminBroadcast(event, input);
    }

    return this.deliverAdminPurchase(event, input);
  }

  private async deliverScenarioPresentations(
    event: Extract<
      NotificationEvent,
      { readonly eventType: "ScenarioPresentationRequested" }
    >,
    input: HandleNotificationJobInput
  ): Promise<HandleNotificationJobResult> {
    const context = await this.contexts.getScenarioDeliveryContext(event.userId);
    const recipientId = context?.recipientExternalUserId;
    if (!context || !recipientId || context.recipientBlocked) {
      throw new Error("Telegram scenario recipient is unavailable");
    }

    let delivered = 0;
    let duplicates = 0;
    for (const [index, presentation] of event.presentations.entries()) {
      const result = await this.deliverOnce({
        event,
        input,
        kind: "ticket_user",
        aggregateId: event.sessionId,
        recipientId,
        idempotencyKey:
          `telegram:scenario:${event.sourceEventId}:${index}`,
        send: () => this.sender.sendScenarioPresentation(
          recipientId,
          event.sessionId,
          presentation
        )
      });
      delivered += result === "delivered" ? 1 : 0;
      duplicates += result === "duplicate" ? 1 : 0;
    }

    return {
      eventType: event.eventType,
      delivered,
      duplicates,
      ignored: false
    };
  }

  private async deliverTickets(
    event: Extract<
      NotificationEvent,
      { readonly eventType: "TicketsIssued" | "TicketRedeliveryRequested" }
    >,
    input: HandleNotificationJobInput
  ): Promise<HandleNotificationJobResult> {
    const context = await this.contexts.getTicketDeliveryContext(
      event.orderId,
      event.ticketIds,
      event.ownerUserId
    );
    if (!context) {
      throw new Error("Ticket delivery context was not found");
    }
    const recipientId = context.recipientExternalUserId;
    if (!recipientId || context.recipientBlocked) {
      throw new Error("Telegram ticket recipient is unavailable");
    }
    assertTicketSet(event.ticketIds, context.tickets);

    // Одно сообщение на заказ, а не по одному на каждое место: человеку нужно подтверждение
    // оплаты, а не N одинаковых писем. QR-картинку не отправляем — по решению заказчика
    // Telegram ведёт себя так же, как MAX, где билетов-картинок нет. Записи билетов в базе
    // остаются: по ним строятся списки участников и выгрузка.
    const first = context.tickets[0];
    if (!first) {
      throw new Error("Ticket delivery context has no tickets");
    }
    const result = await this.deliverOnce({
      event,
      input,
      kind: "ticket_user",
      aggregateId: first.id,
      recipientId,
      idempotencyKey: event.eventType === "TicketsIssued"
        ? `telegram:order-paid:${event.orderId}`
        : `telegram:order-paid-redelivery:${event.sourceEventId}:${event.orderId}`,
      send: async () => this.sender.sendText(
        recipientId,
        formatPaymentConfirmedMessage(
          context,
          event.eventType === "TicketRedeliveryRequested"
        )
      )
    });
    const delivered = result === "delivered" ? 1 : 0;
    const duplicates = result === "duplicate" ? 1 : 0;

    return {
      eventType: event.eventType,
      delivered,
      duplicates,
      ignored: false
    };
  }

  private async deliverAdminPurchase(
    event: Extract<
      NotificationEvent,
      { readonly eventType: "AdminPurchaseNotificationRequested" }
    >,
    input: HandleNotificationJobInput
  ): Promise<HandleNotificationJobResult> {
    const context = await this.contexts.getAdminPurchaseContext(event.orderId);
    if (!context) {
      throw new Error("Administrator purchase context was not found");
    }

    let delivered = 0;
    let duplicates = 0;
    for (const chatId of this.adminChatIds) {
      const result = await this.deliverOnce({
        event,
        input,
        kind: "admin_purchase",
        aggregateId: event.orderId,
        recipientId: chatId,
        idempotencyKey: `telegram:admin-purchase:${event.sourceEventId}:${chatId}`,
        send: () => this.sender.sendText(
          chatId,
          formatAdminPurchaseMessage(context)
        )
      });
      delivered += result === "delivered" ? 1 : 0;
      duplicates += result === "duplicate" ? 1 : 0;
    }

    return {
      eventType: event.eventType,
      delivered,
      duplicates,
      ignored: false
    };
  }

  private async deliverQuestionnairePrompt(
    event: Extract<NotificationEvent, { readonly eventType: "ParticipantQuestionnaireRequested" }>,
    input: HandleNotificationJobInput
  ): Promise<HandleNotificationJobResult> {
    if (!this.questionnaireContexts || !this.questionnaireDrafts) {
      return { eventType: event.eventType, delivered: 0, duplicates: 0, ignored: true };
    }

    const context = await this.questionnaireContexts.getQuestionnaireIntroContext(event.orderId);
    if (!context) {
      throw new Error("Questionnaire intro context was not found");
    }
    const recipientId = context.recipientExternalUserId;
    if (!recipientId || context.recipientBlocked) {
      throw new Error("Telegram questionnaire recipient is unavailable");
    }
    const draftRepository = this.questionnaireDrafts;

    const result = await this.deliverOnce({
      event,
      input,
      kind: "questionnaire_prompt",
      aggregateId: event.orderId,
      recipientId,
      idempotencyKey: `telegram:questionnaire:${event.orderId}`,
      send: async () => {
        const { alreadyStarted } = await startQuestionnaireDraft(draftRepository, {
          orderId: event.orderId,
          userId: event.userId,
          eventId: event.eventId,
          now: input.handledAt
        });
        if (alreadyStarted) {
          return { providerMessageId: "already-started" };
        }
        return this.sender.sendText(recipientId, formatQuestionnaireIntroMessage(context.eventTitle));
      }
    });

    return {
      eventType: event.eventType,
      delivered: result === "delivered" ? 1 : 0,
      duplicates: result === "duplicate" ? 1 : 0,
      ignored: false
    };
  }

  private async deliverEventReminder(
    event: Extract<NotificationEvent, { readonly eventType: "EventReminderDue" }>,
    input: HandleNotificationJobInput
  ): Promise<HandleNotificationJobResult> {
    if (!this.reminderContexts || !isReminderCadenceStep(event.cadenceStep)) {
      return { eventType: event.eventType, delivered: 0, duplicates: 0, ignored: true };
    }

    const context = await this.reminderContexts.getReminderContext(event.userId, event.eventId);
    if (!context) {
      throw new Error("Event reminder context was not found");
    }
    const recipientId = context.recipientExternalUserId;
    if (!recipientId || context.recipientBlocked) {
      throw new Error("Telegram event reminder recipient is unavailable");
    }
    const cadenceStep = event.cadenceStep;

    const result = await this.deliverOnce({
      event,
      input,
      kind: "event_reminder",
      aggregateId: event.orderId,
      recipientId,
      idempotencyKey: `telegram:reminder:${event.orderId}:${cadenceStep}`,
      send: () => this.sender.sendText(
        recipientId,
        formatEventReminderMessage(cadenceStep, context.eventTitle)
      )
    });

    return {
      eventType: event.eventType,
      delivered: result === "delivered" ? 1 : 0,
      duplicates: result === "duplicate" ? 1 : 0,
      ignored: false
    };
  }

  private async deliverAdminBroadcast(
    event: Extract<NotificationEvent, { readonly eventType: "AdminBroadcastRequested" }>,
    input: HandleNotificationJobInput
  ): Promise<HandleNotificationJobResult> {
    if (!this.broadcastContexts) {
      return { eventType: event.eventType, delivered: 0, duplicates: 0, ignored: true };
    }
    const broadcasts = this.broadcastContexts;

    const context = await broadcasts.getBroadcastContext(event.broadcastId);
    if (!context) {
      throw new Error("Admin broadcast context was not found");
    }
    validateBroadcastMessage(context.messageText, context.image !== null);

    // Пробный прогон не ходит в аудиторию: получатели — административные чаты из конфигурации,
    // те же, куда приходят уведомления о покупках.
    const recipients = context.isTest
      ? this.adminChatIds.map((chatId) => ({
          userId: null,
          recipientExternalUserId: chatId
        }))
      : context.recipients;

    await broadcasts.markBroadcastSending(event.broadcastId, input.handledAt);

    const pauseMs = Math.ceil(1_000 / this.broadcastOptions.messagesPerSecond);
    let delivered = 0;
    let duplicates = 0;
    let failed = 0;
    let transientStreak = 0;

    for (const [index, recipient] of recipients.entries()) {
      if (index > 0) {
        await this.broadcastPacing.wait(pauseMs);
      }
      const outcome = await this.deliverBroadcastToRecipient(
        event,
        input,
        {
          text: context.messageText,
          image: context.image,
          button: context.button
        },
        recipient
      );

      if (outcome === "delivered" || outcome === "duplicate") {
        transientStreak = 0;
        delivered += outcome === "delivered" ? 1 : 0;
        duplicates += outcome === "duplicate" ? 1 : 0;
        continue;
      }

      failed += 1;
      if (outcome === "blocked" && recipient.userId) {
        await broadcasts.markRecipientBlocked(recipient.userId);
      }
      if (outcome !== "transient") {
        transientStreak = 0;
        continue;
      }

      // Одна временная ошибка — не повод хоронить кампанию, поэтому получатель просто уходит
      // в failed_count. А вот подряд идущие означают, что Telegram недоступен целиком: тогда
      // бросаем, очередь повторит задачу позже, а уже отправленные пропустит по идемпотентности.
      transientStreak += 1;
      if (transientStreak >= this.broadcastOptions.transientFailureStreakLimit) {
        throw new Error("Admin broadcast aborted: Telegram is not accepting messages");
      }
    }

    await broadcasts.markBroadcastCompleted(
      event.broadcastId,
      delivered + duplicates,
      failed,
      input.handledAt
    );

    return {
      eventType: event.eventType,
      delivered,
      duplicates,
      failed,
      ignored: false
    };
  }

  private async deliverBroadcastToRecipient(
    event: Extract<NotificationEvent, { readonly eventType: "AdminBroadcastRequested" }>,
    input: HandleNotificationJobInput,
    message: BroadcastMessage,
    recipient: BroadcastRecipient
  ): Promise<"delivered" | "duplicate" | "blocked" | "unreachable" | "transient"> {
    const idempotencyKey = `telegram:broadcast:${event.broadcastId}:${
      recipient.userId ?? `chat:${recipient.recipientExternalUserId}`
    }`;

    for (let attempt = 1; attempt <= this.broadcastOptions.transientAttempts; attempt += 1) {
      try {
        return await this.deliverOnce({
          event,
          input,
          kind: "admin_broadcast",
          aggregateId: event.broadcastId,
          recipientId: recipient.recipientExternalUserId,
          idempotencyKey,
          send: () =>
            this.sender.sendBroadcastMessage(recipient.recipientExternalUserId, message)
        });
      } catch (error) {
        const failure = classifyBroadcastSendFailure(error);
        if (failure.kind !== "transient") {
          return failure.kind;
        }
        if (attempt === this.broadcastOptions.transientAttempts) {
          return "transient";
        }
        await this.broadcastPacing.wait(
          failure.retryAfterSeconds === null
            ? 1_000 * attempt
            : failure.retryAfterSeconds * 1_000
        );
      }
    }

    return "transient";
  }

  private async deliverOnce(options: {
    readonly event: { readonly sourceEventId: string };
    readonly input: HandleNotificationJobInput;
    readonly kind: NotificationDeliveryKind;
    readonly aggregateId: string;
    readonly recipientId: string;
    readonly idempotencyKey: string;
    readonly send: () => Promise<{ readonly providerMessageId: string }>;
  }): Promise<"delivered" | "duplicate"> {
    const claim = await this.ledger.claim({
      deliveryId: this.idGenerator.newId(),
      idempotencyKey: options.idempotencyKey,
      sourceEventId: options.event.sourceEventId,
      kind: options.kind,
      aggregateId: options.aggregateId,
      recipientId: options.recipientId,
      workerId: options.input.workerId,
      claimedAt: options.input.handledAt,
      leaseSeconds: options.input.leaseSeconds
    });

    if (claim.state === "sent") {
      return "duplicate";
    }
    if (claim.state === "busy") {
      throw new Error("Notification delivery is already leased");
    }

    try {
      const sent = await options.send();
      await this.ledger.markSent(
        claim.deliveryId,
        options.input.workerId,
        sent.providerMessageId,
        options.input.handledAt
      );
      return "delivered";
    } catch (error) {
      await this.ledger.markFailed(
        claim.deliveryId,
        options.input.workerId,
        errorCode(error),
        options.input.handledAt
      );
      throw error;
    }
  }
}





function parseNotificationEvent(input: unknown): NotificationEvent {
  const job = asRecord(input, "Notification job must be an object");
  if (job.jobType !== "domain-event" || job.schemaVersion !== 1) {
    throw new Error("Notification job envelope is invalid");
  }
  const event = asRecord(job.event, "Notification event must be an object");
  if (typeof event.type !== "string" || event.type.length < 1 || event.schemaVersion !== 1) {
    throw new Error("Notification event version is invalid");
  }
  const sourceEventId = uuid(job.correlationId, "Notification correlation ID is invalid");

  if (
    event.type !== "TicketsIssued"
    && event.type !== "TicketRedeliveryRequested"
    && event.type !== "AdminPurchaseNotificationRequested"
    && event.type !== "PaymentConfirmed"
    && event.type !== "ScenarioPresentationRequested"
    && event.type !== "ParticipantQuestionnaireRequested"
    && event.type !== "EventReminderDue"
    && event.type !== "AdminBroadcastRequested"
  ) {
    return { eventType: event.type, sourceEventId, ignored: true };
  }

  const payload = asRecord(event.payload, "Notification event payload must be an object");
  if (event.type === "ScenarioPresentationRequested") {
    return {
      eventType: event.type,
      sourceEventId,
      sessionId: uuid(payload.sessionId, "Scenario session ID is invalid"),
      userId: uuid(payload.userId, "Scenario user ID is invalid"),
      presentations: scenarioPresentations(payload.presentations)
    };
  }
  if (event.type === "AdminBroadcastRequested") {
    return {
      eventType: event.type,
      sourceEventId,
      broadcastId: uuid(payload.broadcastId, "Notification broadcast ID is invalid")
    };
  }

  const orderId = uuid(payload.orderId, "Notification order ID is invalid");

  if (event.type === "PaymentConfirmed") {
    return {
      eventType: event.type,
      sourceEventId,
      orderId,
      occurredAt: date(job.createdAt, "Notification creation time is invalid")
    };
  }

  if (event.type === "AdminPurchaseNotificationRequested") {
    return { eventType: event.type, sourceEventId, orderId };
  }

  if (event.type === "ParticipantQuestionnaireRequested") {
    return {
      eventType: event.type,
      sourceEventId,
      orderId,
      userId: uuid(payload.userId, "Notification user ID is invalid"),
      eventId: uuid(payload.eventId, "Notification event ID is invalid")
    };
  }

  if (event.type === "EventReminderDue") {
    if (typeof payload.cadenceStep !== "string" || payload.cadenceStep.length > 20) {
      throw new Error("Notification reminder cadence step is invalid");
    }
    return {
      eventType: event.type,
      sourceEventId,
      orderId,
      userId: uuid(payload.userId, "Notification user ID is invalid"),
      eventId: uuid(payload.eventId, "Notification event ID is invalid"),
      cadenceStep: payload.cadenceStep
    };
  }

  if (
    !Array.isArray(payload.ticketIds)
    || payload.ticketIds.length < 1
    || payload.ticketIds.length > 2_000
  ) {
    throw new Error("Ticket delivery IDs are invalid");
  }
  const ticketIds = payload.ticketIds.map((ticketId) =>
    uuid(ticketId, "Ticket delivery ID is invalid")
  );
  if (new Set(ticketIds).size !== ticketIds.length) {
    throw new Error("Ticket delivery IDs must be unique");
  }

  if (event.type === "TicketRedeliveryRequested") {
    return {
      eventType: event.type,
      sourceEventId,
      orderId,
      ticketIds,
      ownerUserId: uuid(payload.ownerUserId, "Ticket redelivery owner ID is invalid")
    };
  }

  return {
    eventType: event.type,
    sourceEventId,
    orderId,
    ticketIds,
    ownerUserId: null
  };
}

function scenarioPresentations(value: unknown): readonly ScenarioPresentationModel[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new Error("Scenario presentations are invalid");
  }
  return value.map((item) => {
    const presentation = asRecord(item, "Scenario presentation must be an object");
    if (
      typeof presentation.text !== "string"
      || presentation.text.length < 1
      || presentation.text.length > 4_096
      || !Array.isArray(presentation.buttons)
      || presentation.buttons.length > 20
    ) {
      throw new Error("Scenario presentation is invalid");
    }
    const buttons = presentation.buttons.map((item) => {
      const button = asRecord(item, "Scenario button must be an object");
      if (
        typeof button.text !== "string"
        || button.text.length < 1
        || button.text.length > 64
      ) {
        throw new Error("Scenario button text is invalid");
      }
      const targets = ["edgeId", "callbackData", "url"].filter(
        (key) => button[key] !== undefined
      );
      if (targets.length !== 1) {
        throw new Error("Scenario button target is invalid");
      }
      if (targets[0] === "edgeId") {
        return {
          text: button.text,
          edgeId: uuid(button.edgeId, "Scenario edge ID is invalid")
        };
      }
      if (targets[0] === "callbackData") {
        if (
          typeof button.callbackData !== "string"
          || Buffer.byteLength(button.callbackData, "utf8") > 64
          || button.callbackData.length < 1
        ) {
          throw new Error("Scenario callback data is invalid");
        }
        return { text: button.text, callbackData: button.callbackData };
      }
      if (
        typeof button.url !== "string"
        || !button.url.startsWith("https://")
        || button.url.length > 2_048
      ) {
        throw new Error("Scenario button URL is invalid");
      }
      return { text: button.text, url: button.url };
    });
    return { text: presentation.text, buttons };
  });
}

function date(value: unknown, message: string): Date {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(message);
  }
  return parsed;
}

function validateExecutionInput(input: HandleNotificationJobInput): void {
  if (!input.workerId || input.workerId.length > 200) {
    throw new Error("Notification worker ID is invalid");
  }
  if (Number.isNaN(input.handledAt.getTime())) {
    throw new Error("Notification handling time is invalid");
  }
  if (
    !Number.isSafeInteger(input.leaseSeconds)
    || input.leaseSeconds < 10
    || input.leaseSeconds > 3_600
  ) {
    throw new Error("Notification lease must be between 10 and 3600 seconds");
  }
}

function assertTicketSet(
  requestedIds: readonly string[],
  tickets: TicketDeliveryContext["tickets"]
): void {
  if (
    tickets.length !== requestedIds.length
    || tickets.some((ticket) => !requestedIds.includes(ticket.id))
  ) {
    throw new Error("Ticket delivery context requires reconciliation");
  }
}

function formatPaymentConfirmedMessage(
  context: TicketDeliveryContext,
  redelivery: boolean
): string {
  if (redelivery) {
    return [
      "Повторная отправка подтверждения.",
      `Мероприятие: ${singleLine(context.eventTitle, 200)}`,
      `Заказ: ${singleLine(context.orderNumber, 60)}`
    ].join("\n");
  }

  // Формулировка согласована с заказчиком и совпадает с MAX-ботом.
  return "Оплата прошла ✅ Билет за вами! До встречи на Бизнес-Пикнике 🏕";
}


function formatAdminPurchaseMessage(context: AdminPurchaseContext): string {
  const buyer = context.username
    ? `@${singleLine(context.username.replace(/^@/, ""), 64)}`
    : `Пользователь ${context.userId}`;

  return [
    `${buyer} купил ${context.ticketCount} билет(а) на сумму ${formatKopecks(context.totalKopecks)}.`,
    // Телефон важнее ника: по нику человека не найти в списке участников и ему нельзя
    // позвонить, а ник вдобавок может быть не задан или смениться в любой момент.
    `Телефон: ${context.phone ? singleLine(context.phone, 32) : "не указан"}`,
    `Мероприятие: ${singleLine(context.eventTitle, 200)}`,
    `Заказ: ${singleLine(context.orderNumber, 60)}`,
    `Баланс: ${formatKopecks(context.walletKopecks)}`,
    `Внешняя оплата: ${formatKopecks(context.externalKopecks)}`
  ].join("\n");
}

const REMINDER_CADENCE_STEPS = ["10d", "7d", "3d", "1d", "day_of"] as const;
type ReminderCadenceStep = typeof REMINDER_CADENCE_STEPS[number];

function isReminderCadenceStep(value: string): value is ReminderCadenceStep {
  return (REMINDER_CADENCE_STEPS as readonly string[]).includes(value);
}

function formatEventReminderMessage(cadenceStep: ReminderCadenceStep, eventTitle: string): string {
  const title = singleLine(eventTitle, 200);

  switch (cadenceStep) {
    case "10d":
      return [
        `До «${title}» осталось 10 дней.`,
        "",
        "Начинаем собирать программу — расскажем, что будет в эти два дня и как лучше подготовиться."
      ].join("\n");
    case "7d":
      return [
        `До «${title}» осталось 7 дней.`,
        "",
        "Что взять с собой: удобную одежду по погоде, вещи для бани, блокнот для заметок и хорошее настроение."
      ].join("\n");
    case "3d":
      return [
        `До «${title}» осталось 3 дня.`,
        "",
        "Ближе к делу — сориентируем по логистике и расписанию, как добраться и во сколько лучше приехать."
      ].join("\n");
    case "1d":
      return [
        `Завтра «${title}»!`,
        "",
        "Последнее напоминание: проверьте билет в разделе «Мои билеты» и соберите вещи."
      ].join("\n");
    case "day_of":
      return [
        `Доброе утро! Сегодня «${title}».`,
        "",
        "Ждём вас — до встречи на месте!"
      ].join("\n");
  }
}

function validateBroadcastMessage(messageText: string, hasImage: boolean): void {
  const length = messageText.trim().length;
  // С картинкой текст уходит подписью к фото, а её Telegram обрезает на 1024 символах.
  if (length < 1 || length > (hasImage ? 1_024 : 3_500)) {
    throw new Error("Admin broadcast message is invalid");
  }
}

function formatQuestionnaireIntroMessage(eventTitle: string): string {
  return [
    `Место на «${singleLine(eventTitle, 200)}» за вами!`,
    "",
    "Заполним короткую анкету участника — пара минут, поможет собрать программу под вас.",
    "",
    "Как вас зовут?"
  ].join("\n");
}

function formatKopecks(amount: bigint): string {
  if (amount < 0n) {
    throw new Error("Notification amount cannot be negative");
  }

  const rubles = amount / 100n;
  const kopecks = (amount % 100n).toString().padStart(2, "0");
  return `${rubles.toString()},${kopecks} ₽`;
}

function singleLine(value: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error("Notification display text is invalid");
  }
  return normalized;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown, message: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error(message);
  }
  return value;
}

function errorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]{0,99}$/.test(candidate)
    ? candidate
    : "ExternalDeliveryError";
}
