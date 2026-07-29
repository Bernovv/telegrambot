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
  OUTREACH_CONTACT_STATUSES
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

const createCampaignBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: campaignStatus.optional()
}).strict();

const updateCampaignBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: campaignStatus.optional()
}).strict().refine((value) => Object.keys(value).length > 0);

const contactListQuery = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  status: contactStatus.optional(),
  assignedAdminId: uuid.optional(),
  mine: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const importRow = z.object({
  name: z.string().max(200).optional(),
  phone: z.string().max(100).optional(),
  telegram: z.string().max(100).optional(),
  max: z.string().max(100).optional(),
  source: z.string().max(200).optional(),
  note: z.string().max(2000).optional()
}).strict();

const importBody = z.object({
  assignedAdminId: uuid.optional(),
  rows: z.array(importRow).min(1).max(500)
}).strict();

const assignmentBody = z.object({
  campaignContactIds: z.array(uuid).min(1).max(100),
  assignedAdminId: uuid
}).strict();

const activityBody = z.object({
  campaignContactIds: z.array(uuid).min(1).max(100),
  channel,
  result: activityResult,
  note: z.string().trim().max(2000).optional(),
  nextContactAt: z.iso.datetime({ offset: true }).optional()
}).strict();

export type AdminOutreachHandler = Pick<
  AdminOutreachService,
  | "listCampaigns"
  | "getCampaign"
  | "createCampaign"
  | "updateCampaign"
  | "listContacts"
  | "getContact"
  | "importContacts"
  | "assignContacts"
  | "recordActivities"
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
  listCampaigns(@Req() request: AuthenticatedAdminRequest) {
    return this.handler.listCampaigns({ actor: requireActor(request) });
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
        ...(parsed.note === undefined ? {} : { note: parsed.note }),
        ...(parsed.nextContactAt === undefined
          ? {}
          : { nextContactAt: new Date(parsed.nextContactAt) }),
        now: new Date()
      })
    );
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
        campaignId,
        ...(parsed.assignedAdminId === undefined
          ? {}
          : { assignedAdminId: parsed.assignedAdminId }),
        rows: parsed.rows.map((row) => ({
          ...(row.name === undefined ? {} : { name: row.name }),
          ...(row.phone === undefined ? {} : { phone: row.phone }),
          ...(row.telegram === undefined ? {} : { telegram: row.telegram }),
          ...(row.max === undefined ? {} : { max: row.max }),
          ...(row.source === undefined ? {} : { source: row.source }),
          ...(row.note === undefined ? {} : { note: row.note })
        })),
        now: new Date()
      })
    );
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
