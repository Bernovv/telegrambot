import type {
  AcceptTelegramOfferCommand,
  AcceptTelegramOfferResult,
  AdvanceTelegramScenarioCommand,
  AdvanceTelegramScenarioResult,
  HandleTelegramContactCommand,
  HandleTelegramContactResult,
  HandleTelegramStartCommand,
  HandleTelegramStartResult,
  InitializeTelegramPaymentCommand,
  InitializeTelegramPaymentResult,
  ListTelegramTicketsCommand,
  ListTelegramTicketsResult,
  RequestTelegramTicketRedeliveryCommand,
  RequestTelegramTicketRedeliveryResult,
  ResumeTelegramScenarioAfterOfferCommand,
  ResumeTelegramScenarioAfterOfferResult,
  ScenarioPresentationModel,
  StartTelegramScenarioCommand,
  StartTelegramScenarioResult,
  SubmitTelegramScenarioInputCommand,
  SubmitTelegramScenarioInputResult,
  TelegramTicketSummary
} from "@ticket-platform/contracts";
import { encodeScenarioCallback } from "./scenario-callback.js";
import type {
  ChannelIdentity,
  PurchaseFlowResult,
  PurchaseTicketType,
  ReferralBalanceResult
} from "@ticket-platform/application";
import {
  catalogUnavailableReply,
  chooseFamilyTicketReply,
  chooseTicketReply,
  contactUsReply,
  enterChildQuantityReply,
  enterQuantityReply,
  faqReply,
  invalidChildQuantityReply,
  invalidQuantityReply,
  menuReply,
  myBonusesReply,
  myBonusesUnavailableReply,
  noActiveDraftReply,
  orderInterimSummaryReply,
  orderOfferStepReply,
  partnerLinkReply,
  partnerProgramReply,
  phoneRequiredReply,
  requestPhoneReply,
  programAndPricingReply,
  welcomeReply
} from "./scenario-content.js";

export interface ReplyModel {
  readonly text: string;
  readonly keyboard?: "request_contact" | "remove";
  readonly inlineButtons?: readonly InlineButton[];
}

export type InlineButton =
  | { readonly text: string; readonly callbackData: string }
  | { readonly text: string; readonly url: string };

export interface TelegramStartUseCase {
  execute(command: HandleTelegramStartCommand): Promise<HandleTelegramStartResult>;
}

export interface TelegramContactUseCase {
  execute(command: HandleTelegramContactCommand): Promise<HandleTelegramContactResult>;
}

export interface TelegramOfferAcceptanceUseCase {
  execute(command: AcceptTelegramOfferCommand): Promise<AcceptTelegramOfferResult>;
}

export interface TelegramTicketListUseCase {
  execute(command: ListTelegramTicketsCommand): Promise<ListTelegramTicketsResult>;
}

export interface TelegramTicketRedeliveryUseCase {
  execute(
    command: RequestTelegramTicketRedeliveryCommand
  ): Promise<RequestTelegramTicketRedeliveryResult>;
}

export interface TelegramPaymentInitializationUseCase {
  execute(
    command: InitializeTelegramPaymentCommand
  ): Promise<InitializeTelegramPaymentResult>;
}

export interface TelegramScenarioStartUseCase {
  execute(
    command: StartTelegramScenarioCommand
  ): Promise<StartTelegramScenarioResult>;
}

export interface TelegramScenarioAdvanceUseCase {
  execute(
    command: AdvanceTelegramScenarioCommand
  ): Promise<AdvanceTelegramScenarioResult>;
}

export interface TelegramScenarioInputUseCase {
  execute(
    command: SubmitTelegramScenarioInputCommand
  ): Promise<SubmitTelegramScenarioInputResult>;
}

export interface TelegramScenarioOfferAcceptedUseCase {
  execute(
    command: ResumeTelegramScenarioAfterOfferCommand
  ): Promise<ResumeTelegramScenarioAfterOfferResult>;
}

export interface TelegramScenarioUseCases {
  readonly start: TelegramScenarioStartUseCase;
  readonly advance: TelegramScenarioAdvanceUseCase;
  readonly input: TelegramScenarioInputUseCase;
  readonly offerAccepted?: TelegramScenarioOfferAcceptedUseCase;
}

export interface TelegramPurchaseFlowUseCase {
  selectTicketType(
    sender: ChannelIdentity,
    ticketType: PurchaseTicketType,
    now: Date
  ): Promise<PurchaseFlowResult>;
  handleQuantityText(sender: ChannelIdentity, text: string, now: Date): Promise<PurchaseFlowResult>;
  promptChildQuantity(sender: ChannelIdentity): Promise<PurchaseFlowResult>;
  skipChildTicket(sender: ChannelIdentity, now: Date): Promise<PurchaseFlowResult>;
  handleChildQuantityText(
    sender: ChannelIdentity,
    text: string,
    now: Date
  ): Promise<PurchaseFlowResult>;
}

export interface TelegramPhoneAccessUseCase {
  execute(query: ChannelIdentity): Promise<{ readonly unlocked: boolean }>;
}

export interface TelegramReferralBalanceUseCase {
  execute(query: ChannelIdentity): Promise<ReferralBalanceResult>;
}

export interface TelegramOfferAcceptanceView {
  readonly callbackText: string;
  readonly replacementText?: string;
  readonly inlineButtons?: readonly InlineButton[];
  readonly replies?: readonly ReplyModel[];
}

export interface TelegramScenarioTransitionView {
  readonly callbackText: string;
  readonly replies: readonly ReplyModel[];
}

export class ConversationController {
  constructor(
    private readonly handleStart: TelegramStartUseCase,
    private readonly handleContact: TelegramContactUseCase,
    private readonly acceptOffer: TelegramOfferAcceptanceUseCase,
    private readonly listTickets: TelegramTicketListUseCase,
    private readonly requestTicketRedelivery: TelegramTicketRedeliveryUseCase,
    private readonly initializePayment?: TelegramPaymentInitializationUseCase,
    private readonly scenario?: TelegramScenarioUseCases,
    private readonly purchaseFlow?: TelegramPurchaseFlowUseCase,
    private readonly referralBalance?: TelegramReferralBalanceUseCase,
    private readonly phoneAccess?: TelegramPhoneAccessUseCase
  ) {}

  /**
   * Без телефона открыты только программа с тарифами и FAQ — так решил заказчик. Проверка
   * стоит здесь, а не в обработчиках кнопок, чтобы правило было записано в одном месте и
   * одинаково работало во всех точках входа.
   *
   * Если проверка не подключена (например, в тестах транспорта), раздел считается открытым:
   * молча закрывать боту продажи из-за незаполненной зависимости — хуже, чем пустить.
   */
  private async isUnlocked(sender: ChannelIdentity): Promise<boolean> {
    if (!this.phoneAccess) {
      return true;
    }
    const result = await this.phoneAccess.execute(sender);
    return result.unlocked;
  }

  async onStart(command: HandleTelegramStartCommand): Promise<readonly ReplyModel[]> {
    const result = await this.handleStart.execute(command);
    if (this.scenario) {
      const scenario = await this.scenario.start.execute({
        channel: command.channel,
        userId: result.userId,
        messengerIdentityId: result.messengerIdentityId,
        eventSlug: result.selectedEventSlug,
        updateId: command.updateId,
        occurredAt: command.receivedAt
      });
      if (scenario.handled) {
        if (scenario.duplicate) {
          return [];
        }
        const scenarioMessages = scenarioReplies(
          scenario.sessionId,
          scenario.presentations
        );
        if (scenario.status === "blocked") {
          scenarioMessages.push({
            text: "Сценарий временно недоступен. Попробуйте начать заново позже."
          });
        }
        if (result.phoneRequired) {
          scenarioMessages.push({
            text: "Чтобы закрепить заявку и не потерять билет, поделитесь номером телефона.",
            keyboard: "request_contact"
          });
        }
        return scenarioMessages;
      }
    }
    const replies: ReplyModel[] = [welcomeReply()];

    if (result.phoneRequired) {
      replies.push(requestPhoneReply());
    }

    return replies;
  }

  async onScenarioTransition(
    command: AdvanceTelegramScenarioCommand
  ): Promise<TelegramScenarioTransitionView> {
    if (!this.scenario) {
      return { callbackText: "Действие недоступно", replies: [] };
    }
    const result = await this.scenario.advance.execute(command);
    if (!result.accepted) {
      return { callbackText: "Действие устарело", replies: [] };
    }
    if (result.duplicate) {
      return { callbackText: "Уже обработано", replies: [] };
    }
    const replies = scenarioReplies(result.sessionId, result.presentations);
    if (result.status === "blocked") {
      replies.push({
        text: "Сценарий временно недоступен. Попробуйте начать заново позже."
      });
    }
    return {
      callbackText: result.status === "completed" ? "Готово" : "Выбрано",
      replies
    };
  }

  async onScenarioInput(
    command: SubmitTelegramScenarioInputCommand
  ): Promise<readonly ReplyModel[]> {
    if (!this.scenario) {
      return [];
    }
    const result = await this.scenario.input.execute(command);
    if (!result.handled) {
      return result.reason === "input_ambiguous"
        ? [{
            text: "Открыто несколько диалогов. Запустите нужное мероприятие заново командой /start."
          }]
        : [];
    }
    if (result.duplicate) {
      return [];
    }
    const replies = scenarioReplies(result.sessionId, result.presentations);
    if (result.status === "blocked") {
      replies.push({
        text: "Сценарий временно недоступен. Попробуйте начать заново позже."
      });
    }
    return replies;
  }

  /** "Назад" / повторный показ главного меню — без повторного обращения к идентити-сервису. */
  onMenu(): readonly ReplyModel[] {
    return [menuReply()];
  }

  onProgramAndPricing(): readonly ReplyModel[] {
    return [programAndPricingReply()];
  }

  onFaq(): readonly ReplyModel[] {
    return [faqReply()];
  }

  async onContactUs(sender: ChannelIdentity): Promise<readonly ReplyModel[]> {
    if (!await this.isUnlocked(sender)) {
      return [phoneRequiredReply()];
    }
    return [contactUsReply()];
  }

  async onBuyTicket(sender: ChannelIdentity): Promise<readonly ReplyModel[]> {
    if (!await this.isUnlocked(sender)) {
      return [phoneRequiredReply()];
    }
    return [chooseTicketReply()];
  }

  async onChooseFamilyTicket(sender: ChannelIdentity): Promise<readonly ReplyModel[]> {
    if (!await this.isUnlocked(sender)) {
      return [phoneRequiredReply()];
    }
    return [chooseFamilyTicketReply()];
  }

  async onPartnerProgram(sender: ChannelIdentity): Promise<readonly ReplyModel[]> {
    if (!await this.isUnlocked(sender)) {
      return [phoneRequiredReply()];
    }
    return [partnerProgramReply()];
  }

  async onGetPartnerLink(
    sender: ChannelIdentity,
    botUsername: string | null
  ): Promise<readonly ReplyModel[]> {
    if (!await this.isUnlocked(sender)) {
      return [phoneRequiredReply()];
    }
    return [partnerLinkReply(sender.externalUserId, botUsername, sender.channel)];
  }

  async onMyBonuses(sender: ChannelIdentity): Promise<readonly ReplyModel[]> {
    if (!await this.isUnlocked(sender)) {
      return [phoneRequiredReply()];
    }
    if (!this.referralBalance) {
      return [myBonusesUnavailableReply()];
    }

    const result = await this.referralBalance.execute(sender);
    if (!result.identityFound) {
      return [myBonusesUnavailableReply()];
    }

    return [myBonusesReply({
      availableKopecks: result.availableKopecks,
      qualifyingReferrals: result.qualifyingReferrals,
      tierNumber: result.tierNumber,
      percentBasisPoints: result.percentBasisPoints,
      referralsToNextTier: result.referralsToNextTier
    })];
  }

  async onSelectTicketType(
    sender: ChannelIdentity,
    ticketType: PurchaseTicketType,
    now: Date
  ): Promise<readonly ReplyModel[]> {
    if (!this.purchaseFlow) {
      return [catalogUnavailableReply()];
    }
    return mapPurchaseFlowResult(await this.purchaseFlow.selectTicketType(sender, ticketType, now));
  }

  /**
   * Free-typed chat text also reaches every other feature (a future "Связаться с нами" question,
   * for instance), so this stays silent (`[]`) when there is no purchase draft waiting on a
   * number — only an explicit purchase-flow button click (onSelectTicketType, onSkipChildTicket,
   * onAddChildTicketPrompt) shows an explicit "draft was lost" message.
   */
  async onQuantityText(sender: ChannelIdentity, text: string, now: Date): Promise<readonly ReplyModel[]> {
    if (!this.purchaseFlow) {
      return [];
    }
    const result = await this.purchaseFlow.handleQuantityText(sender, text, now);
    return result.kind === "no_active_draft" ? [] : mapPurchaseFlowResult(result);
  }

  async onAddChildTicketPrompt(sender: ChannelIdentity): Promise<readonly ReplyModel[]> {
    if (!this.purchaseFlow) {
      return [catalogUnavailableReply()];
    }
    return mapPurchaseFlowResult(await this.purchaseFlow.promptChildQuantity(sender));
  }

  async onSkipChildTicket(sender: ChannelIdentity, now: Date): Promise<readonly ReplyModel[]> {
    if (!this.purchaseFlow) {
      return [catalogUnavailableReply()];
    }
    return mapPurchaseFlowResult(await this.purchaseFlow.skipChildTicket(sender, now));
  }

  async onChildQuantityText(
    sender: ChannelIdentity,
    text: string,
    now: Date
  ): Promise<readonly ReplyModel[]> {
    if (!this.purchaseFlow) {
      return [];
    }
    const result = await this.purchaseFlow.handleChildQuantityText(sender, text, now);
    return result.kind === "no_active_draft" ? [] : mapPurchaseFlowResult(result);
  }

  async onContact(command: HandleTelegramContactCommand): Promise<readonly ReplyModel[]> {
    const result = await this.handleContact.execute(command);

    if (!result.accepted) {
      return [
        {
          text: "Пожалуйста, отправьте свой номер кнопкой ниже.",
          keyboard: "request_contact"
        }
      ];
    }

    // Вторым сообщением всегда возвращаем меню. До этого человек оставался с пустым экраном
    // и не знал, что теперь ему доступны покупка, партнёрка и остальные разделы: клавиатуру
    // с запросом контакта мы убираем, а взамен не показывали ничего.
    if (result.bonusCredited) {
      return [
        {
          text: `Номер подтверждён ✅ На баланс начислено ${formatKopecks(result.bonusAmountKopecks)} ₽ 🎁`,
          keyboard: "remove"
        },
        menuReply()
      ];
    }

    if (result.bonusReason === "already_credited") {
      return [
        {
          text: `Номер подтверждён ✅ Доступный баланс: ${formatKopecks(result.availableBalanceKopecks)} ₽.`,
          keyboard: "remove"
        },
        menuReply()
      ];
    }

    return [{ text: "Номер подтверждён ✅", keyboard: "remove" }, menuReply()];
  }

  async onTickets(
    command: ListTelegramTicketsCommand
  ): Promise<readonly ReplyModel[]> {
    const result = await this.listTickets.execute(command);
    if (!result.identityFound) {
      return [{ text: "Сначала откройте меню командой /start." }];
    }
    if (result.tickets.length === 0) {
      return [{ text: "У вас пока нет билетов." }];
    }

    return result.tickets.map((ticket) => ({
      text: formatTicketSummary(ticket),
      ...(ticket.status === "issued"
        ? { inlineButtons: [{
            text: "Отправить билет ещё раз",
            callbackData: `ticket_redeliver:${ticket.ticketId}`
          }] }
        : {})
    }));
  }

  async onTicketRedelivery(
    command: RequestTelegramTicketRedeliveryCommand
  ): Promise<{ readonly callbackText: string }> {
    const result = await this.requestTicketRedelivery.execute(command);
    if (!result.accepted) {
      return { callbackText: "Билет недоступен" };
    }

    return {
      callbackText: result.newlyRequested
        ? "Билет отправляется"
        : "Билет уже отправляется"
    };
  }

  async onOfferAcceptance(
    command: AcceptTelegramOfferCommand
  ): Promise<TelegramOfferAcceptanceView> {
    const result = await this.acceptOffer.execute(command);

    if (!result.accepted) {
      return {
        callbackText: offerRejectionText(result.reason)
      };
    }
    const scenarioRepliesAfterOffer = await this.resumeScenarioAfterOffer(
      result.orderId,
      command
    );
    if (!result.newlyAccepted) {
      return {
        callbackText: "Оферта уже принята",
        ...(scenarioRepliesAfterOffer.length > 0
          ? { replies: scenarioRepliesAfterOffer }
          : {})
      };
    }

    return {
      callbackText: "Оферта принята",
      replacementText: [
        "Оферта принята",
        "",
        `Заказ: ${result.orderNumber}`,
        `Итого: ${formatKopecks(result.totalKopecks)} ₽`,
        `Баланс: ${formatKopecks(result.walletAppliedKopecks)} ₽`,
        `К оплате: ${formatKopecks(result.externalDueKopecks)} ₽`
      ].join("\n"),
      ...(scenarioRepliesAfterOffer.length > 0
        ? { replies: scenarioRepliesAfterOffer }
        : {}),
      ...(scenarioRepliesAfterOffer.length === 0
        && this.initializePayment
        && BigInt(result.externalDueKopecks) > 0n
        ? {
            inlineButtons: [{
              text: "Оплатить",
              callbackData: `payment_init:${command.publicOrderToken}`
            }]
          }
        : {})
    };
  }

  private async resumeScenarioAfterOffer(
    orderId: string,
    command: AcceptTelegramOfferCommand
  ): Promise<readonly ReplyModel[]> {
    if (!this.scenario?.offerAccepted) {
      return [];
    }
    const resumed = await this.scenario.offerAccepted.execute({
      channel: command.channel,
      orderId,
      senderExternalUserId: command.senderExternalUserId,
      updateId: command.updateId,
      occurredAt: command.acceptedAt
    });
    if (!resumed.handled || resumed.duplicate) {
      return [];
    }
    const replies = scenarioReplies(
      resumed.sessionId,
      resumed.presentations
    );
    if (resumed.status === "blocked") {
      replies.push({
        text: "Сценарий временно недоступен. Попробуйте начать заново позже."
      });
    }
    return replies;
  }

  async onPaymentInitialization(
    command: InitializeTelegramPaymentCommand
  ): Promise<TelegramOfferAcceptanceView> {
    if (!this.initializePayment) {
      return { callbackText: "Оплата временно недоступна" };
    }
    const result = await this.initializePayment.execute(command);
    if (!result.initialized) {
      return {
        callbackText: result.reason === "initialization_in_progress"
          ? "Проверяем создание платежа"
          : "Оплата временно недоступна"
      };
    }

    return {
      callbackText: "Платёж готов",
      replacementText: [
        `Заказ: ${result.orderNumber}`,
        `К оплате: ${formatKopecks(result.amountKopecks)} ₽`
      ].join("\n"),
      inlineButtons: [{ text: "Перейти к оплате", url: result.paymentUrl }]
    };
  }
}

function scenarioReplies(
  sessionId: string,
  presentations: readonly ScenarioPresentationModel[]
): ReplyModel[] {
  return presentations.map((presentation) => ({
    text: presentation.text,
    ...(presentation.buttons.length > 0
      ? {
          inlineButtons: presentation.buttons.map((button) => {
            if ("edgeId" in button) {
              return {
                text: button.text,
                callbackData: encodeScenarioCallback(sessionId, button.edgeId)
              };
            }
            return button;
          })
        }
      : {})
  }));
}

function mapPurchaseFlowResult(result: PurchaseFlowResult): readonly ReplyModel[] {
  switch (result.kind) {
    case "ask_quantity":
      return [enterQuantityReply(result.ticketLabel)];
    case "invalid_quantity":
      return [invalidQuantityReply()];
    case "interim_summary":
      return [orderInterimSummaryReply(result.ticketLabel, result.adultQuantity)];
    case "ask_child_quantity":
      return [enterChildQuantityReply()];
    case "invalid_child_quantity":
      return [invalidChildQuantityReply()];
    case "order_created":
      return [orderOfferStepReply({
        ticketLabel: result.ticketLabel,
        adultQuantity: result.adultQuantity,
        childQuantity: result.childQuantity,
        totalKopecks: result.totalKopecks,
        publicToken: result.publicToken,
        offerUrl: result.offerUrl
      })];
    case "catalog_unavailable":
      return [catalogUnavailableReply()];
    case "no_active_draft":
      return [noActiveDraftReply()];
  }
}

function formatTicketSummary(ticket: TelegramTicketSummary): string {
  return [
    `Мероприятие: ${singleLine(ticket.eventTitle, 200)}`,
    `Заказ: ${singleLine(ticket.orderNumber, 60)}`,
    `Билет: ${singleLine(ticket.ticketNumber, 60)}`,
    `Статус: ${ticketStatusLabel(ticket.status)}`
  ].join("\n");
}

function ticketStatusLabel(status: TelegramTicketSummary["status"]): string {
  switch (status) {
    case "issued":
      return "действует";
    case "checked_in":
      return "использован";
    case "revoked":
      return "отозван";
    case "refunded":
      return "возвращён";
  }
}

function singleLine(value: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error("Ticket display text is invalid");
  }
  return normalized;
}

export function formatKopecks(value: string): string {
  const kopecks = BigInt(value);
  const rubles = kopecks / 100n;
  const remainder = kopecks % 100n;

  if (remainder === 0n) {
    return rubles.toString();
  }

  return `${rubles},${remainder.toString().padStart(2, "0")}`;
}

function offerRejectionText(
  reason: Extract<AcceptTelegramOfferResult, { accepted: false }>["reason"]
): string {
  switch (reason) {
    case "order_expired":
      return "Срок бронирования истёк";
    case "order_not_acceptable":
      return "Заказ уже нельзя изменить";
    case "offer_unavailable":
      return "Оферта временно недоступна";
    case "order_not_found":
      return "Заказ не найден";
  }
}
