import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { AdminOutreachService } from "@ticket-platform/application";
import {
  OUTREACH_CAMPAIGN_STATUSES,
  OUTREACH_CHANNELS,
  OUTREACH_CONTACT_STATUSES,
  OUTREACH_CUSTOM_FIELD_TYPES,
  OUTREACH_LOST_REASONS,
  OUTREACH_MAX_PIPELINE_COLUMNS,
  OUTREACH_PERSON_FILTERS,
  OUTREACH_PIPELINE_COLUMN_OUTCOMES,
  OUTREACH_TASK_TYPES
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_OUTREACH = Symbol("ADMIN_OUTREACH");
const uuid = z.string().uuid();
const campaignStatus = z.enum(OUTREACH_CAMPAIGN_STATUSES);
const contactStatus = z.enum(OUTREACH_CONTACT_STATUSES);
const activityResult = z.enum(
  OUTREACH_CONTACT_STATUSES.filter((status) => status !== "new")
);
const channel = z.enum(OUTREACH_CHANNELS);
// Stages are manager-defined ids (see newStageId in the application layer),
// not a fixed literal list, so only the storage format is validated here.
const pipelineStage = z.string().regex(/^[a-z0-9_]{1,40}$/);
const pipelineColumnOutcome = z.enum(OUTREACH_PIPELINE_COLUMN_OUTCOMES);
const customFieldType = z.enum(OUTREACH_CUSTOM_FIELD_TYPES);
const lostReason = z.enum(OUTREACH_LOST_REASONS);
const taskType = z.enum(OUTREACH_TASK_TYPES);

const createCampaignBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: campaignStatus.optional(),
  eventId: uuid.optional()
}).strict();

const updateCampaignBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: campaignStatus.optional(),
  eventId: uuid.nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0);

const contactListQuery = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  status: contactStatus.optional(),
  stage: pipelineStage.optional(),
  assignedAdminId: uuid.optional(),
  mine: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
}).strict();

const importRow = z.object({
  name: z.string().max(200).optional(),
  phone: z.string().max(100).optional(),
  telegram: z.string().max(100).optional(),
  max: z.string().max(100).optional(),
  // Почта — такой же признак человека, как телефон и ник: в выгрузке Timepad она
  // единственная, что есть у всех. Схема строгая, поэтому без этого поля файл с
  // колонкой «Email» получал 400 на всю пачку, а не «загружено без почты».
  email: z.string().max(320).optional(),
  source: z.string().max(200).optional(),
  note: z.string().max(2000).optional()
}).strict();

const importBody = z.object({
  assignedAdminId: uuid.optional(),
  rows: z.array(importRow).min(1).max(500),
  importId: uuid.optional(),
  lines: z.array(z.number().int().min(1).max(1_000_000)).max(500).optional()
}).strict();

// Ответственного здесь нет намеренно: назначать некого, кампании у загрузки нет.
const importPeopleBody = z.object({
  rows: z.array(importRow).min(1).max(500),
  // Загрузка, к которой относится пачка, и номера строк файла — ради журнала.
  importId: uuid.optional(),
  lines: z.array(z.number().int().min(1).max(1_000_000)).max(500).optional()
}).strict();

const startImportBody = z.object({
  filename: z.string().trim().max(260).optional(),
  campaignId: uuid.optional()
}).strict();

const importsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const pendingRowsQuery = z.object({
  importId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
}).strict();

const retryImportRowBody = z.object({
  row: importRow
}).strict();

const peopleQuery = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  filter: z.enum(OUTREACH_PERSON_FILTERS).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
}).strict();

// null означает «стереть значение», отсутствие ключа — «не трогать».
const editableIdentifier = z.string().trim().max(320).nullable();

const updatePersonBody = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  phone: editableIdentifier.optional(),
  telegram: editableIdentifier.optional(),
  max: editableIdentifier.optional(),
  email: editableIdentifier.optional(),
  source: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0);

const archivePersonBody = z.object({
  reason: z.string().trim().max(500).optional()
}).strict();

const deletePersonBody = z.object({
  reason: z.string().trim().max(500).optional()
}).strict();

const mergePersonBody = z.object({
  /** Главный контакт, к которому сводят открытый. */
  targetContactId: uuid,
  reason: z.string().trim().max(500).optional()
}).strict();

const baseContactsQuery = z.object({
  campaignId: uuid,
  search: z.string().trim().min(2).max(100).optional(),
  onlyMissing: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
}).strict();

const addExistingBody = z.object({
  contactIds: z.array(uuid).min(1).max(500),
  assignedAdminId: uuid.optional()
}).strict();

const removeContactsBody = z.object({
  campaignContactIds: z.array(uuid).min(1).max(500)
}).strict();

const moveContactsBody = z.object({
  campaignContactIds: z.array(uuid).min(1).max(500),
  targetCampaignId: uuid
}).strict();

const campaignListQuery = z.object({
  includeArchived: z.enum(["true", "false"]).optional()
}).strict();

const assignmentBody = z.object({
  campaignContactIds: z.array(uuid).min(1).max(100),
  assignedAdminId: uuid
}).strict();

const activityBody = z.object({
  campaignContactIds: z.array(uuid).min(1).max(100),
  channel,
  result: activityResult,
  stage: pipelineStage.optional(),
  lostReason: lostReason.optional(),
  note: z.string().trim().max(2000).optional(),
  nextContactAt: z.iso.datetime({ offset: true }).optional()
}).strict();

const stageBody = z.object({
  stage: pipelineStage,
  lostReason: lostReason.optional()
}).strict();

const taskBody = z.object({
  assignedAdminId: uuid.optional(),
  type: taskType,
  text: z.string().trim().min(1).max(500),
  dueAt: z.iso.datetime({ offset: true })
}).strict();

const siteRegistrationsQuery = z.object({
  needsAttention: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
}).strict();

const noteBody = z.object({
  body: z.string().trim().min(1).max(4000)
}).strict();

const manualContactBody = z.object({
  assignedAdminId: uuid.optional(),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(100).optional(),
  telegram: z.string().trim().max(100).optional(),
  max: z.string().trim().max(100).optional(),
  email: z.string().trim().max(320).optional(),
  source: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional()
}).strict().refine(
  (value) => Boolean(value.phone || value.telegram || value.max || value.email),
  { message: "At least one contact identifier is required" }
);

const pipelineBody = z.object({
  // Omitting stage adds a new column; the order of this array becomes the
  // new column positions, so add/remove/rename/reorder are all one call.
  columns: z.array(z.object({
    stage: pipelineStage.optional(),
    label: z.string().trim().min(1).max(60),
    outcome: pipelineColumnOutcome
  }).strict()).min(1).max(OUTREACH_MAX_PIPELINE_COLUMNS)
}).strict();

const createCustomFieldBody = z.object({
  campaignId: uuid.optional(),
  label: z.string().trim().min(1).max(80),
  type: customFieldType,
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional()
}).strict();

const customFieldValueBody = z.object({
  value: z.string().trim().max(500).nullable()
}).strict();

const taskBoardQuery = z.object({
  mine: z.enum(["true", "false"]).optional()
}).strict();

export type AdminOutreachHandler = Pick<
  AdminOutreachService,
  | "listCampaigns"
  | "getCampaign"
  | "createCampaign"
  | "archiveCampaign"
  | "restoreCampaign"
  | "importEventParticipants"
  | "moveContacts"
  | "listBaseContacts"
  | "addExistingContacts"
  | "removeContacts"
  | "updateCampaign"
  | "listPipelineColumns"
  | "updatePipelineColumns"
  | "listCustomFieldDefinitions"
  | "createCustomFieldDefinition"
  | "deleteCustomFieldDefinition"
  | "setCustomFieldValue"
  | "listTaskBoard"
  | "listContacts"
  | "getContact"
  | "listPeople"
  | "getPerson"
  | "updatePerson"
  | "archivePerson"
  | "restorePerson"
  | "deletePerson"
  | "mergePeople"
  | "importPeople"
  | "startImport"
  | "listImports"
  | "listPendingImportRows"
  | "retryImportRow"
  | "dismissImportRow"
  | "importContacts"
  | "createContact"
  | "assignContacts"
  | "recordActivities"
  | "updateContactStage"
  | "createTask"
  | "completeTask"
  | "createNote"
  | "deleteNote"
  | "listSiteRegistrations"
  | "listManagers"
  | "exportCampaign"
>;

@Controller("api/v1/outreach")
export class AdminOutreachController {
  constructor(
    @Inject(ADMIN_OUTREACH)
    private readonly handler: AdminOutreachHandler
  ) {}

  @Get("campaigns")
  @RequireAdminPermission("outreach.read")
  listCampaigns(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(campaignListQuery, query);
    return this.handler.listCampaigns({
      actor: requireActor(request),
      includeArchived: parsed.includeArchived === "true"
    });
  }

  @Post("campaigns/:id/archive")
  @RequireAdminPermission("outreach.write")
  async archiveCampaign(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    await executeOutreach(() =>
      this.handler.archiveCampaign({
        actor: requireActor(request),
        campaignId: parse(uuid, id),
        now: new Date()
      })
    );
    return { archived: true };
  }

  @Post("campaigns/:id/restore")
  @RequireAdminPermission("outreach.write")
  async restoreCampaign(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    await executeOutreach(() =>
      this.handler.restoreCampaign({
        actor: requireActor(request),
        campaignId: parse(uuid, id)
      })
    );
    return { restored: true };
  }

  @Post("campaigns/:id/import-participants")
  @RequireAdminPermission("outreach.write")
  async importParticipants(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    return executeOutreach(() =>
      this.handler.importEventParticipants({
        actor: requireActor(request),
        campaignId: parse(uuid, id),
        now: new Date()
      })
    );
  }

  @Get("contacts")
  @RequireAdminPermission("outreach.read")
  listBaseContacts(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(baseContactsQuery, query);
    return executeOutreach(() =>
      this.handler.listBaseContacts({
        actor: requireActor(request),
        campaignId: parsed.campaignId,
        ...(parsed.search === undefined ? {} : { search: parsed.search }),
        ...(parsed.onlyMissing === undefined
          ? {}
          : { onlyMissing: parsed.onlyMissing === "true" }),
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit })
      })
    );
  }

  // Общая база: люди без привязки к кампании. Соседний GET contacts отвечает на другой
  // вопрос — «кого из базы можно доложить вот в эту кампанию» — и потому требует её id.
  @Get("base")
  @RequireAdminPermission("outreach.read")
  listPeople(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(peopleQuery, query);
    return executeOutreach(() =>
      this.handler.listPeople({
        actor: requireActor(request),
        ...(parsed.search === undefined ? {} : { search: parsed.search }),
        ...(parsed.filter === undefined ? {} : { filter: parsed.filter }),
        ...(parsed.page === undefined ? {} : { page: parsed.page }),
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit })
      })
    );
  }

  // Загрузка прямо в базу. Соседний campaigns/:id/import кладёт тех же людей ещё и в
  // кампанию; здесь кампании нет, и заводить её ради файла не требуется.
  @Post("imports")
  @RequireAdminPermission("outreach.write")
  startImport(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(startImportBody, body ?? {});
    return executeOutreach(() =>
      this.handler.startImport({
        actor: requireActor(request),
        ...(parsed.filename === undefined ? {} : { filename: parsed.filename }),
        ...(parsed.campaignId === undefined
          ? {}
          : { campaignId: parsed.campaignId }),
        now: new Date()
      })
    );
  }

  @Get("imports")
  @RequireAdminPermission("outreach.read")
  listImports(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(importsQuery, query);
    return executeOutreach(() =>
      this.handler.listImports({
        actor: requireActor(request),
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit })
      })
    );
  }

  @Get("import-rows")
  @RequireAdminPermission("outreach.read")
  listPendingImportRows(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(pendingRowsQuery, query);
    return executeOutreach(() =>
      this.handler.listPendingImportRows({
        actor: requireActor(request),
        ...(parsed.importId === undefined ? {} : { importId: parsed.importId }),
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit })
      })
    );
  }

  @Post("import-rows/:id/retry")
  @RequireAdminPermission("outreach.write")
  async retryImportRow(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const rowId = parse(uuid, id);
    const parsed = parse(retryImportRowBody, body);
    const result = await executeOutreach(() =>
      this.handler.retryImportRow({
        actor: requireActor(request),
        rowId,
        row: {
          ...(parsed.row.name === undefined ? {} : { name: parsed.row.name }),
          ...(parsed.row.phone === undefined ? {} : { phone: parsed.row.phone }),
          ...(parsed.row.telegram === undefined
            ? {}
            : { telegram: parsed.row.telegram }),
          ...(parsed.row.max === undefined ? {} : { max: parsed.row.max }),
          ...(parsed.row.email === undefined ? {} : { email: parsed.row.email }),
          ...(parsed.row.source === undefined
            ? {}
            : { source: parsed.row.source }),
          ...(parsed.row.note === undefined ? {} : { note: parsed.row.note })
        },
        now: new Date()
      })
    );
    // Строка легла или нет — обычный ответ: панель показывает причину и даёт править дальше.
    // 404 только когда строки нет вовсе или её уже разобрали.
    if (!result.resolved && result.reason === null) {
      throw outreachNotFound();
    }
    return result;
  }

  @Post("import-rows/:id/dismiss")
  @RequireAdminPermission("outreach.write")
  async dismissImportRow(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const rowId = parse(uuid, id);
    const dismissed = await executeOutreach(() =>
      this.handler.dismissImportRow({
        actor: requireActor(request),
        rowId,
        now: new Date()
      })
    );
    if (!dismissed) {
      throw outreachNotFound();
    }
    return { dismissed };
  }

  @Post("base/import")
  @RequireAdminPermission("outreach.write")
  importPeople(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(importPeopleBody, body);
    return executeOutreach(() =>
      this.handler.importPeople({
        actor: requireActor(request),
        ...(parsed.importId === undefined ? {} : { importId: parsed.importId }),
        ...(parsed.lines === undefined ? {} : { lines: parsed.lines }),
        rows: parsed.rows.map((row) => ({
          ...(row.name === undefined ? {} : { name: row.name }),
          ...(row.phone === undefined ? {} : { phone: row.phone }),
          ...(row.telegram === undefined ? {} : { telegram: row.telegram }),
          ...(row.max === undefined ? {} : { max: row.max }),
          ...(row.email === undefined ? {} : { email: row.email }),
          ...(row.source === undefined ? {} : { source: row.source }),
          ...(row.note === undefined ? {} : { note: row.note })
        })),
        now: new Date()
      })
    );
  }

  /**
   * Карточка человека целиком, включая заказы, кошелёк и согласия с офертой.
   *
   * Эти же данные в разделах «Пользователи» и «Заказы» закрыты правами `users.read` и
   * `orders.read`. Здесь их отдаёт `outreach.read`, и сегодня это никого не расширяет:
   * `outreach.read` есть только у sales_manager и super_admin, а у обоих есть и те два.
   * Если право когда-нибудь выдадут роли без доступа к деньгам, денежную часть карточки
   * придётся отрезать здесь же — совпадение прав перестанет быть совпадением.
   */
  @Get("base/:id")
  @RequireAdminPermission("outreach.read")
  async getPerson(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const person = await executeOutreach(() =>
      this.handler.getPerson({ actor: requireActor(request), contactId })
    );
    if (!person) {
      throw outreachNotFound();
    }
    return person;
  }

  @Patch("base/:id")
  @RequireAdminPermission("outreach.write")
  async updatePerson(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const parsed = parse(updatePersonBody, body);
    const result = await executeOutreach(() =>
      this.handler.updatePerson({
        actor: requireActor(request),
        contactId,
        changes: parsed,
        now: new Date()
      })
    );
    if (result.status === "not_found") {
      throw outreachNotFound();
    }
    // Занятый признак отдаём обычным ответом, а не ошибкой: это не поломка, а развилка —
    // опечатка или дубль, который пора объединить. Панели нужно имя второго человека, чтобы
    // спросить об этом внятно, а через ошибку структура не проходит.
    return result;
  }

  @Post("base/:id/archive")
  @RequireAdminPermission("outreach.write")
  async archivePerson(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const parsed = parse(archivePersonBody, body ?? {});
    const archived = await executeOutreach(() =>
      this.handler.archivePerson({
        actor: requireActor(request),
        contactId,
        ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
        now: new Date()
      })
    );
    if (!archived) {
      throw outreachNotFound();
    }
    return { archived };
  }

  @Post("base/:id/restore")
  @RequireAdminPermission("outreach.write")
  async restorePerson(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const restored = await executeOutreach(() =>
      this.handler.restorePerson({
        actor: requireActor(request),
        contactId,
        now: new Date()
      })
    );
    if (!restored) {
      throw outreachNotFound();
    }
    return { restored };
  }

  @Post("base/:id/merge")
  @RequireAdminPermission("outreach.write")
  async mergePeople(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const parsed = parse(mergePersonBody, body);
    const result = await executeOutreach(() =>
      this.handler.mergePeople({
        actor: requireActor(request),
        contactId,
        targetContactId: parsed.targetContactId,
        ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
        now: new Date()
      })
    );
    // Отказ с причиной — обычный ответ: панель объясняет, почему свести нельзя. Без причины
    // это «не нашли», и вот тогда 404.
    if (!result.merged && result.blocker === undefined) {
      throw outreachNotFound();
    }
    return result;
  }

  @Post("base/:id/delete")
  @RequireAdminPermission("outreach.delete")
  async deletePerson(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const parsed = parse(deletePersonBody, body ?? {});
    const result = await executeOutreach(() =>
      this.handler.deletePerson({
        actor: requireActor(request),
        contactId,
        ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
        now: new Date()
      })
    );
    // Отказ по причине — не ошибка запроса: панель показывает причины и предлагает архив.
    if (!result.deleted && result.blockers.length === 0) {
      throw outreachNotFound();
    }
    return result;
  }

  @Post("campaigns/:id/contacts/add")
  @RequireAdminPermission("outreach.write")
  async addExistingContacts(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(addExistingBody, body);
    return executeOutreach(() =>
      this.handler.addExistingContacts({
        actor: requireActor(request),
        campaignId: parse(uuid, id),
        contactIds: parsed.contactIds,
        ...(parsed.assignedAdminId === undefined
          ? {}
          : { assignedAdminId: parsed.assignedAdminId }),
        now: new Date()
      })
    );
  }

  @Post("campaigns/:id/contacts/remove")
  @RequireAdminPermission("outreach.write")
  async removeContacts(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(removeContactsBody, body);
    return executeOutreach(() =>
      this.handler.removeContacts({
        actor: requireActor(request),
        campaignId: parse(uuid, id),
        campaignContactIds: parsed.campaignContactIds,
        now: new Date()
      })
    );
  }

  @Post("campaign-contacts/move")
  @RequireAdminPermission("outreach.write")
  async moveContacts(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(moveContactsBody, body);
    return executeOutreach(() =>
      this.handler.moveContacts({
        actor: requireActor(request),
        campaignContactIds: parsed.campaignContactIds,
        targetCampaignId: parsed.targetCampaignId,
        now: new Date()
      })
    );
  }

  @Post("campaigns")
  @RequireAdminPermission("outreach.write")
  async createCampaign(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(createCampaignBody, body);
    return executeOutreach(() =>
      this.handler.createCampaign({
        actor: requireActor(request),
        name: parsed.name,
        ...(parsed.description === undefined
          ? {}
          : { description: parsed.description }),
        ...(parsed.status === undefined ? {} : { status: parsed.status }),
        ...(parsed.eventId === undefined ? {} : { eventId: parsed.eventId }),
        now: new Date()
      })
    );
  }

  @Get("managers")
  @RequireAdminPermission("outreach.read")
  listManagers(@Req() request: AuthenticatedAdminRequest) {
    return this.handler.listManagers({ actor: requireActor(request) });
  }

  @Get("campaign-contacts/:id")
  @RequireAdminPermission("outreach.read")
  async getContact(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignContactId = parse(uuid, id);
    const result = await this.handler.getContact({
      actor: requireActor(request),
      campaignContactId
    });
    if (!result) {
      throw outreachNotFound();
    }
    return result;
  }

  @Post("campaign-contacts/activities")
  @RequireAdminPermission("outreach.write")
  async recordActivities(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(activityBody, body);
    return executeOutreach(() =>
      this.handler.recordActivities({
        actor: requireActor(request),
        campaignContactIds: parsed.campaignContactIds,
        channel: parsed.channel,
        result: parsed.result,
        ...(parsed.stage === undefined ? {} : { stage: parsed.stage }),
        ...(parsed.lostReason === undefined
          ? {}
          : { lostReason: parsed.lostReason }),
        ...(parsed.note === undefined ? {} : { note: parsed.note }),
        ...(parsed.nextContactAt === undefined
          ? {}
          : { nextContactAt: new Date(parsed.nextContactAt) }),
        now: new Date()
      })
    );
  }

  @Patch("campaign-contacts/:id/stage")
  @RequireAdminPermission("outreach.write")
  async updateContactStage(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignContactId = parse(uuid, id);
    const parsed = parse(stageBody, body);
    const result = await executeOutreach(() =>
      this.handler.updateContactStage({
        actor: requireActor(request),
        campaignContactId,
        stage: parsed.stage,
        ...(parsed.lostReason === undefined
          ? {}
          : { lostReason: parsed.lostReason }),
        now: new Date()
      })
    );
    if (!result.updated) {
      throw outreachNotFound();
    }
    return result;
  }

  @Post("campaign-contacts/:id/tasks")
  @RequireAdminPermission("outreach.write")
  async createTask(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignContactId = parse(uuid, id);
    const parsed = parse(taskBody, body);
    const result = await executeOutreach(() =>
      this.handler.createTask({
        actor: requireActor(request),
        campaignContactId,
        ...(parsed.assignedAdminId === undefined
          ? {}
          : { assignedAdminId: parsed.assignedAdminId }),
        type: parsed.type,
        text: parsed.text,
        dueAt: new Date(parsed.dueAt),
        now: new Date()
      })
    );
    if (!result.created) {
      throw outreachNotFound();
    }
    return result;
  }

  /**
   * Задача по человеку, а не по кампании. Соседний маршрут по строке участия остаётся —
   * там кампания известна и определяет и ответственного, и место задачи в воронке.
   */
  @Post("base/:id/tasks")
  @RequireAdminPermission("outreach.write")
  async createPersonTask(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const parsed = parse(taskBody, body);
    const result = await executeOutreach(() =>
      this.handler.createTask({
        actor: requireActor(request),
        contactId,
        ...(parsed.assignedAdminId === undefined
          ? {}
          : { assignedAdminId: parsed.assignedAdminId }),
        type: parsed.type,
        text: parsed.text,
        dueAt: new Date(parsed.dueAt),
        now: new Date()
      })
    );
    if (!result.created) {
      throw outreachNotFound();
    }
    return result;
  }

  @Get("site-registrations")
  @RequireAdminPermission("outreach.read")
  listSiteRegistrations(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(siteRegistrationsQuery, query);
    return executeOutreach(() =>
      this.handler.listSiteRegistrations({
        actor: requireActor(request),
        ...(parsed.needsAttention === undefined
          ? {}
          : { onlyNeedsAttention: parsed.needsAttention === "true" }),
        ...(parsed.page === undefined ? {} : { page: parsed.page }),
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit })
      })
    );
  }

  @Post("base/:id/notes")
  @RequireAdminPermission("outreach.write")
  async createNote(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const parsed = parse(noteBody, body);
    const result = await executeOutreach(() =>
      this.handler.createNote({
        actor: requireActor(request),
        contactId,
        body: parsed.body,
        now: new Date()
      })
    );
    if (!result.created) {
      throw outreachNotFound();
    }
    return result;
  }

  /**
   * Снять можно только свою заметку. Чужая отвечает «не найдено» намеренно: сообщать, что
   * заметка есть, но не ваша, значит рассказывать о чужой записи тому, кто её не видел бы.
   */
  @Post("notes/:id/delete")
  @RequireAdminPermission("outreach.write")
  async deleteNote(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const noteId = parse(uuid, id);
    const result = await executeOutreach(() =>
      this.handler.deleteNote({
        actor: requireActor(request),
        noteId,
        now: new Date()
      })
    );
    if (!result.deleted) {
      throw outreachNotFound();
    }
    return result;
  }

  @Patch("tasks/:id/complete")
  @RequireAdminPermission("outreach.write")
  async completeTask(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const taskId = parse(uuid, id);
    const result = await executeOutreach(() =>
      this.handler.completeTask({
        actor: requireActor(request),
        taskId,
        now: new Date()
      })
    );
    if (!result.completed) {
      throw outreachNotFound();
    }
    return result;
  }

  @Post("campaign-contacts/assign")
  @RequireAdminPermission("outreach.write")
  async assignContacts(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(assignmentBody, body);
    return executeOutreach(() =>
      this.handler.assignContacts({
        actor: requireActor(request),
        ...parsed,
        now: new Date()
      })
    );
  }

  @Get("campaigns/:id")
  @RequireAdminPermission("outreach.read")
  async getCampaign(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    const result = await this.handler.getCampaign({
      actor: requireActor(request),
      campaignId
    });
    if (!result) {
      throw outreachNotFound();
    }
    return result;
  }

  @Get("campaigns/:id/pipeline")
  @RequireAdminPermission("outreach.read")
  listPipelineColumns(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    return this.handler.listPipelineColumns({
      actor: requireActor(request),
      campaignId
    });
  }

  @Patch("campaigns/:id/pipeline")
  @RequireAdminPermission("outreach.write")
  async updatePipelineColumns(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    const parsed = parse(pipelineBody, body);
    const result = await executeOutreach(() =>
      this.handler.updatePipelineColumns({
        actor: requireActor(request),
        campaignId,
        columns: parsed.columns.map((column) => ({
          ...(column.stage === undefined ? {} : { stage: column.stage }),
          label: column.label,
          outcome: column.outcome
        })),
        now: new Date()
      })
    );
    if (!result.updated) {
      throw outreachNotFound();
    }
    return result;
  }

  @Patch("campaigns/:id")
  @RequireAdminPermission("outreach.write")
  async updateCampaign(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    const parsed = parse(updateCampaignBody, body);
    const result = await executeOutreach(() =>
      this.handler.updateCampaign({
        actor: requireActor(request),
        campaignId,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.description === undefined
          ? {}
          : { description: parsed.description }),
        ...(parsed.status === undefined ? {} : { status: parsed.status }),
        ...(parsed.eventId === undefined ? {} : { eventId: parsed.eventId }),
        now: new Date()
      })
    );
    if (!result) {
      throw outreachNotFound();
    }
    return result;
  }

  @Get("campaigns/:id/contacts")
  @RequireAdminPermission("outreach.read")
  listContacts(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    const parsed = parse(contactListQuery, query);
    return this.handler.listContacts({
      actor: requireActor(request),
      campaignId,
      ...(parsed.search === undefined ? {} : { search: parsed.search }),
      ...(parsed.status === undefined ? {} : { status: parsed.status }),
      ...(parsed.stage === undefined ? {} : { stage: parsed.stage }),
      ...(parsed.assignedAdminId === undefined
        ? {}
        : { assignedAdminId: parsed.assignedAdminId }),
      ...(parsed.page === undefined ? {} : { page: parsed.page }),
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
      ...(parsed.mine === undefined
        ? {}
        : { mine: parsed.mine === "true" })
    });
  }

  @Post("campaigns/:id/contacts")
  @RequireAdminPermission("outreach.write")
  createContact(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    const parsed = parse(manualContactBody, body);
    return executeOutreach(() =>
      this.handler.createContact({
        actor: requireActor(request),
        campaignId,
        ...(parsed.assignedAdminId
          ? { assignedAdminId: parsed.assignedAdminId }
          : {}),
        contact: {
          ...(parsed.name ? { name: parsed.name } : {}),
          ...(parsed.phone ? { phone: parsed.phone } : {}),
          ...(parsed.telegram ? { telegram: parsed.telegram } : {}),
          ...(parsed.max ? { max: parsed.max } : {}),
          ...(parsed.email ? { email: parsed.email } : {}),
          ...(parsed.source ? { source: parsed.source } : {}),
          ...(parsed.note ? { note: parsed.note } : {})
        },
        now: new Date()
      })
    );
  }

  @Post("campaigns/:id/import")
  @RequireAdminPermission("outreach.write")
  async importContacts(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    const parsed = parse(importBody, body);
    return executeOutreach(() =>
      this.handler.importContacts({
        actor: requireActor(request),
        skipInvalid: true,
        campaignId,
        ...(parsed.importId === undefined ? {} : { importId: parsed.importId }),
        ...(parsed.lines === undefined ? {} : { lines: parsed.lines }),
        ...(parsed.assignedAdminId === undefined
          ? {}
          : { assignedAdminId: parsed.assignedAdminId }),
        rows: parsed.rows.map((row) => ({
          ...(row.name === undefined ? {} : { name: row.name }),
          ...(row.phone === undefined ? {} : { phone: row.phone }),
          ...(row.telegram === undefined ? {} : { telegram: row.telegram }),
          ...(row.max === undefined ? {} : { max: row.max }),
          ...(row.email === undefined ? {} : { email: row.email }),
          ...(row.source === undefined ? {} : { source: row.source }),
          ...(row.note === undefined ? {} : { note: row.note })
        })),
        now: new Date()
      })
    );
  }

  @Get("campaigns/:id/custom-fields")
  @RequireAdminPermission("outreach.read")
  listCustomFieldDefinitions(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    return this.handler.listCustomFieldDefinitions({
      actor: requireActor(request),
      campaignId
    });
  }

  @Post("custom-fields")
  @RequireAdminPermission("outreach.write")
  createCustomFieldDefinition(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(createCustomFieldBody, body);
    return executeOutreach(() =>
      this.handler.createCustomFieldDefinition({
        actor: requireActor(request),
        ...(parsed.campaignId === undefined
          ? {}
          : { campaignId: parsed.campaignId }),
        label: parsed.label,
        type: parsed.type,
        ...(parsed.options === undefined ? {} : { options: parsed.options }),
        now: new Date()
      })
    );
  }

  @Post("custom-fields/:id/delete")
  @RequireAdminPermission("outreach.write")
  async deleteCustomFieldDefinition(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const fieldId = parse(uuid, id);
    const result = await executeOutreach(() =>
      this.handler.deleteCustomFieldDefinition({
        actor: requireActor(request),
        fieldId
      })
    );
    if (!result.deleted) {
      throw outreachNotFound();
    }
    return result;
  }

  @Patch("campaign-contacts/:id/custom-fields/:fieldId")
  @RequireAdminPermission("outreach.write")
  async setCustomFieldValue(
    @Param("id") id: string,
    @Param("fieldId") fieldId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignContactId = parse(uuid, id);
    const parsedFieldId = parse(uuid, fieldId);
    const parsed = parse(customFieldValueBody, body);
    const result = await executeOutreach(() =>
      this.handler.setCustomFieldValue({
        actor: requireActor(request),
        campaignContactId,
        fieldId: parsedFieldId,
        value: parsed.value,
        now: new Date()
      })
    );
    if (!result.updated) {
      throw outreachNotFound();
    }
    return result;
  }

  @Get("tasks/board")
  @RequireAdminPermission("outreach.read")
  listTaskBoard(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(taskBoardQuery, query);
    return this.handler.listTaskBoard({
      actor: requireActor(request),
      ...(parsed.mine === undefined ? {} : { onlyMine: parsed.mine === "true" }),
      now: new Date()
    });
  }

  @Get("campaigns/:id/export")
  @RequireAdminPermission("outreach.read")
  async exportCampaign(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const campaignId = parse(uuid, id);
    const result = await this.handler.exportCampaign({
      actor: requireActor(request),
      campaignId
    });
    if (!result) {
      throw outreachNotFound();
    }
    return result;
  }
}

@Module({})
export class AdminOutreachApiModule {
  static register(handler: AdminOutreachHandler): DynamicModule {
    return {
      module: AdminOutreachApiModule,
      controllers: [AdminOutreachController],
      providers: [{ provide: ADMIN_OUTREACH, useValue: handler }]
    };
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "INVALID_OUTREACH_REQUEST",
      title: "Данные работы с базой заполнены неверно"
    });
  }
  return result.data;
}

function requireActor(
  request: AuthenticatedAdminRequest
): NonNullable<AuthenticatedAdminRequest["adminActor"]> {
  if (!request.adminActor) {
    throw new UnauthorizedException();
  }
  return request.adminActor;
}

function outreachNotFound(): NotFoundException {
  return new NotFoundException({
    code: "OUTREACH_NOT_FOUND",
    title: "Кампания или контакт не найдены"
  });
}

async function executeOutreach<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.startsWith("Administrator outreach ")
        || error.message.startsWith("Outreach ")
      )
    ) {
      throw new BadRequestException({
        code: "INVALID_OUTREACH_REQUEST",
        title: "Данные работы с базой заполнены неверно"
      });
    }
    throw error;
  }
}
