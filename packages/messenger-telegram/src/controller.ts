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

export interface TelegramReplyModel {
  readonly text: string;
  readonly keyboard?: "request_contact" | "remove";
  readonly inlineButtons?: readonly TelegramInlineButton[];
}

export type TelegramInlineButton =
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

export interface TelegramOfferAcceptanceView {
  readonly callbackText: string;
  readonly replacementText?: string;
  readonly inlineButtons?: readonly TelegramInlineButton[];
  readonly replies?: readonly TelegramReplyModel[];
}

export interface TelegramScenarioTransitionView {
  readonly callbackText: string;
  readonly replies: readonly TelegramReplyModel[];
}

export class TelegramUpdateController {
  constructor(
    private readonly handleStart: TelegramStartUseCase,
    private readonly handleContact: TelegramContactUseCase,
    private readonly acceptOffer: TelegramOfferAcceptanceUseCase,
    private readonly listTickets: TelegramTicketListUseCase,
    private readonly requestTicketRedelivery: TelegramTicketRedeliveryUseCase,
    private readonly initializePayment?: TelegramPaymentInitializationUseCase,
    private readonly scenario?: TelegramScenarioUseCases
  ) {}

  async onStart(command: HandleTelegramStartCommand): Promise<readonly TelegramReplyModel[]> {
    const result = await this.handleStart.execute(command);
    if (this.scenario) {
      const scenario = await this.scenario.start.execute({
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
    const replies: TelegramReplyModel[] = [
      {
        text: [
          "Привет! Это бот Бизнес-Прорыв.",
          "",
          "Здесь можно узнать о мероприятиях и приобрести билеты."
        ].join("\n"),
        inlineButtons: [{ text: "Мои билеты", callbackData: "my_tickets" }]
      }
    ];

    if (result.phoneRequired) {
      replies.push({
        text: "Чтобы закрепить заявку и не потерять билет, поделитесь номером телефона.",
        keyboard: "request_contact"
      });
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
  ): Promise<readonly TelegramReplyModel[]> {
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

  async onContact(command: HandleTelegramContactCommand): Promise<readonly TelegramReplyModel[]> {
    const result = await this.handleContact.execute(command);

    if (!result.accepted) {
      return [
        {
          text: "Пожалуйста, отправьте свой номер кнопкой ниже.",
          keyboard: "request_contact"
        }
      ];
    }

    if (result.bonusCredited) {
      return [
        {
          text: `Номер подтвержден. На баланс начислено ${formatKopecks(result.bonusAmountKopecks)} ₽.`,
          keyboard: "remove"
        }
      ];
    }

    if (result.bonusReason === "already_credited") {
      return [
        {
          text: `Номер подтвержден. Доступный баланс: ${formatKopecks(result.availableBalanceKopecks)} ₽.`,
          keyboard: "remove"
        }
      ];
    }

    return [{ text: "Номер подтвержден.", keyboard: "remove" }];
  }

  async onTickets(
    command: ListTelegramTicketsCommand
  ): Promise<readonly TelegramReplyModel[]> {
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
  ): Promise<readonly TelegramReplyModel[]> {
    if (!this.scenario?.offerAccepted) {
      return [];
    }
    const resumed = await this.scenario.offerAccepted.execute({
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
): TelegramReplyModel[] {
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
