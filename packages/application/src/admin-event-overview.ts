import type {
  AdminRequestActor,
  EventExpensesView,
  EventInventoryView,
  EventOverview,
  EventOverviewMoney,
  EventOverviewPeople,
  EventOverviewReadinessItem,
  EventParticipantsView,
  EventTeamView
} from "@ticket-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Обзор мероприятия.
 *
 * Собирается из готовых сводок остальных вкладок и не считает ничего своего: посчитай он
 * выручку сам, однажды обзор и «Команда» разошлись бы на копейку, и объяснить это было бы
 * нечем. Деньги показываются только тому, у кого есть право их видеть.
 */

export interface OverviewEventRow {
  readonly id: string;
  readonly title: string;
  readonly capacity: number;
  readonly occupiedUnits: number;
  readonly offerRequired: boolean;
  readonly hasActiveOffer: boolean;
  readonly pricedProductCount: number;
  /** Бесплатное мероприятие: пункты чек-листа про цены и оферту к нему не относятся. */
  readonly isFree: boolean;
}

export interface AdminEventOverviewRepository {
  findEvent(eventId: string): Promise<OverviewEventRow | null>;
  loadParticipants(eventId: string): Promise<EventParticipantsView>;
  loadExpenses(eventId: string): Promise<EventExpensesView>;
  loadInventory(eventId: string): Promise<EventInventoryView>;
  loadTeam(eventId: string): Promise<EventTeamView>;
  hasFixedTentPlan(eventId: string): Promise<boolean>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
}

export interface OverviewClock {
  now(): Date;
}

export class OverviewEventNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "OverviewEventNotFoundError";
  }
}

export class AdminEventOverviewService {
  constructor(
    private readonly repository: AdminEventOverviewRepository,
    private readonly clock: OverviewClock
  ) {}

  async summary(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<EventOverview> {
    if (input.actor.permission !== "events.read"
      || !UUID_PATTERN.test(input.actor.adminId)) {
      throw new Error("Administrator overview permission is invalid");
    }
    if (!UUID_PATTERN.test(input.eventId)) {
      throw new Error("Administrator overview request is invalid");
    }

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new OverviewEventNotFoundError();
    }

    const [participants, expenses, inventory, tentPlanFixed, canSeeMoney] =
      await Promise.all([
        this.repository.loadParticipants(input.eventId),
        this.repository.loadExpenses(input.eventId),
        this.repository.loadInventory(input.eventId),
        this.repository.hasFixedTentPlan(input.eventId),
        this.repository.hasPermission(input.actor.adminId, "event_finance.read")
      ]);

    // Команда читается только тем, кому её показывать: лишний запрос за чужими деньгами
    // не нужен даже ради удобства кода.
    const team = canSeeMoney
      ? await this.repository.loadTeam(input.eventId)
      : null;

    return buildOverview({
      event,
      participants,
      expenses,
      inventory,
      team,
      tentPlanFixed,
      calculatedAt: this.clock.now()
    });
  }
}

export interface OverviewInput {
  readonly event: OverviewEventRow;
  readonly participants: EventParticipantsView;
  readonly expenses: EventExpensesView;
  readonly inventory: EventInventoryView;
  readonly team: EventTeamView | null;
  readonly tentPlanFixed: boolean;
  readonly calculatedAt: Date;
}

export function buildOverview(input: OverviewInput): EventOverview {
  const people: EventOverviewPeople = {
    capacity: input.event.capacity,
    occupiedUnits: input.event.occupiedUnits,
    people: input.participants.totals.people,
    guests: input.participants.totals.guests,
    adults: input.participants.totals.adults,
    children: input.participants.totals.children,
    sleepingPlaces: input.participants.totals.sleepingPlaces,
    fromOrders: input.participants.totals.fromOrders,
    fromManual: input.participants.totals.fromManual,
    questionnaireAnswered: input.participants.questionnaire.answered,
    questionnairePeople: input.participants.questionnaire.people
  };

  const money: EventOverviewMoney | null = input.team === null
    ? null
    : {
        revenueKopecks: input.team.profit.revenueKopecks,
        revenueFromOrdersKopecks: input.team.profit.revenueFromOrdersKopecks,
        revenueFromManualKopecks: input.team.profit.revenueFromManualKopecks,
        expensesPlannedKopecks: input.expenses.totals.plannedKopecks,
        expensesActualKopecks: input.team.profit.expensesKopecks,
        profitKopecks: input.team.profit.profitKopecks,
        preliminary: input.team.profit.preliminary,
        expensesWithoutActual: input.team.profit.expensesWithoutActual,
        organizers: input.team.organizers.map((organizer) => ({
          personName: organizer.personName,
          sharePercent: organizer.sharePercent,
          shareKopecks: organizer.shareKopecks
        })),
        unallocatedKopecks: input.team.unallocatedKopecks
      };

  const readiness = buildReadiness(input);

  return {
    eventId: input.event.id,
    eventTitle: input.event.title,
    calculatedAt: input.calculatedAt.toISOString(),
    money,
    people,
    readiness,
    readinessDone: readiness.filter((item) => item.done).length
  };
}

/**
 * Чек-лист готовности. Пункт, который не про это мероприятие, из списка уходит совсем:
 * «анкеты внесены» без единого вопроса — это не невыполненный пункт, а несуществующий,
 * и вечно красная строка учит не смотреть на список вообще.
 */
function buildReadiness(input: OverviewInput): readonly EventOverviewReadinessItem[] {
  const items: EventOverviewReadinessItem[] = [];

  if (input.event.offerRequired) {
    items.push({
      code: "offer",
      label: "Оферта опубликована",
      done: input.event.hasActiveOffer,
      hint: "Без действующей версии покупателю не с чем соглашаться.",
      tab: "settings"
    });
  }

  // У бесплатного мероприятия тарифа нет и не будет: вечно красная строка «цены заданы»
  // учит не смотреть на чек-лист вообще.
  if (!input.event.isFree) {
    items.push({
      code: "prices",
      label: "Цены заданы",
      done: input.event.pricedProductCount > 0,
      hint: "Без активного тарифа с ценой заказ не выставить.",
      tab: "settings"
    });
  }

  items.push({
    code: "estimate",
    label: "Смета составлена",
    done: input.expenses.expenses.length > 0,
    hint: "Без сметы прибыль равна выручке, а это не прибыль.",
    tab: "expenses"
  });

  items.push({
    code: "expenses_actual",
    label: "Факт по расходам внесён",
    done: input.expenses.totals.openCount === 0,
    hint: `Строк без факта: ${input.expenses.totals.openCount}. Пока они есть, прибыль завышена.`,
    tab: "expenses"
  });

  if (input.inventory.totals.needCount > 0) {
    items.push({
      code: "inventory_enough",
      label: "Инвентаря хватает",
      done: input.inventory.totals.shortCount === 0,
      hint: `Позиций, которых не хватает на складе: ${input.inventory.totals.shortCount}.`,
      tab: "inventory"
    });
    items.push({
      code: "inventory_loaded",
      label: "Всё загружено",
      done: input.inventory.totals.loaded === input.inventory.totals.needCount,
      hint: `Загружено ${input.inventory.totals.loaded} из ${input.inventory.totals.needCount}.`,
      tab: "inventory"
    });
  }

  if (input.participants.totals.sleepingPlaces > 0) {
    items.push({
      code: "tent_plan",
      label: "План палаток зафиксирован",
      done: input.tentPlanFixed,
      hint: "Зафиксируйте перед погрузкой — потом будет видно, что изменилось.",
      tab: "accommodation"
    });
  }

  if (input.participants.fields.length > 0) {
    items.push({
      code: "questionnaires",
      label: "Анкеты внесены",
      done: input.participants.questionnaire.answered
        === input.participants.questionnaire.people,
      hint: `Внесено ${input.participants.questionnaire.answered} из ${input.participants.questionnaire.people}.`,
      tab: "questionnaire"
    });
  }

  if (input.team !== null) {
    items.push({
      code: "shares",
      label: "Доли распределены",
      done: input.team.allocatedPercent === "100",
      hint: `Роздано ${input.team.allocatedPercent}% прибыли.`,
      tab: "team"
    });
  }

  return items;
}
