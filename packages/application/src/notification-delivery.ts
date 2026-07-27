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
  readonly userId: string;
  readonly recipientExternalUserId: string;
}

export interface BroadcastContext {
  readonly messageText: string;
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
}

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

export interface NotificationSender extends TextNotificationSender {
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
    private readonly adminChatId: string,
    private readonly scenarioPaymentContinuation?: ScenarioPaymentContinuation,
    private readonly questionnaireContexts?: QuestionnaireIntroContextRepository,
    private readonly questionnaireDrafts?: QuestionnaireDraftRepository,
    private readonly reminderContexts?: ReminderContextRepository,
    private readonly broadcastContexts?: BroadcastContextRepository
  ) {
    if (!/^-?\d{1,20}$/.test(adminChatId)) {
      throw new Error("Administrator notification chat ID is invalid");
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

    let delivered = 0;
    let duplicates = 0;
    for (const ticket of context.tickets) {
      const token = this.ticketTokens.publicToken(ticket.id).token;
      const caption = formatTicketMessage(
        context,
        ticket,
        token,
        event.eventType === "TicketRedeliveryRequested"
      );
      const result = await this.deliverOnce({
        event,
        input,
        kind: "ticket_user",
        aggregateId: ticket.id,
        recipientId,
        idempotencyKey: event.eventType === "TicketsIssued"
          ? `telegram:ticket:${ticket.id}`
          : `telegram:ticket-redelivery:${event.sourceEventId}:${ticket.id}`,
        send: async () => {
          const image = await this.ticketRenderer.renderPng(token);
          validateTicketPng(image);
          return this.sender.sendImage(
            recipientId,
            image,
            `${ticket.ticketNumber}.png`,
            caption
          );
        }
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

    const result = await this.deliverOnce({
      event,
      input,
      kind: "admin_purchase",
      aggregateId: event.orderId,
      recipientId: this.adminChatId,
      idempotencyKey: `telegram:admin-purchase:${event.sourceEventId}:${this.adminChatId}`,
      send: () => this.sender.sendText(
        this.adminChatId,
        formatAdminPurchaseMessage(context)
      )
    });

    return {
      eventType: event.eventType,
      delivered: result === "delivered" ? 1 : 0,
      duplicates: result === "duplicate" ? 1 : 0,
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
    validateBroadcastMessage(context.messageText);

    await broadcasts.markBroadcastSending(event.broadcastId, input.handledAt);

    let delivered = 0;
    let duplicates = 0;
    for (const recipient of context.recipients) {
      const result = await this.deliverOnce({
        event,
        input,
        kind: "admin_broadcast",
        aggregateId: event.broadcastId,
        recipientId: recipient.recipientExternalUserId,
        idempotencyKey: `telegram:broadcast:${event.broadcastId}:${recipient.userId}`,
        send: () => this.sender.sendText(recipient.recipientExternalUserId, context.messageText)
      });
      delivered += result === "delivered" ? 1 : 0;
      duplicates += result === "duplicate" ? 1 : 0;
    }

    // Reached only once every recipient in this attempt succeeded (or was already sent by a
    // prior attempt) -- a mid-loop failure throws and aborts before this point, leaving the
    // campaign in 'sending' so a retried job resumes: already-sent recipients are skipped by
    // the ledger's idempotency key, so no one is messaged twice.
    await broadcasts.markBroadcastCompleted(
      event.broadcastId,
      delivered + duplicates,
      0,
      input.handledAt
    );

    return {
      eventType: event.eventType,
      delivered,
      duplicates,
      ignored: false
    };
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

function validateTicketPng(image: TicketPng): void {
  if (
    image.mimeType !== "image/png"
    || !(image.bytes instanceof Uint8Array)
    || image.bytes.byteLength < 100
    || image.bytes.byteLength > 10 * 1_024 * 1_024
    || !Number.isSafeInteger(image.width)
    || !Number.isSafeInteger(image.height)
    || image.width < 256
    || image.width > 2_048
    || image.height !== image.width
  ) {
    throw new Error("Rendered ticket PNG is invalid");
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => image.bytes[index] !== byte)) {
    throw new Error("Rendered ticket PNG signature is invalid");
  }
  if (
    image.bytes[12] !== 73
    || image.bytes[13] !== 72
    || image.bytes[14] !== 68
    || image.bytes[15] !== 82
    || readPngUint32(image.bytes, 16) !== image.width
    || readPngUint32(image.bytes, 20) !== image.height
  ) {
    throw new Error("Rendered ticket PNG dimensions are invalid");
  }
}

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000
    + (bytes[offset + 1] ?? 0) * 0x10000
    + (bytes[offset + 2] ?? 0) * 0x100
    + (bytes[offset + 3] ?? 0)
  );
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

function formatTicketMessage(
  context: TicketDeliveryContext,
  ticket: TicketDeliveryContext["tickets"][number],
  token: string,
  redelivery: boolean
): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("Ticket public token is invalid");
  }

  return [
    redelivery ? "Повторная отправка билета." : "Оплата подтверждена.",
    `Мероприятие: ${singleLine(context.eventTitle, 200)}`,
    `Заказ: ${singleLine(context.orderNumber, 60)}`,
    `Билет: ${singleLine(ticket.ticketNumber, 60)}`,
    `Код билета: ${token}`,
    "",
    "Сохраните это сообщение. Билет можно повторно получить в разделе «Мои билеты»."
  ].join("\n");
}

function formatAdminPurchaseMessage(context: AdminPurchaseContext): string {
  const buyer = context.username
    ? `@${singleLine(context.username.replace(/^@/, ""), 64)}`
    : `Пользователь ${context.userId}`;

  return [
    `${buyer} купил ${context.ticketCount} билет(а) на сумму ${formatKopecks(context.totalKopecks)}.`,
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

function validateBroadcastMessage(messageText: string): void {
  const length = messageText.trim().length;
  if (length < 1 || length > 3_500) {
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
