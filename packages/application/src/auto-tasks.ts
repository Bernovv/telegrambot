import type {
  OutreachTaskTrigger,
  OutreachTaskType
} from "@ticket-platform/contracts";
import { atLocalHour, nextCallSlot } from "./call-window.js";

/**
 * Автозадачи: следующий шаг ставится сам, когда с человеком что-то произошло.
 *
 * Три правила, без которых включать это нельзя, и все три держатся здесь.
 *
 * **Не трогать открытую задачу.** Новая задача по линии работы молча отменяет прежнюю —
 * так задумано для руки, но для автоматики это значит стереть запланированный менеджером
 * звонок. Поэтому автозадача появляется только там, где открытой задачи нет.
 *
 * **Ключ повтора.** Проход идёт каждые несколько минут; без ключа он ставил бы ту же
 * задачу каждый круг. Ключ описывает повод целиком — карточку и событие, из-за которого
 * задача появилась.
 *
 * **Видно, что задачу поставила не рука.** У задачи остаётся ссылка на правило, и в ленте
 * карточки она подписана.
 */

/** Кандидат: карточка, по которой правило сработало, и время повода. */
export interface AutoTaskCandidate {
  readonly ruleId: string;
  readonly trigger: OutreachTaskTrigger;
  readonly campaignContactId: string;
  readonly contactId: string;
  /** Время повода: начало мероприятия, его конец, время встречи. */
  readonly anchorAt: Date;
  /** Ключ повтора: карточка плюс повод. */
  readonly autoKey: string;
  readonly offsetDays: number;
  readonly useCallWindow: boolean;
  readonly atHour: number | null;
  readonly taskType: OutreachTaskType;
  readonly taskText: string;
  readonly callWindowStart: number;
  readonly callWindowEnd: number;
  readonly callWindowTimezone: string;
}

export interface AutoTaskToCreate {
  readonly id: string;
  readonly ruleId: string;
  readonly campaignContactId: string;
  readonly contactId: string;
  readonly autoKey: string;
  readonly taskType: OutreachTaskType;
  readonly taskText: string;
  readonly dueAt: Date;
}

export interface AutoTaskRepository {
  /**
   * Карточки, по которым включённые правила уже сработали, а задачи ещё нет.
   *
   * Отбор идёт в базе: условий много и все они про строки — участник мероприятия, отметка
   * явки, время встречи. Считать время задачи база не умеет — это делает служба.
   */
  listCandidates(input: {
    readonly at: Date;
    readonly limit: number;
  }): Promise<readonly AutoTaskCandidate[]>;
  /**
   * Заводит задачи. Возвращает, сколько встало: часть могла не встать из-за ключа повтора
   * или появившейся открытой задачи — за время между отбором и записью менеджер мог
   * успеть поставить свою.
   */
  createTasks(input: {
    readonly tasks: readonly AutoTaskToCreate[];
    readonly createdByAdminId: string;
    readonly now: Date;
  }): Promise<number>;
}

export interface IdSource {
  newId(): string;
}

export interface AutoTaskResult {
  readonly candidates: number;
  readonly created: number;
}

/**
 * Учётная запись, от имени которой автоматика заводит задачи. Та же, что наполняет
 * кампании: заводить задачу должен кто-то, и это заведомо не человек. Ответственным при
 * этом становится ответственный за человека — служебная учётка в этом поле спрятала бы
 * задачу из всех фильтров «мои».
 */
export const AUTO_TASK_ADMIN_ID = "00000000-0000-4000-8000-000000000002";

export class RunAutoTasksBatchService {
  constructor(
    private readonly repository: AutoTaskRepository,
    private readonly idGenerator: IdSource
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<AutoTaskResult> {
    const candidates = await this.repository.listCandidates({
      at: input.at,
      limit: input.batchSize
    });
    if (candidates.length === 0) {
      return { candidates: 0, created: 0 };
    }
    const tasks = candidates.map((candidate) => ({
      id: this.idGenerator.newId(),
      ruleId: candidate.ruleId,
      campaignContactId: candidate.campaignContactId,
      contactId: candidate.contactId,
      autoKey: candidate.autoKey,
      taskType: candidate.taskType,
      taskText: candidate.taskText,
      dueAt: autoTaskDueAt(candidate, input.at)
    }));
    return {
      candidates: candidates.length,
      created: await this.repository.createTasks({
        tasks,
        createdByAdminId: AUTO_TASK_ADMIN_ID,
        now: input.at
      })
    };
  }
}

/**
 * Когда звонить.
 *
 * Сдвиг считается в местных днях, а не в сутках: «на следующий день после мероприятия» —
 * это следующий день, а не «через двадцать четыре часа». Мероприятие кончилось в десять
 * вечера, и звонок через сутки попал бы снова в десять вечера.
 *
 * Час — начало окна обзвона воронки либо назначенный в правиле.
 *
 * Срок, уехавший в прошлое, подтягивается в ближайшее окно. Так бывает у догоняющих
 * поводов: мероприятие кончилось три дня назад, правило включили сегодня. Ставить задачу
 * задним числом — значит выдать её сразу просроченной.
 */
export function autoTaskDueAt(candidate: AutoTaskCandidate, now: Date): Date {
  const window = {
    startHour: candidate.callWindowStart,
    endHour: candidate.callWindowEnd,
    timeZone: candidate.callWindowTimezone
  };
  const hour = candidate.useCallWindow
    ? candidate.callWindowStart
    : candidate.atHour ?? candidate.callWindowStart;
  const due = atLocalHour(
    candidate.anchorAt,
    candidate.callWindowTimezone,
    hour,
    candidate.offsetDays
  );
  if (due === null || due.getTime() < now.getTime()) {
    if (candidate.useCallWindow) {
      return nextCallSlot(now, window);
    }
    // Назначенный час сегодня уже прошёл — значит завтра. Иначе задача рождается
    // просроченной, а таких у менеджера и без автоматики хватает.
    const today = atLocalHour(now, candidate.callWindowTimezone, hour, 0);
    if (today === null) {
      return now;
    }
    return today.getTime() >= now.getTime()
      ? today
      : atLocalHour(now, candidate.callWindowTimezone, hour, 1) ?? now;
  }
  return due;
}
