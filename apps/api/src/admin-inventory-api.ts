import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { AdminEventInventoryService } from "@ticket-platform/application";
import {
  INVENTORY_CONDITIONS,
  INVENTORY_MOVEMENT_KINDS,
  INVENTORY_NEED_STATUSES,
  INVENTORY_SOURCES
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_INVENTORY = Symbol("ADMIN_INVENTORY");

const uuid = z.string().uuid();
// Количества строками: дробные единицы есть, а плавающая точка их не складывает точно.
const quantity = z.string().regex(/^\d{1,6}(?:\.\d{1,3})?$/);
const signedQuantity = z.string().regex(/^-?\d{1,6}(?:\.\d{1,3})?$/);

const itemBody = z.object({
  title: z.string().trim().min(1).max(200),
  categoryCode: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  unit: z.string().trim().min(1).max(40).optional(),
  quantityOwned: quantity.optional(),
  storageLocation: z.string().trim().max(200).optional(),
  condition: z.enum(INVENTORY_CONDITIONS).optional(),
  note: z.string().trim().max(1000).optional()
}).strict();

const componentBody = z.object({
  parentItemId: uuid,
  childItemId: uuid,
  quantityPerParent: quantity
}).strict();

const needBody = z.object({
  itemId: uuid.optional(),
  title: z.string().trim().max(200).optional(),
  quantityNeeded: quantity,
  source: z.enum(INVENTORY_SOURCES),
  note: z.string().trim().max(500).optional()
}).strict();

const updateNeedBody = z.object({
  needId: uuid,
  quantityNeeded: quantity.optional(),
  source: z.enum(INVENTORY_SOURCES).optional(),
  status: z.enum(INVENTORY_NEED_STATUSES).optional(),
  note: z.string().trim().max(500).optional()
}).strict();

// Движение на ноль — это отсутствие движения: строка в истории появилась бы, а склад не
// изменился. Минус разрешён: списание и есть способ вынести вещи со склада.
const movementBody = z.object({
  itemId: uuid,
  kind: z.enum(INVENTORY_MOVEMENT_KINDS),
  quantityDelta: signedQuantity.refine((value) => Number(value) !== 0),
  note: z.string().trim().max(500).optional()
}).strict();

export type AdminInventoryHandler = Pick<
  AdminEventInventoryService,
  "summary" | "addItem" | "setComponent" | "addNeed" | "updateNeed" | "recordMovement"
>;

@Controller("api/v1")
export class AdminInventoryController {
  constructor(
    @Inject(ADMIN_INVENTORY)
    private readonly handler: AdminInventoryHandler
  ) {}

  @Get("events/:eventId/inventory")
  @RequireAdminPermission("inventory.read")
  async summary(
    @Param("eventId") eventId: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    return execute(() =>
      this.handler.summary({
        actor: requireActor(request),
        eventId: parse(uuid, eventId)
      })
    );
  }

  @Post("inventory/items")
  @RequireAdminPermission("inventory.manage")
  async addItem(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(itemBody, body);
    await execute(() =>
      this.handler.addItem({
        actor: requireActor(request),
        title: parsed.title,
        categoryCode: parsed.categoryCode,
        ...defined("unit", parsed.unit),
        ...defined("quantityOwned", parsed.quantityOwned),
        ...defined("storageLocation", parsed.storageLocation),
        ...defined("condition", parsed.condition),
        ...defined("note", parsed.note)
      })
    );
    return { added: true };
  }

  @Post("inventory/components")
  @RequireAdminPermission("inventory.manage")
  async setComponent(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(componentBody, body);
    await execute(() =>
      this.handler.setComponent({ actor: requireActor(request), ...parsed })
    );
    return { saved: true };
  }

  @Post("events/:eventId/inventory/needs")
  @RequireAdminPermission("inventory.manage")
  async addNeed(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(needBody, body);
    await execute(() =>
      this.handler.addNeed({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        quantityNeeded: parsed.quantityNeeded,
        source: parsed.source,
        ...defined("itemId", parsed.itemId),
        ...defined("title", parsed.title),
        ...defined("note", parsed.note)
      })
    );
    return { added: true };
  }

  @Post("events/:eventId/inventory/needs/update")
  @RequireAdminPermission("inventory.manage")
  async updateNeed(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(updateNeedBody, body);
    await execute(() =>
      this.handler.updateNeed({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        needId: parsed.needId,
        changes: {
          ...defined("quantityNeeded", parsed.quantityNeeded),
          ...defined("source", parsed.source),
          ...defined("status", parsed.status),
          ...defined("note", parsed.note)
        }
      })
    );
    return { updated: true };
  }

  @Post("events/:eventId/inventory/movements")
  @RequireAdminPermission("inventory.manage")
  async recordMovement(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(movementBody, body);
    await execute(() =>
      this.handler.recordMovement({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        itemId: parsed.itemId,
        kind: parsed.kind,
        quantityDelta: parsed.quantityDelta,
        ...defined("note", parsed.note)
      })
    );
    return { recorded: true };
  }
}

@Module({})
export class AdminInventoryApiModule {
  static register(handler: AdminInventoryHandler): DynamicModule {
    return {
      module: AdminInventoryApiModule,
      controllers: [AdminInventoryController],
      providers: [{ provide: ADMIN_INVENTORY, useValue: handler }]
    };
  }
}

/** Строгий режим TypeScript отличает «не передали» от «передали пусто» — см. расходы. */
function defined<K extends string, V>(
  key: K,
  value: V | undefined
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalidRequest();
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

function invalidRequest(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_INVENTORY_REQUEST",
    title: "Данные по инвентарю заполнены неверно"
  });
}

async function execute<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    if (error.message === "Event was not found") {
      throw new NotFoundException({
        code: "EVENT_NOT_FOUND",
        title: "Мероприятие не найдено"
      });
    }
    if (error.message === "Inventory item was not found") {
      throw new NotFoundException({
        code: "INVENTORY_ITEM_NOT_FOUND",
        title: "Позиция склада не найдена"
      });
    }
    if (error.message === "Inventory need was not found") {
      throw new NotFoundException({
        code: "INVENTORY_NEED_NOT_FOUND",
        title: "Строка погрузки не найдена"
      });
    }
    if (error.message === "Inventory item with this title already exists") {
      throw new ConflictException({
        code: "INVENTORY_ITEM_EXISTS",
        title: "Позиция с таким названием уже есть на складе"
      });
    }
    if (
      error.message.startsWith("Administrator inventory ")
      || error.message.startsWith("Inventory request ")
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
