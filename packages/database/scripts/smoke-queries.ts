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
import { createAdminOutreachPersistence } from "../src/admin-outreach-persistence.js";
import { createAutoTaskPersistence } from "../src/auto-task-persistence.js";
import { createEventCampaignSyncPersistence } from "../src/event-campaign-sync-persistence.js";
import { createNodePostgresPool } from "../src/node-postgres.js";
import { createAdminStaffPersistence } from "../src/admin-staff-persistence.js";
import { createSiteRegistrationPersistence } from "../src/site-registration-persistence.js";
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
    historyId: randomUUID(), stage: "invited", lostReason: null, now
  }));
  // Перенос в проигрышную колонку: причина обязательна, и её проверяет триггер.
  await check("updateContactStage (проигрыш)", () => outreach.updateContactStage({
    campaignContactId: memberId, actorAdminId: AUTOMATION_ADMIN,
    historyId: randomUUID(), stage: "lost", lostReason: "declined", now
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
    () => site.repository.findRegistrationEvent({ slugPrefix: "sreda", now }));
  await check("findParticipantByPhone", () => site.repository.findParticipantByPhone({
    eventId: upcomingEventId, phoneE164: phone
  }));
  await check("createParticipant с карточкой и звонком", () => site.unitOfWork.transact(
    () => site.repository.createParticipant({
      registrationId: randomUUID(),
      participantId: randomUUID(),
      contactSeedId: randomUUID(),
      eventId: upcomingEventId,
      name: "Пётр Заявкин",
      phoneE164: smokePhone(),
      consentAt: now,
      page: "sreda",
      createdByAdminId: SITE_ADMIN,
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
