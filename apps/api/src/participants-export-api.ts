import {
  BadRequestException,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  Param,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const PARTICIPANTS_EXPORT = Symbol("PARTICIPANTS_EXPORT");
const eventIdSchema = z.string().uuid();

export interface ExportParticipantsHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly eventId: string;
  }): Promise<{
    readonly csv: string;
    readonly rowCount: number;
    readonly filename: string;
  }>;
}

@Controller("api/v1/events")
export class ParticipantsExportController {
  constructor(
    @Inject(PARTICIPANTS_EXPORT)
    private readonly handler: ExportParticipantsHandler
  ) {}

  @Get(":eventId/participants/export")
  @RequireAdminPermission("participants.export")
  async export(
    @Param("eventId") eventId: string,
    @Req() request: AuthenticatedAdminRequest,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<string> {
    const actor = requireActor(request);
    const parsed = eventIdSchema.safeParse(eventId);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_PARTICIPANTS_EXPORT_REQUEST",
        title: "Participants export request is invalid"
      });
    }

    try {
      const result = await this.handler.execute({
        actor,
        eventId: parsed.data
      });
      response.header("Content-Type", "text/csv; charset=utf-8");
      response.header(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`
      );
      return result.csv;
    } catch (error) {
      throw mapExportError(error);
    }
  }
}

@Module({})
export class ParticipantsExportApiModule {
  static register(handler: ExportParticipantsHandler): DynamicModule {
    return {
      module: ParticipantsExportApiModule,
      controllers: [ParticipantsExportController],
      providers: [{ provide: PARTICIPANTS_EXPORT, useValue: handler }]
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

function mapExportError(error: unknown): unknown {
  if (
    error instanceof Error
    && error.message.startsWith("Administrator ")
    && error.message.endsWith(" is invalid")
  ) {
    return new BadRequestException({
      code: "INVALID_PARTICIPANTS_EXPORT_REQUEST",
      title: "Participants export request is invalid"
    });
  }
  return error;
}
