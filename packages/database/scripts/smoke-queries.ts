/**
 * Прогон запросов по настоящей базе.
 *
 * `db:sql:check` ловит запросы, где один параметр подставляется в колонки разных типов.
 * Есть второй класс ошибок, который не ловит ни он, ни типы, ни тесты: колонка, которой нет
 * в подзапросе или в таблице. Тесты работают на поддельном соединении и текст запроса не
 * разбирают, а Postgres такой запрос отвергает целиком — то есть страница отдаёт 500.
 *
 * Так уже случилось дважды: сначала с событием оплаты, потом со списком контактов воронки.
 * Этот скрипт поднимает пустую базу под миграциями и выполняет по ней каждый запрос,
 * который панель зовёт при обычной работе.
 *
 * Запуск:
 *   SMOKE_DATABASE_URL=postgresql://… node --import tsx packages/database/scripts/smoke-queries.ts
 *
 * База должна быть **пустой и не боевой**: скрипт заводит в ней тестовые строки и
 * по-настоящему их меняет.
 */
import { randomUUID } from "node:crypto";
import { createAdminOperationsPersistence } from "../src/admin-operations-persistence.js";
import { createAdminOutreachPersistence } from "../src/admin-outreach-persistence.js";
import { createAutoTaskPersistence } from "../src/auto-task-persistence.js";
import { createEventCampaignSyncPersistence } from "../src/event-campaign-sync-persistence.js";
import { createNodePostgresPool } from "../src/node-postgres.js";
import { createAdminStaffPersistence } from "../src/admin-staff-persistence.js";
import { createSiteRegistrationPersistence } from "../src/site-registration-persistence.js";
import { createRegistrationGreetingPersistence } from "../src/registration-greeting-persistence.js";
import { createChannelLookupQueue } from "../src/channel-lookup-persistence.js";
import { createAdminEventGreetingPersistence } from "../src/admin-event-greeting-persistence.js";
import { createAccountBroadcastPersistence } from "../src/account-broadcast-persistence.js";
import {
  createAdminConversationsPersistence,
  createAttachmentFilePersistence,
  createConversationReplyPersistence,
  createConversationReplyQueue
} from "../src/admin-conversation-persistence.js";
import { createAttachmentDownloadPersistence } from "../src/conversation-attachment-persistence.js";
import { createConversationPersistence } from "../src/conversation-persistence.js";
import {
  createZvonobotIntakePersistence,
  createZvonobotProcessingPersistence
} from "../src/zvonobot-persistence.js";

const CONNECTION = process.env.SMOKE_DATABASE_URL;
if (!CONNECTION) {
  console.error("Нужен SMOKE_DATABASE_URL: пустая база под миграциями, не боевая.");
  process.exit(1);
}

/** Служебные учётные записи заводит миграция городского формата. */
const SITE_ADMIN = "00000000-0000-4000-8000-000000000001";
const AUTOMATION_ADMIN = "00000000-0000-4000-8000-000000000002";
/** Учётная запись Звонобота: миграция 20260822160000. */
const ZVONOBOT_ADMIN = "00000000-0000-4000-8000-000000000003";

const now = new Date();
const failures: string[] = [];

/**
 * Телефон у контакта уникален в пределах базы, поэтому у каждого прогона он свой: иначе
 * второй запуск подряд падал бы на заготовке, а не на запросах, ради которых он затеян.
 */
function smokePhone(): string {
  return `+7999${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;
}

async function check(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`FAIL  ${name}`);
  }
}

async function main(): Promise<void> {
  const pool = createNodePostgresPool({ connectionString: CONNECTION as string });
  const outreach = createAdminOutreachPersistence(pool);
  const autoTasks = createAutoTaskPersistence(pool);
  const sync = createEventCampaignSyncPersistence(pool);
  const site = createSiteRegistrationPersistence(pool);
  const staff = createAdminStaffPersistence(pool).repository;

  const upcomingEventId = randomUUID();
  const pastEventId = randomUUID();
  const contactId = randomUUID();
  const memberId = randomUUID();
  const phone = smokePhone();

  const connection = await pool.connect();
  try {
    await seed(connection, {
      upcomingEventId,
      pastEventId,
      contactId,
      memberId,
      phone
    });
  } finally {
    connection.release();
  }

  const campaigns = await outreach.listCampaigns(false);
  const campaign = campaigns.find((item) => item.eventSlugPrefix === "sreda");
  if (!campaign) {
    console.error("Постоянной воронки «Бизнес-среда» нет — миграции применены не все.");
    process.exit(1);
  }
  const campaignId = campaign.id;

  console.log("Чтение:");
  await check("listCampaigns", () => outreach.listCampaigns(true));
  await check("getCampaign", () => outreach.getCampaign(campaignId));
  await check("listContacts", () => outreach.listContacts({
    campaignId, search: null, status: null, stage: null,
    assignedAdminId: null, page: 1, limit: 500
  }));
  await check("getContact", () => outreach.getContact(memberId));
  await check("listPeople", () => outreach.listPeople({
    search: null, filter: "all", page: 1, limit: 50
  }));
  await check("getPerson", () => outreach.getPerson(contactId, AUTOMATION_ADMIN));
  await check("listTaskBoard",
    () => outreach.listTaskBoard({ assignedAdminId: null, now }));
  await check("listPipelineColumns", () => outreach.listPipelineColumns(campaignId));
  await check("listCustomFieldDefinitions",
    () => outreach.listCustomFieldDefinitions(campaignId));
  await check("listBaseContacts", () => outreach.listBaseContacts({
    campaignId, search: null, onlyMissing: false, limit: 20
  }));
  await check("listEventParticipantRows",
    () => outreach.listEventParticipantRows(upcomingEventId));
  await check("exportCampaignContacts", () => outreach.exportCampaignContacts(campaignId));
  await check("listTaskRules", () => outreach.listTaskRules(campaignId));
  await check("getTaskGuard",
    () => outreach.getTaskGuard({ campaignContactId: memberId }));
  await check("getPipelineColumnOutcome", () => outreach.getPipelineColumnOutcome({
    campaignContactId: memberId, stage: "new"
  }));
  await check("listSiteRegistrations", () => outreach.listSiteRegistrations({
    onlyNeedsAttention: false, page: 1, limit: 20
  }));
  await check("listImports", () => outreach.listImports(10));
  await check("listPendingImportRows",
    () => outreach.listPendingImportRows({ importId: null, limit: 10 }));
  // Отбор поводов проверяем до записи: как только у карточки появится открытая задача,
  // автоматика её пропустит — и запрос вернёт пусто по делу, а не потому, что сломан.
  await check("autoTasks.listCandidates", async () => {
    const candidates = await autoTasks.listCandidates({ at: now, limit: 50 });
    console.log(`        поводов найдено: ${candidates.length}`);
    if (candidates.length === 0) {
      throw new Error(
        "Ни одного повода: у карточки впереди встреча, позади мероприятие и назначена"
        + " личная встреча — что-то в отборе не так"
      );
    }
  });

  console.log("\nЗапись:");
  await check("setPersonFieldValue", async () => {
    const person = await outreach.getPerson(contactId, AUTOMATION_ADMIN);
    const field = person?.fields[0];
    if (!field) {
      throw new Error("Общих полей нет: миграция не завела нишу и запрос");
    }
    await outreach.setPersonFieldValue({
      contactId, fieldId: field.fieldId, value: "Кофейни", now
    });
    await outreach.setPersonFieldValue({
      contactId, fieldId: field.fieldId, value: null, now
    });
  });
  await check("updatePerson", () => outreach.updatePerson({
    contactId,
    fields: {
      displayName: "Иван Проверкин", phoneE164: phone,
      telegramUsername: null, telegramUsernameNormalized: null,
      maxIdentifier: null, maxIdentifierNormalized: null,
      email: null, emailNormalized: null, source: "проверка", note: null
    },
    conflictCandidates: [],
    assignedAdminId: AUTOMATION_ADMIN,
    nextMeetingAt: new Date(now.getTime() + 86_400_000),
    actorAdminId: AUTOMATION_ADMIN,
    auditId: randomUUID(),
    now
  }));
  await check("updateCampaign", () => outreach.updateCampaign({
    campaignId, requireOpenTask: true, callWindowStart: 12, callWindowEnd: 19, now
  }));
  await check("updateTaskRule", async () => {
    const rules = await outreach.listTaskRules(campaignId);
    const rule = rules[0];
    if (!rule) {
      throw new Error("Правил автозадач нет: миграция не отработала");
    }
    await outreach.updateTaskRule({
      ruleId: rule.id,
      changes: { isEnabled: true, offsetDays: rule.offsetDays, taskText: rule.taskText },
      now
    });
  });
  const taskId = randomUUID();
  await check("createTask", () => outreach.createTask({
    id: taskId, contactId: null, campaignContactId: memberId,
    assignedAdminId: null, createdByAdminId: AUTOMATION_ADMIN,
    type: "call", text: "Проверка", dueAt: now, now
  }));
  await check("completeTask", () => outreach.completeTask({
    taskId, completedByAdminId: AUTOMATION_ADMIN, now
  }));
  // Касание со следующим шагом: именно здесь задача заводится без выбранного человека,
  // и именно этого не хватало.
  await check("recordActivities (со следующим шагом)", () => outreach.recordActivities({
    activities: [{
      id: randomUUID(),
      campaignContactId: memberId,
      stageHistoryId: randomUUID(),
      taskId: randomUUID()
    }],
    actorAdminId: AUTOMATION_ADMIN, action: "call", channel: "phone",
    result: "no_answer", note: "проверка", batchId: null,
    stage: "calling", lostReason: null,
    nextContactAt: new Date(now.getTime() + 86_400_000), occurredAt: now
  }));
  await check("updateContactStage", () => outreach.updateContactStage({
    campaignContactId: memberId, actorAdminId: AUTOMATION_ADMIN,
    historyId: randomUUID(), participantId: randomUUID(), stage: "invited",
    lostReason: null, now
  }));
  // Перенос в проигрышную колонку: причина обязательна, и её проверяет триггер.
  await check("updateContactStage (проигрыш)", () => outreach.updateContactStage({
    campaignContactId: memberId, actorAdminId: AUTOMATION_ADMIN,
    historyId: randomUUID(), participantId: randomUUID(), stage: "lost",
    lostReason: "declined", now
  }));

  console.log("\nАвтоматика:");
  await check("autoTasks.createTasks", async () => {
    const rules = await outreach.listTaskRules(campaignId);
    await autoTasks.createTasks({
      tasks: [{
        id: randomUUID(),
        ruleId: rules[0]?.id ?? "",
        campaignContactId: memberId,
        contactId,
        autoKey: `smoke:${randomUUID()}`,
        taskType: "call",
        taskText: "Проверка",
        dueAt: new Date(now.getTime() + 86_400_000)
      }],
      createdByAdminId: AUTOMATION_ADMIN,
      now
    });
  });
  await check("sync.listPendingCampaigns", async () => {
    const pending = await sync.listPendingCampaigns({ at: now, limit: 20 });
    console.log(`        пар «воронка и мероприятие»: ${pending.length}`);
  });
  await check("sync.markSynced", () => sync.markSynced({ campaignId, at: now }));

  console.log("\nПравила автозадач:");
  // Правило по стадии — единственное, у которого есть стадия, и в базе на неё нет
  // внешнего ключа. Проверяем и заведение, и снятие: снятое правило остаётся строкой,
  // на которую ссылаются уже поставленные задачи.
  await check("createTaskRule и deleteTaskRule", async () => {
    const columns = await outreach.listPipelineColumns(campaignId);
    const stage = columns[0]?.stage;
    if (!stage) {
      throw new Error("У воронки нет ни одной стадии");
    }
    const rule = await outreach.createTaskRule({
      ruleId: randomUUID(),
      campaignId,
      trigger: "stage_entered",
      stage,
      offsetDays: 1,
      useCallWindow: true,
      atHour: null,
      taskType: "call",
      taskText: "Проверка правила по стадии",
      now
    });
    if (!rule) {
      throw new Error("Правило не завелось: повод со стадией занят");
    }
    await outreach.deleteTaskRule({
      ruleId: rule.id,
      deletedByAdminId: AUTOMATION_ADMIN,
      now
    });
  });

  console.log("\nКоманда и окошки наставника:");
  await check("staff.listMembers", () => staff.listMembers());
  await check("staff.hasPermission",
    () => staff.hasPermission(AUTOMATION_ADMIN, "team.manage"));
  await check("staff.grantRole и revokeRole", async () => {
    await staff.grantRole({
      grantId: randomUUID(),
      adminId: AUTOMATION_ADMIN,
      roleCode: "mentor",
      grantedByAdminId: AUTOMATION_ADMIN,
      now
    });
    await staff.revokeRole({
      adminId: AUTOMATION_ADMIN,
      roleCode: "mentor",
      revokedByAdminId: AUTOMATION_ADMIN,
      now
    });
  });
  await check("staff.createSlots, bookSlot, releaseSlot, cancelSlot", async () => {
    const slotId = randomUUID();
    const startsAt = new Date(now.getTime() + 3 * 86_400_000);
    const created = await staff.createSlots({
      slots: [{
        id: slotId,
        mentorAdminId: AUTOMATION_ADMIN,
        startsAt,
        durationMinutes: 60,
        note: null
      }],
      createdByAdminId: AUTOMATION_ADMIN,
      now
    });
    if (created !== 1) {
      throw new Error("Окошко не завелось");
    }
    const outcome = await staff.bookSlot({
      slotId,
      contactId,
      bookedByAdminId: AUTOMATION_ADMIN,
      note: "проверка",
      now
    });
    if (outcome !== "booked") {
      throw new Error(`Запись не прошла: ${outcome}`);
    }
    // Повторная запись в занятое окошко — это ровно тот случай, ради которого условие
    // `contact_id is null` и стоит в запросе.
    const second = await staff.bookSlot({
      slotId,
      contactId,
      bookedByAdminId: AUTOMATION_ADMIN,
      note: null,
      now
    });
    if (second !== "already_booked") {
      throw new Error(`Занятое окошко перезаписалось: ${second}`);
    }
    await staff.releaseSlot({
      slotId,
      releasedByAdminId: AUTOMATION_ADMIN,
      now
    });
    await staff.cancelSlot({
      slotId,
      cancelledByAdminId: AUTOMATION_ADMIN,
      now
    });
  });
  await check("staff.listSlots", () => staff.listSlots({
    onlyFree: false,
    from: new Date(now.getTime() - 86_400_000),
    to: new Date(now.getTime() + 30 * 86_400_000)
  }));

  console.log("\nЗаявка с сайта:");
  await check("findStandingCampaign", async () => {
    const standing = await site.repository.findStandingCampaign("sreda");
    if (!standing) {
      throw new Error("Постоянная воронка не нашлась по префиксу слага");
    }
    console.log(`        колонка заявок: ${standing.stage}`);
  });
  await check("findRegistrationEvent",
    () => site.repository.findRegistrationEvent({ slugPrefix: "sreda", now, date: null }));
  await check("findRegistrationEvent в выбранный день", () => site.repository.findRegistrationEvent({
    slugPrefix: "chursin", now, date: "2026-10-28"
  }));
  await check("findParticipantByPhone", () => site.repository.findParticipantByPhone({
    eventId: upcomingEventId, phoneE164: phone
  }));
  const greetedRegistrationId = randomUUID();
  await check("createParticipant с карточкой и звонком", () => site.unitOfWork.transact(
    () => site.repository.createParticipant({
      registrationId: greetedRegistrationId,
      participantId: randomUUID(),
      contactSeedId: randomUUID(),
      eventId: upcomingEventId,
      name: "Пётр Заявкин",
      phoneE164: smokePhone(),
      consentAt: now,
      page: "sreda",
      createdByAdminId: SITE_ADMIN,
      attribution: null,
      enrollment: {
        campaignId,
        campaignContactId: randomUUID(),
        stage: "new",
        task: {
          taskId: randomUUID(),
          ruleId: null,
          text: "Позвонить по заявке с сайта",
          dueAt: new Date(now.getTime() + 3_600_000)
        },
        assignedAdminId: SITE_ADMIN
      }
    })
  ));

  // Приветствие по заявке: заявка выше завела строку в ожидании. Проходим всю цепочку —
  // проверка нашла человека, приветствие легло в очередь аккаунта, карточка его показывает.
  console.log("\nПриветствие по заявке:");
  const greetings = createRegistrationGreetingPersistence(pool).repository;
  const lookups = createChannelLookupQueue(pool).queue;
  let greetedContactId: string | null = null;
  await check("greetings listPending", async () => {
    const pending = await greetings.listPending({ batchSize: 50 });
    const own = pending.find((item) => item.registrationId === greetedRegistrationId);
    if (!own) {
      throw new Error("Заявка с сайта не завела приветствие в ожидании");
    }
    greetedContactId = own.contactId;
    console.log(`        проверки: ${JSON.stringify(own.lookups)}`);
  });
  const greetingConversationId = randomUUID();
  await check("lookups markFound для приветствия", async () => {
    if (greetedContactId === null) {
      throw new Error("Нет человека из заявки");
    }
    await lookups.markFound({
      contactId: greetedContactId,
      channel: "telegram",
      externalUserId: String(Math.floor(Math.random() * 1_000_000_000)),
      externalChatId: String(Math.floor(Math.random() * 1_000_000_000)),
      username: null,
      conversationId: greetingConversationId,
      at: now
    });
  });
  await check("greetings listPending видит ветку", async () => {
    const pending = await greetings.listPending({ batchSize: 50 });
    const own = pending.find((item) => item.registrationId === greetedRegistrationId);
    if (own?.conversations.telegram !== greetingConversationId) {
      throw new Error(`Ветка Telegram не видна: ${JSON.stringify(own?.conversations)}`);
    }
  });
  await check("greetings queueGreeting", async () => {
    if (greetedContactId === null) {
      throw new Error("Нет человека из заявки");
    }
    const accepted = await greetings.queueGreeting({
      registrationId: greetedRegistrationId,
      contactId: greetedContactId,
      actorAdminId: SITE_ADMIN,
      channel: "telegram",
      conversationId: greetingConversationId,
      messageId: randomUUID(),
      body: "Привет! На связи Бизнес-Прорыв",
      at: now
    });
    if (!accepted) {
      throw new Error("Приветствие в ожидании не приняло реплику");
    }
    const again = await greetings.queueGreeting({
      registrationId: greetedRegistrationId,
      contactId: greetedContactId,
      actorAdminId: SITE_ADMIN,
      channel: "telegram",
      conversationId: greetingConversationId,
      messageId: randomUUID(),
      body: "Привет ещё раз",
      at: now
    });
    if (again) {
      throw new Error("Второе приветствие по той же заявке легло в очередь");
    }
  });
  await check("greetings countQueuedSince", () => greetings.countQueuedSince({
    since: new Date(now.getTime() - 86_400_000)
  }));
  await check("greetings markSkipped и markNoChannel", async () => {
    await greetings.markSkipped({
      registrationId: randomUUID(), reason: "проверка", at: now
    });
    await greetings.markNoChannel({ registrationId: randomUUID(), at: now });
  });
  await check("getPerson показывает приветствие", async () => {
    if (greetedContactId === null) {
      throw new Error("Нет человека из заявки");
    }
    const person = await outreach.getPerson(greetedContactId, AUTOMATION_ADMIN);
    const registration = person?.siteRegistrations
      .find((item) => item.id === greetedRegistrationId);
    if (registration?.greeting?.state !== "queued" || registration.greeting.channel !== "telegram") {
      throw new Error(`В карточке не то: ${JSON.stringify(registration?.greeting)}`);
    }
  });

  // Настройки приветствия мероприятия: экран в панели. Сохраняем дважды — второй раз идёт
  // через `on conflict`, и именно он ломается, если перепутать колонки.
  const greetingSettings = createAdminEventGreetingPersistence(pool).repository;
  await check("eventGreeting saveSettings и loadSettings", async () => {
    await greetingSettings.saveSettings({
      eventId: upcomingEventId, isEnabled: true,
      eventPhrase: "Открытой встрече предпринимателей", bodyTemplate: null,
      adminId: AUTOMATION_ADMIN, at: now
    });
    await greetingSettings.saveSettings({
      eventId: upcomingEventId, isEnabled: false,
      eventPhrase: null, bodyTemplate: "Ждём вас {когда}",
      adminId: AUTOMATION_ADMIN, at: now
    });
    const stored = await greetingSettings.loadSettings(upcomingEventId);
    if (stored?.isEnabled !== false || stored.bodyTemplate !== "Ждём вас {когда}") {
      throw new Error(`Сохранилось не то: ${JSON.stringify(stored)}`);
    }
  });
  await check("eventGreeting findEvent и countGreetings", async () => {
    const found = await greetingSettings.findEvent(upcomingEventId);
    const stats = await greetingSettings.countGreetings(upcomingEventId);
    if (!found || stats.queued < 1) {
      throw new Error(`Мероприятие или итоги не те: ${JSON.stringify({ found, stats })}`);
    }
  });
  await check("eventGreeting hasPermission",
    () => greetingSettings.hasPermission(AUTOMATION_ADMIN, "events.write"));
  await check("greetings listPending с настройками мероприятия",
    () => greetings.listPending({ batchSize: 50 }));

  // Списки людей и заказов: то, что панель открывает первым делом. Здесь легко потерять
  // колонку, которой нет в подзапросе, — Postgres отвергнет запрос целиком, и страница
  // отдаст 500. Именно так уже случалось со списком контактов воронки.
  // Рассылка от рабочего аккаунта: «Избранное» → подсчёт → запуск → отправка → история.
  // Участник мероприятия из заготовки получает ветку Telegram через проверку номера, как
  // на боевом, и рассылка доходит до него по всей цепочке.
  console.log("\nРассылка от рабочего аккаунта:");
  const accountBroadcasts = createAccountBroadcastPersistence(pool);
  const broadcastChatId = String(Math.floor(Math.random() * 1_000_000_000) + 1);
  const savedBase = BigInt(Math.floor(Math.random() * 1_000_000) + 1) * 1_048_576n;
  const circleExternalId = savedBase.toString();
  const textExternalId = (savedBase + 1_048_576n).toString();
  await check("lookups markFound для рассылки", () => lookups.markFound({
    contactId,
    channel: "telegram",
    externalUserId: broadcastChatId,
    externalChatId: broadcastChatId,
    username: null,
    conversationId: randomUUID(),
    at: now
  }));
  await check("savedMessages syncSeen", () => accountBroadcasts.savedMessages.syncSeen({
    ids: [textExternalId, circleExternalId],
    messages: [
      {
        externalMessageId: circleExternalId, kind: "video_note", body: null,
        durationSeconds: 42, minithumbnailBase64: "AAAA", externalFileId: "55",
        fileName: "Кружок.mp4", mimeType: "video/mp4", sizeBytes: 2_000_000, sentAt: now
      },
      {
        externalMessageId: textExternalId, kind: "text", body: "Ждём вас во вторник",
        durationSeconds: null, minithumbnailBase64: null, externalFileId: null,
        fileName: null, mimeType: null, sizeBytes: null, sentAt: now
      }
    ],
    fileKinds: ["video_note"],
    maxFileBytes: 5_000_000,
    at: now
  }));
  // Второй проход видит то же окно, но у кружка сменился номер файла у TDLib: строка
  // обновляется через `on conflict`, а не заводится заново.
  await check("savedMessages syncSeen второй раз (on conflict)", () =>
    accountBroadcasts.savedMessages.syncSeen({
      ids: [textExternalId, circleExternalId],
      messages: [
        {
          externalMessageId: circleExternalId, kind: "video_note", body: null,
          durationSeconds: 42, minithumbnailBase64: "AAAA", externalFileId: "56",
          fileName: "Кружок.mp4", mimeType: "video/mp4", sizeBytes: 2_000_000, sentAt: now
        },
        {
          externalMessageId: textExternalId, kind: "text", body: "Ждём вас во вторник",
          durationSeconds: null, minithumbnailBase64: null, externalFileId: null,
          fileName: null, mimeType: null, sizeBytes: null, sentAt: now
        }
      ],
      fileKinds: ["video_note"],
      maxFileBytes: 5_000_000,
      at: now
    })
  );
  let savedIds: string[] = [];
  await check("account listSavedMessages", async () => {
    const listed = await accountBroadcasts.admin.listSavedMessages({ limit: 30 });
    savedIds = listed.items
      .filter((item) => item.kind === "video_note" || item.body === "Ждём вас во вторник")
      .map((item) => item.id);
    if (savedIds.length !== 2 || listed.lastSyncedAt === null) {
      throw new Error(`Не то в «Избранном»: ${JSON.stringify(listed.items)}`);
    }
  });
  await check("savedMessages listPendingFiles и markFileStored", async () => {
    const pending = await accountBroadcasts.savedMessages.listPendingFiles({ limit: 10, maxAttempts: 3 });
    const circle = pending.find((item) => item.externalFileId === "56");
    if (!circle) {
      throw new Error(`Кружок не ждёт скачивания: ${JSON.stringify(pending)}`);
    }
    await accountBroadcasts.savedMessages.markFileStored({
      savedMessageId: circle.savedMessageId,
      storagePath: "2026/11/circle.mp4",
      sha256: "a".repeat(64),
      sizeBytes: 1_999_999,
      at: now
    });
    const file = await accountBroadcasts.admin.findSavedMessageFile(circle.savedMessageId);
    if (file?.storagePath !== "2026/11/circle.mp4") {
      throw new Error("Файл кружка не находится");
    }
  });
  await check("savedMessages markFileFailed", () => accountBroadcasts.savedMessages.markFileFailed({
    savedMessageId: randomUUID(), giveUp: true, at: now
  }));
  await check("account eventExists", () => accountBroadcasts.admin.eventExists(upcomingEventId));
  await check("account countAudience", async () => {
    const counts = await accountBroadcasts.admin.countAudience({
      eventId: upcomingEventId,
      savedMessageIds: savedIds
    });
    if (counts.reachable < 1) {
      throw new Error(`Участник с веткой не виден: ${JSON.stringify(counts)}`);
    }
  });
  await check("account findTestRecipient", () => accountBroadcasts.admin.findTestRecipient({
    username: "nobody_here", phoneE164: phone
  }));
  const liveBroadcastId = randomUUID();
  await check("account createBroadcast по мероприятию", async () => {
    const outcome = await accountBroadcasts.admin.createBroadcast({
      broadcastId: liveBroadcastId,
      adminId: AUTOMATION_ADMIN,
      savedMessageIds: savedIds,
      target: { kind: "event", eventId: upcomingEventId, limit: 5_000 },
      at: now
    });
    if (outcome.kind !== "created") {
      throw new Error(`Рассылка не завелась: ${JSON.stringify(outcome)}`);
    }
    const again = await accountBroadcasts.admin.createBroadcast({
      broadcastId: randomUUID(),
      adminId: AUTOMATION_ADMIN,
      savedMessageIds: savedIds,
      target: { kind: "event", eventId: upcomingEventId, limit: 5_000 },
      at: now
    });
    if (again.kind !== "already_sending") {
      throw new Error(`Вторая рассылка по тому же мероприятию прошла: ${again.kind}`);
    }
  });
  await check("account queue activePause и countSentSince", async () => {
    await accountBroadcasts.queue.activePause(now);
    await accountBroadcasts.queue.countSentSince(new Date(now.getTime() - 86_400_000));
  });
  let broadcastSent = 0;
  await check("account queue claimNext и markSent", async () => {
    // Участников с веткой у мероприятия заготовки может быть больше одного: отправляем
    // всем, пока очередь не опустеет, — иначе рассылку нечем будет закрыть.
    for (let round = 0; round < 10; round += 1) {
      const claimed = await accountBroadcasts.queue.claimNext({
        at: now, includeLive: true, leaseUntil: new Date(now.getTime() + 600_000)
      });
      if (claimed === null) {
        break;
      }
      if (claimed.broadcastId !== liveBroadcastId || claimed.parts.length !== 2) {
        throw new Error(`Взяли не того: ${JSON.stringify(claimed)}`);
      }
      if (claimed.parts[0]?.kind !== "video_note") {
        throw new Error("Порядок частей не тот: кружок записан раньше текста");
      }
      // Первому уходит всё, остальным — без кружка: так Telegram поступает с теми, у кого
      // закрыты видеосообщения, и история обязана показать это причиной.
      const delivered = round === 0
        ? claimed.parts
        : claimed.parts.filter((part) => part.kind !== "video_note");
      await accountBroadcasts.queue.markSent({
        recipient: claimed,
        parts: delivered,
        messageId: randomUUID(),
        attachmentIds: [randomUUID()],
        providerMessageIds: [`${9001 + round * 2}`, `${9002 + round * 2}`],
        body: "Ждём вас во вторник",
        partialReason: round === 0 ? null : "ушло частично: Telegram не пропустил кружок",
        at: now
      });
      broadcastSent += 1;
    }
    if (broadcastSent === 0) {
      throw new Error("Некого было отправлять");
    }
  });
  await check("account queue release, markFailed, pauseAll", async () => {
    await accountBroadcasts.queue.release({
      recipientId: randomUUID(), reason: "проверка", retryAt: now, countAttempt: true, at: now
    });
    await accountBroadcasts.queue.markFailed({ recipientId: randomUUID(), reason: "проверка", at: now });
    await accountBroadcasts.queue.pauseAll({
      until: new Date(now.getTime() - 1_000), reason: "проверка", at: now
    });
  });
  await check("account queue completeFinished", async () => {
    const completed = await accountBroadcasts.queue.completeFinished(now);
    if (completed < 1) {
      throw new Error("Рассылка, где ждать некого, не закрылась");
    }
  });
  const testBroadcastId = randomUUID();
  await check("account createBroadcast пробная и остановка", async () => {
    const recipient = await accountBroadcasts.admin.findTestRecipient({
      username: null, phoneE164: phone
    });
    if (recipient === null) {
      throw new Error("Пробный получатель по телефону не нашёлся");
    }
    const outcome = await accountBroadcasts.admin.createBroadcast({
      broadcastId: testBroadcastId,
      adminId: AUTOMATION_ADMIN,
      savedMessageIds: savedIds,
      target: { kind: "test", recipient, recipientId: randomUUID() },
      at: now
    });
    if (outcome.kind !== "created") {
      throw new Error(`Пробная не завелась: ${outcome.kind}`);
    }
    await accountBroadcasts.queue.stopBroadcast({ broadcastId: testBroadcastId, reason: "проверка", at: now });
    await accountBroadcasts.admin.cancelBroadcast({
      broadcastId: testBroadcastId, adminId: AUTOMATION_ADMIN, reason: "проверка", at: now
    });
  });
  await check("account listBroadcasts", async () => {
    const items = await accountBroadcasts.admin.listBroadcasts(30);
    const live = items.find((item) => item.id === liveBroadcastId);
    if (live?.status !== "completed" || live.sentCount !== broadcastSent || live.parts.length !== 2) {
      throw new Error(`История не та: ${JSON.stringify(live)}`);
    }
    if (broadcastSent > 1 && live.failureReasons.length === 0) {
      throw new Error("Частичная доставка не видна в причинах");
    }
  });
  await check("account countAudience после отправки видит «уже получили»", async () => {
    const counts = await accountBroadcasts.admin.countAudience({
      eventId: upcomingEventId,
      savedMessageIds: savedIds
    });
    if (counts.alreadyReceived < 1) {
      throw new Error(`Получивший не учтён: ${JSON.stringify(counts)}`);
    }
  });
  await check("savedMessages markDeleted", () => accountBroadcasts.savedMessages.markDeleted({
    externalMessageIds: [randomUUID()], at: now
  }));
  // Проход видит только кружок, а текст новее его: текст пропал из окна — значит удалён.
  await check("savedMessages syncSeen отмечает удалённое в окне", async () => {
    await accountBroadcasts.savedMessages.syncSeen({
      ids: [circleExternalId],
      messages: [{
        externalMessageId: circleExternalId, kind: "video_note", body: null,
        durationSeconds: 42, minithumbnailBase64: "AAAA", externalFileId: "56",
        fileName: "Кружок.mp4", mimeType: "video/mp4", sizeBytes: 2_000_000, sentAt: now
      }],
      fileKinds: ["video_note"],
      maxFileBytes: 5_000_000,
      at: now
    });
    const listed = await accountBroadcasts.admin.listSavedMessages({ limit: 30 });
    if (listed.items.some((item) => item.body === "Ждём вас во вторник")) {
      throw new Error("Удалённый текст всё ещё виден в «Избранном»");
    }
    const circle = listed.items.find((item) => item.kind === "video_note");
    if (circle?.hasFile !== true) {
      throw new Error("Повторный проход стёр отметку о скачанном файле");
    }
  });

  console.log("\nСписки панели:");
  const operations = createAdminOperationsPersistence(pool);
  await check("listUsers", async () => {
    const users = await operations.listUsers({
      search: null, blocked: null, cursor: null, limit: 20
    });
    console.log(`        людей: ${users.length}, каналы первого: ${
      users[0] ? JSON.stringify(users[0].channels) : "—"
    }`);
  });
  await check("listUsers с поиском", () => operations.listUsers({
    search: "иван", blocked: null, cursor: null, limit: 20
  }));
  await check("listOrders", async () => {
    const orders = await operations.listOrders({
      search: null, status: null, userId: null, eventId: null,
      includeExcluded: true, cursor: null, limit: 20
    });
    console.log(`        заказов: ${orders.length}`);
  });
  await check("listOrders с отбором по статусу и мероприятию", () => operations.listOrders({
    search: "BP", status: "paid", userId: null, eventId: upcomingEventId,
    includeExcluded: false, cursor: null, limit: 20
  }));
  await check("getUser", () => operations.getUser(contactId));
  await check("getOrder", () => operations.getOrder(upcomingEventId));

  // Звонобот: приём вебхука и разбор принятого. Разбор заводит человека, карточку в
  // воронке и звонок — то есть трогает те же таблицы, что и заявка с сайта, и ломается
  // от той же ошибки в колонке.
  const zvonobotIntake = createZvonobotIntakePersistence(pool);
  const zvonobot = createZvonobotProcessingPersistence(pool);
  const zvonobotCallId = randomUUID();
  await check("zvonobot store", () => zvonobotIntake.repository.store({
    id: zvonobotCallId,
    externalCallId: `smoke-${zvonobotCallId}`,
    campaignName: "Проверка",
    phoneE164: smokePhone(),
    pressedButton: "1",
    durationSeconds: 42,
    payload: { phone: "+79990000000", button: "1" },
    receivedAt: now
  }));
  await check("zvonobot loadSettings", () => zvonobot.repository.loadSettings());
  await check("zvonobot findCampaign", async () => {
    const found = await zvonobot.repository.findCampaign("sreda");
    console.log(`        колонка заявок робота: ${found?.stage ?? "нет воронки"}`);
  });
  await check("zvonobot claimPending", () => zvonobot.repository.claimPending(10));
  await check("zvonobot createLead с карточкой и звонком", () =>
    zvonobot.repository.createLead({
      callId: zvonobotCallId,
      phoneE164: smokePhone(),
      campaignName: "Проверка",
      pressedButton: "1",
      contactSeedId: randomUUID(),
      noteId: randomUUID(),
      campaignId,
      campaignContactId: randomUUID(),
      stage: "new",
      assignedAdminId: ZVONOBOT_ADMIN,
      task: {
        taskId: randomUUID(),
        ruleId: null,
        text: "Позвонить: человек ответил роботу",
        dueAt: new Date(now.getTime() + 3_600_000)
      },
      processedAt: now
    }));
  await check("zvonobot markSettled", () => zvonobot.repository.markSettled({
    callId: randomUUID(),
    status: "ignored",
    processedAt: now
  }));

  // Переписка. Запись входящего трогает четыре таблицы сразу — диалог, реплику, вложение и
  // карточку человека, — и ошибка в любой из них означает, что бот молчит: ответ уходит
  // после записи. Повтор и правка проверяются здесь же: оба ловятся частичными уникальными
  // индексами, а частичный индекс — ровно то, чего не видно ни в типах, ни в тестах.
  const conversations = createConversationPersistence(pool).repository;
  const smokeChat = `smoke-${randomUUID()}`;
  const smokeSender = {
    externalUserId: smokeChat,
    username: `smoke_${Math.floor(Math.random() * 1_000_000)}`,
    displayName: "Проверка"
  };
  const incoming = {
    channel: "telegram",
    transport: "bot",
    externalChatId: smokeChat,
    sender: smokeSender,
    externalMessageId: "1",
    editsExternalMessageId: null,
    body: "а с ребёнком можно?",
    attachments: [],
    occurredAt: now,
    payload: { update_id: 1 }
  } as const;
  await check("conversations recordIncoming", () => conversations.recordIncoming({
    ...incoming,
    conversationId: randomUUID(),
    messageId: randomUUID(),
    contactId: randomUUID(),
    attachmentIds: [],
    taskId: randomUUID()
  }));
  await check("conversations recordIncoming повтор", async () => {
    const again = await conversations.recordIncoming({
      ...incoming,
      conversationId: randomUUID(),
      messageId: randomUUID(),
      contactId: randomUUID(),
      attachmentIds: [],
      taskId: randomUUID()
    });
    if (again.stored) {
      throw new Error("повтор вебхука записался второй строкой");
    }
  });
  await check("conversations recordIncoming правка", async () => {
    const edited = await conversations.recordIncoming({
      ...incoming,
      editsExternalMessageId: "1",
      body: "а с двумя детьми можно?",
      occurredAt: new Date(now.getTime() + 60_000),
      conversationId: randomUUID(),
      messageId: randomUUID(),
      contactId: randomUUID(),
      attachmentIds: [],
      taskId: randomUUID()
    });
    if (!edited.stored) {
      throw new Error("правка не легла рядом с исходной репликой");
    }
  });
  await check("conversations recordIncoming с вложением", () => conversations.recordIncoming({
    ...incoming,
    externalMessageId: "2",
    body: null,
    attachments: [{
      kind: "voice",
      fileName: null,
      mimeType: "audio/ogg",
      sizeBytes: 41_234,
      externalFileId: `smoke-${randomUUID()}`
    }],
    occurredAt: new Date(now.getTime() + 120_000),
    conversationId: randomUUID(),
    messageId: randomUUID(),
    contactId: randomUUID(),
    attachmentIds: [randomUUID()],
    taskId: randomUUID()
  }));
  await check("conversations recordOutgoing", () => conversations.recordOutgoing({
    channel: "telegram",
    transport: "bot",
    externalChatId: smokeChat,
    recipient: smokeSender,
    conversationId: randomUUID(),
    messageId: randomUUID(),
    contactId: randomUUID(),
    authorKind: "bot",
    authorAdminId: null,
    body: "Детский билет — 1500 ₽",
    externalMessageId: "3",
    deliveryStatus: "sent",
    failureReason: null,
    occurredAt: new Date(now.getTime() + 130_000)
  }));

  // WhatsApp: тот же приём, но карточка человека заводится по телефону, а не по нику. Путь
  // это новый и целиком на стороне SQL — вставка с `phone_e164` и поиск по уникальному
  // индексу на нём. Заодно проверяется расширенное ограничение канала: до миграции
  // `conversations_channel_check` отверг бы эту запись целиком.
  const smokePhoneDigits = `7999${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
  const whatsappJid = `${smokePhoneDigits}@s.whatsapp.net`;
  await check("conversations recordIncoming (WhatsApp, карточка по телефону)", async () => {
    const recorded = await conversations.recordIncoming({
      channel: "whatsapp",
      transport: "account",
      externalChatId: whatsappJid,
      sender: {
        externalUserId: smokePhoneDigits,
        username: null,
        displayName: "Проверка WhatsApp"
      },
      externalMessageId: `wa-${randomUUID()}`,
      editsExternalMessageId: null,
      body: "здравствуйте, я записывалась на среду",
      attachments: [{
        kind: "photo",
        fileName: null,
        mimeType: "image/jpeg",
        sizeBytes: 204_800,
        externalFileId: `wa:${randomUUID()}`
      }],
      occurredAt: new Date(now.getTime() + 140_000),
      payload: { key: { id: "wa-1" }, message: { conversation: "здравствуйте" } },
      conversationId: randomUUID(),
      messageId: randomUUID(),
      contactId: randomUUID(),
      attachmentIds: [randomUUID()],
      taskId: randomUUID()
    });
    if (!recorded.stored) {
      throw new Error("входящее из WhatsApp не записалось");
    }
  });

  // Очередь скачивания вложений. Отбор здесь — не обычный select: одним запросом идут
  // блокировка с пропуском занятых, аренда строки и join до канала через две таблицы.
  // Ровно такой запрос Postgres и отвергает целиком, если в нём ошибиться колонкой.
  //
  // Заодно проверяем область ответственности: процесс, забравший чужой канал, отправить
  // его не может и только похоронит реплику с пометкой «канал отключён».
  const assertChannelsWithin = (
    claimed: readonly { readonly channel: string }[],
    allowed: readonly string[],
    what: string
  ): void => {
    const alien = claimed.find((row) => !allowed.includes(row.channel));
    if (alien) {
      throw new Error(`${what}: забран чужой канал ${alien.channel}`);
    }
  };
  const accountAttachments = createAttachmentDownloadPersistence(pool, {
    transport: "account",
    channels: ["telegram"]
  }).repository;
  await check("attachments claimPending (аккаунт)", async () => {
    // Тот же запрос с другим транспортом и отбором по каналу. Проверка дешёвая, а смысл в
    // ней есть: очередь аккаунта читает отдельный процесс, и её молчание выглядит точно так
    // же, как пустая очередь, — то есть никак.
    const claimed = await accountAttachments.claimPending({ batchSize: 5, at: now });
    assertChannelsWithin(claimed, ["telegram"], "вложения аккаунта Telegram");
    console.log(`        вложений аккаунта в очереди: ${String(claimed.length)}`);
    for (const attachment of claimed) {
      await accountAttachments.markAttemptFailed({
        attachmentId: attachment.id,
        reason: "смоук",
        at: now,
        retryAt: now
      });
    }
  });

  const whatsappAttachments = createAttachmentDownloadPersistence(pool, {
    transport: "account",
    channels: ["whatsapp"]
  }).repository;
  await check("attachments claimPending (WhatsApp, тело реплики)", async () => {
    // У WhatsApp файл зашифрован ключом своего сообщения, и загрузчику нужно само
    // сообщение, а не идентификатор файла. Здесь проверяется, что `payload` доезжает до
    // очереди: без него канал скачал бы ноль вложений, и выглядело бы это как «файлов нет».
    const claimed = await whatsappAttachments.claimPending({ batchSize: 5, at: now });
    assertChannelsWithin(claimed, ["whatsapp"], "вложения аккаунта WhatsApp");
    const withoutPayload = claimed.find((row) => row.payload === null);
    if (withoutPayload) {
      throw new Error("вложение приехало без тела реплики — скачать его будет нечем");
    }
    console.log(`        вложений WhatsApp в очереди: ${String(claimed.length)}`);
    for (const attachment of claimed) {
      await whatsappAttachments.markAttemptFailed({
        attachmentId: attachment.id,
        reason: "смоук",
        at: now,
        retryAt: now
      });
    }
  });

  const attachments = createAttachmentDownloadPersistence(pool, {
    transport: "bot",
    channels: ["telegram", "max"]
  }).repository;
  await check("attachments claimPending", async () => {
    const claimed = await attachments.claimPending({ batchSize: 5, at: now });
    assertChannelsWithin(claimed, ["telegram", "max"], "вложения ботов");
    console.log(`        вложений в очереди: ${String(claimed.length)}`);
    for (const attachment of claimed) {
      // Возвращаем взятое обратно в очередь: смоук не должен оставлять за собой
      // арендованные строки, которые следующий прогон не увидит.
      await attachments.markAttemptFailed({
        attachmentId: attachment.id,
        reason: "смоук",
        at: now,
        retryAt: now
      });
    }
  });
  await check("attachments markStored", () => attachments.markStored({
    attachmentId: randomUUID(),
    stored: {
      storagePath: "2026/08/smoke.ogg",
      sha256: "a".repeat(64),
      sizeBytes: 4_096
    },
    at: now
  }));
  await check("attachments markAttemptFailed", () => attachments.markAttemptFailed({
    attachmentId: randomUUID(),
    reason: "смоук",
    at: now,
    retryAt: null
  }));

  // Переписка в карточке. Запрос собирает цепочку объединённых карточек рекурсивным CTE,
  // джойнит реплики с диалогами и добирает вложения по массиву идентификаторов — то есть
  // ровно то, что не проверяется ни типами, ни тестами на поддельном соединении.
  const personConversations = createAdminConversationsPersistence(pool).repository;
  await check("conversations getPersonConversations", async () => {
    const found = await personConversations.getPersonConversations({
      contactId,
      limit: 50,
      before: null,
      search: null
    });
    console.log(
      `        диалогов: ${String(found.threads.length)}, реплик: ${String(found.messages.length)}`
    );
  });
  await check("conversations getPersonConversations с поиском и курсором", () =>
    personConversations.getPersonConversations({
      contactId,
      limit: 10,
      before: now,
      search: "билет"
    }));

  // Очередь ответов менеджера. Постановка идёт транзакцией с четырьмя запросами, а отбор —
  // блокировкой с арендой и джойном до диалога: и то и другое Postgres отвергает целиком,
  // если ошибиться колонкой, а тесты этого не видят.
  const replies = createConversationReplyPersistence(pool);
  const replyQueue = createConversationReplyQueue(pool, {
    transport: "bot",
    channels: ["telegram", "max"]
  });
  const accountReplyQueue = createConversationReplyQueue(pool, {
    transport: "account",
    channels: ["telegram"]
  });
  await check("conversations queueReply в несуществующий диалог", async () => {
    const result = await replies.repository.queueReply({
      conversationId: randomUUID(),
      messageId: randomUUID(),
      authorAdminId: SITE_ADMIN,
      body: "смоук",
      occurredAt: now,
      takeOver: false
    });
    if (result.status !== "not_found") {
      throw new Error("несуществующий диалог не должен принимать ответ");
    }
  });
  // Ветка бота MAX только читается: там разговаривает аккаунт компании. Правило стоит в
  // той же транзакции, что и постановка в очередь, и проверить его можно только по базе:
  // нужен настоящий диалог с нужным каналом и транспортом.
  await check("conversations queueReply в ветку бота MAX отвергается", async () => {
    const maxChat = `smoke-max-${randomUUID()}`;
    const conversation = await conversations.recordIncoming({
      channel: "max",
      transport: "bot",
      externalChatId: maxChat,
      sender: { externalUserId: maxChat, username: null, displayName: "Проверка MAX" },
      externalMessageId: "1",
      editsExternalMessageId: null,
      body: "а с ребёнком можно?",
      attachments: [],
      occurredAt: now,
      payload: { update_type: "message_created" },
      conversationId: randomUUID(),
      messageId: randomUUID(),
      contactId: randomUUID(),
      attachmentIds: [],
      taskId: randomUUID()
    });

    const result = await replies.repository.queueReply({
      conversationId: conversation.conversationId,
      messageId: randomUUID(),
      authorAdminId: SITE_ADMIN,
      body: "смоук",
      occurredAt: now,
      takeOver: false
    });
    if (result.status !== "read_only") {
      throw new Error(`ответ в ветку бота MAX встал в очередь: ${result.status}`);
    }
  });
  await check("conversations claimQueued", async () => {
    const claimed = await replyQueue.queue.claimQueued({ batchSize: 5, at: now });
    assertChannelsWithin(claimed, ["telegram", "max"], "ответы ботов");
  });
  // Та же очередь другим транспортом и другим каналом: её читает процесс аккаунта, и её
  // молчание выглядит ровно так же, как отсутствие ответов, — то есть никак.
  await check("conversations claimQueued (аккаунт)", async () => {
    const claimed = await accountReplyQueue.queue.claimQueued({ batchSize: 5, at: now });
    assertChannelsWithin(claimed, ["telegram"], "ответы аккаунта Telegram");
  });
  await check("conversations markSent", () => replyQueue.queue.markSent({
    messageId: randomUUID(),
    providerMessageId: "1",
    at: now
  }));
  await check("conversations markAttemptFailed", () => replyQueue.queue.markAttemptFailed({
    messageId: randomUUID(),
    reason: "смоук",
    at: now,
    retryAt: null
  }));

  await check("conversations findStored вложения", () =>
    createAttachmentFilePersistence(pool).repository.findStored(randomUUID()));

  await pool.close();

  if (failures.length > 0) {
    console.error("\nЗапросы, которые база отвергла:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("\nВсе запросы прошли по настоящей базе.");
}

/** Минимум строк, на которых запросы идут по данным, а не по пустоте. */
async function seed(
  connection: { query(text: string, values?: readonly unknown[]): Promise<unknown> },
  ids: {
    readonly upcomingEventId: string;
    readonly pastEventId: string;
    readonly contactId: string;
    readonly memberId: string;
    readonly phone: string;
  }
): Promise<void> {
  await connection.query(
    `insert into public.events (
       id, slug, title, starts_at, ends_at, capacity, status, format, is_free
     ) values
       ($1::uuid, $3::text, 'Проверочная среда, впереди',
        now() + interval '5 days', now() + interval '5 days 3 hours',
        100, 'published', 'city', true),
       ($2::uuid, $4::text, 'Проверочная среда, прошла',
        now() - interval '9 days', now() - interval '9 days' + interval '3 hours',
        100, 'published', 'city', true)`,
    [
      ids.upcomingEventId,
      ids.pastEventId,
      `sreda-smoke-${ids.upcomingEventId.slice(0, 8)}`,
      `sreda-smoke-${ids.pastEventId.slice(0, 8)}`
    ]
  );
  await connection.query(
    `insert into public.outreach_contacts (
       id, display_name, phone_e164, created_by_admin_id, assigned_admin_id, next_meeting_at
     ) values ($1::uuid, 'Иван Проверкин', $3::text, $2::uuid, $2::uuid,
               now() + interval '2 days')`,
    [ids.contactId, AUTOMATION_ADMIN, ids.phone]
  );
  await connection.query(
    `insert into public.event_participants (
       id, event_id, outreach_contact_id, display_name, phone_e164,
       source, ticket_title, adults, children, sleeping_places,
       note, amount_kopecks, created_by_admin_id
     ) values
       ($1::uuid, $3::uuid, $5::uuid, 'Иван Проверкин', $7::text,
        'site', '', 1, 0, 0, '', 0, $6::uuid),
       ($2::uuid, $4::uuid, $5::uuid, 'Иван Проверкин', $7::text,
        'site', '', 1, 0, 0, '', 0, $6::uuid)`,
    [
      randomUUID(),
      randomUUID(),
      ids.upcomingEventId,
      ids.pastEventId,
      ids.contactId,
      AUTOMATION_ADMIN,
      ids.phone
    ]
  );
  await connection.query(
    `insert into public.outreach_campaign_contacts (
       id, campaign_id, contact_id, pipeline_stage, current_status
     )
     select $1::uuid, campaign.id, $2::uuid, 'new', 'new'
       from public.outreach_campaigns campaign
      where campaign.event_slug_prefix = 'sreda'`,
    [ids.memberId, ids.contactId]
  );
  // Недозвон в истории: без него правило «перезвонить» нечем проверить.
  await connection.query(
    `insert into public.outreach_activities (
       id, campaign_contact_id, contact_id, actor_admin_id,
       action, channel, result, occurred_at
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
               'call', 'phone', 'no_answer', now() - interval '1 hour')`,
    [randomUUID(), ids.memberId, ids.contactId, AUTOMATION_ADMIN]
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
