import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DynamicModule,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnauthorizedException
} from "@nestjs/common";
import {
  AdminEventContentBlockNotFoundError,
  AdminEventContentSortOrderConflictError,
  AdminEventNotDraftError,
  AdminEventNotFoundError,
  AdminEventPublicationRequirementsError,
  AdminEventOfferDocumentAmbiguousError,
  AdminEventOfferNotActiveError,
  AdminEventPricingRuleNotFoundError,
  AdminEventProductCodeConflictError,
  AdminEventProductNotFoundError,
  AdminEventSlugConflictError,
  AdminEventVersionConflictError,
  AdminOfferSnapshotStorageUnavailableError,
  AdminScenarioValidationFailedError,
  AdminScenarioVersionNotDraftError,
  AdminScenarioVersionNotFoundError,
  InvalidAdminEventMutationError
} from "@ticket-platform/application";
import {
  ADMIN_EVENT_CONTENT_BLOCK_TYPES,
  ADMIN_EVENT_STATUSES,
  ADMIN_PRODUCT_TYPES,
  ADMIN_SCENARIO_NODE_TYPES,
  type AdminEventCatalogMutationResult,
  type AdminEventContentBlockInput,
  type AdminEventContentMutationResult,
  type AdminEventDetail,
  type AdminEventMutationResult,
  type AdminEventOfferMutationResult,
  type AdminEventPublicationResult,
  type AdminEventScenarioMutationResult,
  type AdminEventSummary,
  type AdminEventPricingRuleInput,
  type AdminEventProductInput,
  type CreateAdminEventRequest,
  type CursorPage,
  type PublishAdminEventOfferVersionRequest,
  type SaveAdminEventScenarioDraftRequest,
  type UpdateAdminEventGeneralRequest
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_EVENTS = Symbol("ADMIN_EVENTS");
const idSchema = z.string().uuid();
const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{20,300}$/);
const eventListQuerySchema = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  status: z.enum(ADMIN_EVENT_STATUSES).optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();
const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const eventGeneralSchema = z.object({
  slug: z.string().trim().min(2).max(100)
    .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/),
  title: z.string().trim().min(1).max(250),
  description: z.string().max(10_000),
  timezone: z.string().trim().min(1).max(100),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  salesStartsAt: z.string().datetime({ offset: true }).nullable(),
  salesEndsAt: z.string().datetime({ offset: true }).nullable(),
  locationName: nullableText(250),
  locationAddress: nullableText(500),
  supportContact: nullableText(250),
  capacity: z.number().int().min(1).max(10_000_000),
  reservationTtlMinutes: z.number().int().min(1).max(1_440),
  phoneRequiredForPurchase: z.boolean(),
  offerRequired: z.boolean()
});
const createEventSchema = eventGeneralSchema.extend({
  reason: z.string().trim().min(3).max(500)
}).strict();
const updateEventSchema = eventGeneralSchema.extend({
  expectedLockVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500)
}).strict();
const catalogMutationSchema = z.object({
  expectedLockVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500)
});
const productSchema = z.object({
  code: z.string().trim().min(2).max(100)
    .regex(/^[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*$/),
  productType: z.enum(ADMIN_PRODUCT_TYPES),
  title: z.string().trim().min(1).max(250),
  description: z.string().max(5_000),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  bundleComposition: z.array(z.record(z.string(), z.unknown())).max(50),
  inventoryUnitsPerItem: z.number().int().min(1).max(1_000_000),
  capacity: z.number().int().min(1).max(10_000_000).nullable(),
  maximumQuantityPerOrder: z.number().int().min(1).max(100_000),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1_000_000)
}).strict();
const productMutationSchema = catalogMutationSchema.extend({
  product: productSchema
}).strict();
const pricingRuleSchema = z.object({
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  minimumQuantity: z.number().int().min(1).max(100_000),
  maximumQuantity: z.number().int().min(1).max(100_000).nullable(),
  unitPriceKopecks: z.string().regex(/^\d{1,19}$/),
  priority: z.number().int().min(-1_000_000).max(1_000_000),
  validFrom: z.string().datetime({ offset: true }).nullable(),
  validUntil: z.string().datetime({ offset: true }).nullable(),
  explanation: z.string().trim().min(1).max(500),
  isActive: z.boolean()
}).strict();
const pricingRuleMutationSchema = catalogMutationSchema.extend({
  pricingRule: pricingRuleSchema
}).strict();
const contentBlockSchema = z.object({
  blockType: z.enum(ADMIN_EVENT_CONTENT_BLOCK_TYPES),
  title: z.string().trim().max(250).nullable(),
  content: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int().min(0).max(1_000_000),
  isVisible: z.boolean()
}).strict();
const contentBlockMutationSchema = catalogMutationSchema.extend({
  contentBlock: contentBlockSchema
}).strict();
const offerVersionMutationSchema = catalogMutationSchema.extend({
  offer: z.object({
    documentTitle: z.string().trim().min(1).max(250),
    sourceType: z.enum(["google_docs", "html"]),
    sourceUrl: z.string().url().max(2_000).nullable(),
    sourceRevisionId: z.string().trim().max(250).nullable(),
    displayTextSnapshot: z.string().trim().min(1).max(50_000)
  }).strict()
}).strict();
const deactivateOfferSchema = catalogMutationSchema.strict();
const scenarioNodeSchema = z.object({
  id: idSchema,
  type: z.enum(ADMIN_SCENARIO_NODE_TYPES),
  schemaVersion: z.number().int().min(1).max(32_767),
  payload: z.record(z.string(), z.unknown())
}).strict();
const scenarioEdgeSchema = z.object({
  id: idSchema,
  fromNodeId: idSchema,
  toNodeId: idSchema,
  label: z.string().trim().min(1).max(250).nullable(),
  priority: z.number().int().min(-1_000_000).max(1_000_000),
  condition: z.record(z.string(), z.unknown())
}).strict();
const scenarioDraftSchema = catalogMutationSchema.extend({
  scenario: z.object({
    title: z.string().trim().min(1).max(250),
    schemaVersion: z.number().int().min(1).max(32_767),
    nodes: z.array(scenarioNodeSchema).max(500),
    edges: z.array(scenarioEdgeSchema).max(2_000)
  }).strict()
}).strict();
const publishScenarioSchema = catalogMutationSchema.strict();
const publishEventSchema = catalogMutationSchema.strict();

export interface AdminEventsHandlers {
  readonly listEvents: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly search?: string;
      readonly status?: string;
      readonly cursor?: string;
      readonly limit?: number;
    }): Promise<CursorPage<AdminEventSummary>>;
  };
  readonly getEvent: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly eventId: string;
    }): Promise<AdminEventDetail | null>;
  };
  readonly createEvent: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly event: Omit<CreateAdminEventRequest, "reason">;
      readonly reason: string;
      readonly metadata: {
        readonly requestId: string;
        readonly ipAddress: string | null;
        readonly userAgent: string | null;
        readonly occurredAt: Date;
      };
    }): Promise<AdminEventMutationResult>;
  };
  readonly updateEventGeneral: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly eventId: string;
      readonly expectedLockVersion: number;
      readonly event: Omit<
        UpdateAdminEventGeneralRequest,
        "expectedLockVersion" | "reason"
      >;
      readonly reason: string;
      readonly metadata: {
        readonly requestId: string;
        readonly ipAddress: string | null;
        readonly userAgent: string | null;
        readonly occurredAt: Date;
      };
    }): Promise<AdminEventMutationResult>;
  };
  readonly publishEvent: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly eventId: string;
      readonly expectedLockVersion: number;
      readonly reason: string;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminEventPublicationResult>;
  };
  readonly createContentBlock: ContentBlockHandler<false>;
  readonly updateContentBlock: ContentBlockHandler<true>;
  readonly publishOfferVersion: OfferVersionHandler;
  readonly deactivateOffer: DeactivateOfferHandler;
  readonly saveScenarioDraft: ScenarioDraftHandler;
  readonly publishScenarioVersion: ScenarioPublishHandler;
  readonly createProduct: CatalogProductHandler<false>;
  readonly updateProduct: CatalogProductHandler<true>;
  readonly createPricingRule: CatalogPricingHandler<false>;
  readonly updatePricingRule: CatalogPricingHandler<true>;
}

interface OfferVersionHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly offer: PublishAdminEventOfferVersionRequest["offer"];
    readonly reason: string;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  }): Promise<AdminEventOfferMutationResult>;
}

interface DeactivateOfferHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly reason: string;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  }): Promise<AdminEventOfferMutationResult>;
}

interface ScenarioDraftHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly scenario: SaveAdminEventScenarioDraftRequest["scenario"];
    readonly reason: string;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  }): Promise<AdminEventScenarioMutationResult>;
}

interface ScenarioPublishHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
    readonly scenarioVersionId: string;
    readonly expectedLockVersion: number;
    readonly reason: string;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  }): Promise<AdminEventScenarioMutationResult>;
}

interface ContentBlockHandler<WithContentBlockId extends boolean> {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly contentBlock: AdminEventContentBlockInput;
    readonly reason: string;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  } & (WithContentBlockId extends true
    ? { readonly contentBlockId: string }
    : Record<never, never>)): Promise<AdminEventContentMutationResult>;
}

interface CatalogProductHandler<WithProductId extends boolean> {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly product: AdminEventProductInput;
    readonly reason: string;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  } & (WithProductId extends true
    ? { readonly productId: string }
    : Record<never, never>)): Promise<AdminEventCatalogMutationResult>;
}

interface CatalogPricingHandler<WithRuleId extends boolean> {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
    readonly productId: string;
    readonly expectedLockVersion: number;
    readonly pricingRule: AdminEventPricingRuleInput;
    readonly reason: string;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  } & (WithRuleId extends true
    ? { readonly pricingRuleId: string }
    : Record<never, never>)): Promise<AdminEventCatalogMutationResult>;
}

@Controller("api/v1/events")
export class AdminEventsController {
  constructor(
    @Inject(ADMIN_EVENTS)
    private readonly handlers: AdminEventsHandlers
  ) {}

  @Post()
  @HttpCode(201)
  @RequireAdminPermission("events.write")
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventMutationResult> {
    const actor = requireActor(request);
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidEventMutation();
    }
    const { reason, ...event } = parsed.data;
    try {
      return await this.handlers.createEvent.execute({
        actor,
        event,
        reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Patch(":id/general")
  @RequireAdminPermission("events.write")
  async updateGeneral(
    @Param("id") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventMutationResult> {
    const actor = requireActor(request);
    const parsedId = idSchema.safeParse(eventId);
    const parsed = updateEventSchema.safeParse(body);
    if (!parsedId.success || !parsed.success) {
      throw invalidEventMutation();
    }
    const { expectedLockVersion, reason, ...event } = parsed.data;
    try {
      return await this.handlers.updateEventGeneral.execute({
        actor,
        eventId: parsedId.data,
        expectedLockVersion,
        event,
        reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequireAdminPermission("events.publish")
  async publishEvent(
    @Param("id") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventPublicationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsed = publishEventSchema.safeParse(body);
    if (!parsedEventId.success || !parsed.success) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.publishEvent.execute({
        actor,
        eventId: parsedEventId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Post(":id/content-blocks")
  @HttpCode(201)
  @RequireAdminPermission("events.write")
  async createContentBlock(
    @Param("id") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventContentMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsed = contentBlockMutationSchema.safeParse(body);
    if (!parsedEventId.success || !parsed.success) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.createContentBlock.execute({
        actor,
        eventId: parsedEventId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        contentBlock: parsed.data.contentBlock,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Patch(":id/content-blocks/:contentBlockId")
  @RequireAdminPermission("events.write")
  async updateContentBlock(
    @Param("id") eventId: string,
    @Param("contentBlockId") contentBlockId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventContentMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsedContentBlockId = idSchema.safeParse(contentBlockId);
    const parsed = contentBlockMutationSchema.safeParse(body);
    if (
      !parsedEventId.success
      || !parsedContentBlockId.success
      || !parsed.success
    ) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.updateContentBlock.execute({
        actor,
        eventId: parsedEventId.data,
        contentBlockId: parsedContentBlockId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        contentBlock: parsed.data.contentBlock,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Post(":id/offer-versions")
  @HttpCode(201)
  @RequireAdminPermission("events.write")
  async publishOfferVersion(
    @Param("id") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventOfferMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsed = offerVersionMutationSchema.safeParse(body);
    if (!parsedEventId.success || !parsed.success) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.publishOfferVersion.execute({
        actor,
        eventId: parsedEventId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        offer: parsed.data.offer,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Patch(":id/offer/deactivate")
  @RequireAdminPermission("events.write")
  async deactivateOffer(
    @Param("id") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventOfferMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsed = deactivateOfferSchema.safeParse(body);
    if (!parsedEventId.success || !parsed.success) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.deactivateOffer.execute({
        actor,
        eventId: parsedEventId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Post(":id/scenario-drafts")
  @HttpCode(201)
  @RequireAdminPermission("events.write")
  async saveScenarioDraft(
    @Param("id") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventScenarioMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsed = scenarioDraftSchema.safeParse(body);
    if (!parsedEventId.success || !parsed.success) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.saveScenarioDraft.execute({
        actor,
        eventId: parsedEventId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        scenario: parsed.data.scenario,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Post(":id/scenario-versions/:scenarioVersionId/publish")
  @HttpCode(200)
  @RequireAdminPermission("scenarios.publish")
  async publishScenarioVersion(
    @Param("id") eventId: string,
    @Param("scenarioVersionId") scenarioVersionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventScenarioMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsedVersionId = idSchema.safeParse(scenarioVersionId);
    const parsed = publishScenarioSchema.safeParse(body);
    if (
      !parsedEventId.success
      || !parsedVersionId.success
      || !parsed.success
    ) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.publishScenarioVersion.execute({
        actor,
        eventId: parsedEventId.data,
        scenarioVersionId: parsedVersionId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Post(":id/products")
  @HttpCode(201)
  @RequireAdminPermission("events.write")
  async createProduct(
    @Param("id") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventCatalogMutationResult> {
    const actor = requireActor(request);
    const parsedId = idSchema.safeParse(eventId);
    const parsed = productMutationSchema.safeParse(body);
    if (!parsedId.success || !parsed.success) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.createProduct.execute({
        actor,
        eventId: parsedId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        product: parsed.data.product,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Patch(":id/products/:productId")
  @RequireAdminPermission("events.write")
  async updateProduct(
    @Param("id") eventId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventCatalogMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsedProductId = idSchema.safeParse(productId);
    const parsed = productMutationSchema.safeParse(body);
    if (
      !parsedEventId.success
      || !parsedProductId.success
      || !parsed.success
    ) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.updateProduct.execute({
        actor,
        eventId: parsedEventId.data,
        productId: parsedProductId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        product: parsed.data.product,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Post(":id/products/:productId/pricing-rules")
  @HttpCode(201)
  @RequireAdminPermission("events.write")
  async createPricingRule(
    @Param("id") eventId: string,
    @Param("productId") productId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventCatalogMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsedProductId = idSchema.safeParse(productId);
    const parsed = pricingRuleMutationSchema.safeParse(body);
    if (
      !parsedEventId.success
      || !parsedProductId.success
      || !parsed.success
    ) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.createPricingRule.execute({
        actor,
        eventId: parsedEventId.data,
        productId: parsedProductId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        pricingRule: parsed.data.pricingRule,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Patch(":id/products/:productId/pricing-rules/:pricingRuleId")
  @RequireAdminPermission("events.write")
  async updatePricingRule(
    @Param("id") eventId: string,
    @Param("productId") productId: string,
    @Param("pricingRuleId") pricingRuleId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventCatalogMutationResult> {
    const actor = requireActor(request);
    const parsedEventId = idSchema.safeParse(eventId);
    const parsedProductId = idSchema.safeParse(productId);
    const parsedPricingRuleId = idSchema.safeParse(pricingRuleId);
    const parsed = pricingRuleMutationSchema.safeParse(body);
    if (
      !parsedEventId.success
      || !parsedProductId.success
      || !parsedPricingRuleId.success
      || !parsed.success
    ) {
      throw invalidEventMutation();
    }
    try {
      return await this.handlers.updatePricingRule.execute({
        actor,
        eventId: parsedEventId.data,
        productId: parsedProductId.data,
        pricingRuleId: parsedPricingRuleId.data,
        expectedLockVersion: parsed.data.expectedLockVersion,
        pricingRule: parsed.data.pricingRule,
        reason: parsed.data.reason,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapEventMutationError(error);
    }
  }

  @Get()
  @RequireAdminPermission("events.read")
  async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<CursorPage<AdminEventSummary>> {
    const actor = requireActor(request);
    const parsed = eventListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw invalidEventQuery();
    }
    try {
      return await this.handlers.listEvents.execute({
        actor,
        ...(parsed.data.search === undefined
          ? {}
          : { search: parsed.data.search }),
        ...(parsed.data.status === undefined
          ? {}
          : { status: parsed.data.status }),
        ...(parsed.data.cursor === undefined
          ? {}
          : { cursor: parsed.data.cursor }),
        ...(parsed.data.limit === undefined
          ? {}
          : { limit: parsed.data.limit })
      });
    } catch (error) {
      throw mapEventReadError(error);
    }
  }

  @Get(":id")
  @RequireAdminPermission("events.read")
  async get(
    @Param("id") eventId: string,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminEventDetail> {
    const actor = requireActor(request);
    const parsed = idSchema.safeParse(eventId);
    if (!parsed.success) {
      throw invalidEventQuery();
    }
    const event = await this.handlers.getEvent.execute({
      actor,
      eventId: parsed.data
    });
    if (!event) {
      throw new NotFoundException({
        code: "ADMIN_EVENT_NOT_FOUND",
        title: "Event was not found"
      });
    }
    return event;
  }
}

@Module({})
export class AdminEventsApiModule {
  static register(handlers: AdminEventsHandlers): DynamicModule {
    return {
      module: AdminEventsApiModule,
      controllers: [AdminEventsController],
      providers: [{ provide: ADMIN_EVENTS, useValue: handlers }]
    };
  }
}

function requireActor(
  request: AuthenticatedAdminRequest
): NonNullable<AuthenticatedAdminRequest["adminActor"]> {
  if (!request.adminActor) {
    throw new UnauthorizedException();
  }
  return request.adminActor;
}

function invalidEventQuery(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_EVENT_QUERY",
    title: "Administrator event query is invalid"
  });
}

function invalidEventMutation(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_EVENT_MUTATION",
    title: "Administrator event mutation is invalid"
  });
}

function mapEventReadError(error: unknown): unknown {
  if (
    error instanceof Error
    && error.message.startsWith("Administrator event ")
    && error.message.endsWith(" is invalid")
  ) {
    return invalidEventQuery();
  }
  return error;
}

function mutationMetadata(request: AuthenticatedAdminRequest) {
  return {
    requestId: readRequestId(request),
    ipAddress: request.ip || null,
    userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
    occurredAt: new Date()
  };
}

function readRequestId(request: AuthenticatedAdminRequest): string {
  const header = request.headers["x-request-id"];
  if (
    typeof header === "string"
    && header.length >= 8
    && header.length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(header)
  ) {
    return header;
  }
  return String(request.id).slice(0, 200);
}

function mapEventMutationError(error: unknown): unknown {
  if (error instanceof InvalidAdminEventMutationError) {
    return invalidEventMutation();
  }
  if (error instanceof AdminEventNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_EVENT_NOT_FOUND",
      title: "Event was not found"
    });
  }
  if (error instanceof AdminEventSlugConflictError) {
    return new ConflictException({
      code: "ADMIN_EVENT_SLUG_CONFLICT",
      title: "Event slug is already in use"
    });
  }
  if (error instanceof AdminEventVersionConflictError) {
    return new ConflictException({
      code: "ADMIN_EVENT_VERSION_CONFLICT",
      title: "Event was changed by another administrator"
    });
  }
  if (error instanceof AdminEventNotDraftError) {
    return new ConflictException({
      code: "ADMIN_EVENT_NOT_DRAFT",
      title: "Only draft events can be changed"
    });
  }
  if (error instanceof AdminEventPublicationRequirementsError) {
    return new UnprocessableEntityException({
      code: "ADMIN_EVENT_PUBLICATION_REQUIREMENTS_FAILED",
      title: "Event does not meet publication requirements",
      issues: error.issues
    });
  }
  if (error instanceof AdminEventProductNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_EVENT_PRODUCT_NOT_FOUND",
      title: "Event product was not found"
    });
  }
  if (error instanceof AdminEventPricingRuleNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_EVENT_PRICING_RULE_NOT_FOUND",
      title: "Pricing rule was not found"
    });
  }
  if (error instanceof AdminEventProductCodeConflictError) {
    return new ConflictException({
      code: "ADMIN_EVENT_PRODUCT_CODE_CONFLICT",
      title: "Product code is already in use for this event"
    });
  }
  if (error instanceof AdminEventContentBlockNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_EVENT_CONTENT_BLOCK_NOT_FOUND",
      title: "Event content block was not found"
    });
  }
  if (error instanceof AdminEventContentSortOrderConflictError) {
    return new ConflictException({
      code: "ADMIN_EVENT_CONTENT_SORT_ORDER_CONFLICT",
      title: "Content sort order is already in use for this event"
    });
  }
  if (error instanceof AdminEventOfferDocumentAmbiguousError) {
    return new ConflictException({
      code: "ADMIN_EVENT_OFFER_DOCUMENT_AMBIGUOUS",
      title: "Event has more than one offer document"
    });
  }
  if (error instanceof AdminEventOfferNotActiveError) {
    return new ConflictException({
      code: "ADMIN_EVENT_OFFER_NOT_ACTIVE",
      title: "Event has no active offer version"
    });
  }
  if (error instanceof AdminOfferSnapshotStorageUnavailableError) {
    return new ServiceUnavailableException({
      code: "ADMIN_OFFER_STORAGE_UNAVAILABLE",
      title: "Immutable offer storage is unavailable"
    });
  }
  if (error instanceof AdminScenarioVersionNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_SCENARIO_VERSION_NOT_FOUND",
      title: "Scenario version was not found"
    });
  }
  if (error instanceof AdminScenarioVersionNotDraftError) {
    return new ConflictException({
      code: "ADMIN_SCENARIO_VERSION_NOT_DRAFT",
      title: "Published scenario version is immutable"
    });
  }
  if (error instanceof AdminScenarioValidationFailedError) {
    return new UnprocessableEntityException({
      code: "ADMIN_SCENARIO_VALIDATION_FAILED",
      title: "Scenario graph did not pass publication validation",
      issues: error.issues
    });
  }
  return error;
}
