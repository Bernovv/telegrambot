import type { AdminRequestActor } from "@ticket-platform/contracts";

/**
 * Наполнение кампаний мероприятий участниками.
 *
 * Кампания заводится вместе с мероприятием, но людей в неё складывает этот проход. Раньше
 * это была кнопка в панели: пока её никто не нажал, обзвонить участников бесплатной встречи
 * было не по чему — заказов у них нет, а список участников живёт отдельной таблицей.
 *
 * Направление одно: участник попадает в кампанию, обратно ничего не едет. В кампании
 * помимо участников сидят те, кого только зовут, и те, кто отказался, — стереть их сверкой
 * значит стереть работу менеджера. По той же причине участник, убранный из мероприятия, из
 * кампании не исчезает: звонить ему всё ещё есть о чём.
 */

/**
 * Учётная запись, от имени которой работает сверка. Заведена миграцией и помечена
 * `suspended`: войти под ней нельзя, а в журналах видно, что контакт завела не рука.
 */
export const EVENT_CAMPAIGN_AUTOMATION_ADMIN_ID =
  "00000000-0000-4000-8000-000000000002";

export interface PendingEventCampaign {
  readonly campaignId: string;
  readonly eventId: string;
  readonly eventTitle: string;
}

export interface EventCampaignSyncRepository {
  /**
   * Кампании, где список участников ушёл вперёд отметки сверки. Мероприятия, законченные
   * давно, и кампании, закрытые или убранные в архив, сюда не попадают.
   */
  listPendingCampaigns(input: {
    readonly at: Date;
    readonly limit: number;
  }): Promise<readonly PendingEventCampaign[]>;
  markSynced(input: {
    readonly campaignId: string;
    readonly at: Date;
  }): Promise<void>;
}

/** Ровно то, что от службы обзвона нужно этому проходу, — не вся её поверхность. */
export interface EventParticipantsImporter {
  importEventParticipants(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    /**
     * Мероприятие, из которого берём участников. У постоянной воронки направления своего
     * мероприятия нет — у неё их столько, сколько встреч прошло, и каждую сверяем отдельно.
     */
    readonly eventId?: string;
    readonly assignedAdminId?: string | null;
    readonly now: Date;
  }): Promise<{
    readonly addedToCampaign: number;
    readonly alreadyInCampaign: number;
    readonly invalidRows: number;
  }>;
}

export interface SyncEventCampaignsResult {
  readonly campaigns: number;
  readonly added: number;
  readonly failed: number;
}

export class SyncEventCampaignsBatchService {
  constructor(
    private readonly repository: EventCampaignSyncRepository,
    private readonly importer: EventParticipantsImporter
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<SyncEventCampaignsResult> {
    const pending = await this.repository.listPendingCampaigns({
      at: input.at,
      limit: input.batchSize
    });
    let added = 0;
    let failed = 0;
    for (const campaign of pending) {
      try {
        const result = await this.importer.importEventParticipants({
          actor: EVENT_CAMPAIGN_ACTOR,
          campaignId: campaign.campaignId,
          eventId: campaign.eventId,
          // Ничей: ответственного назначает менеджер, когда берёт контакт в работу.
          // Служебная учётка в этом поле спрятала бы контакт из всех фильтров «мои».
          assignedAdminId: null,
          now: input.at
        });
        added += result.addedToCampaign;
        // Отметку ставим на время начала прохода, а не на «сейчас»: строки, изменённые
        // пока шёл импорт, должны достаться следующему кругу, а не потеряться между ними.
        await this.repository.markSynced({
          campaignId: campaign.campaignId,
          at: input.at
        });
      } catch {
        // Одна сломанная кампания не должна останавливать остальные. Отметку не ставим —
        // значит на следующем круге попробуем ещё раз.
        failed += 1;
      }
    }
    return { campaigns: pending.length, added, failed };
  }
}

const EVENT_CAMPAIGN_ACTOR: AdminRequestActor = {
  adminId: EVENT_CAMPAIGN_AUTOMATION_ADMIN_ID,
  authSubject: "system:event-campaign-sync",
  roleCodes: ["super_admin"],
  permission: "outreach.write"
};
