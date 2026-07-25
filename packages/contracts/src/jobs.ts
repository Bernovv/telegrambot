export interface JobEntityReference {
  readonly type: string;
  readonly id: string;
}

export interface JobActorReference {
  readonly type: "user" | "admin" | "system";
  readonly id: string;
}

export interface DomainEventJobV1 {
  readonly jobType: "domain-event";
  readonly schemaVersion: 1;
  readonly entity: JobEntityReference;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly actor: JobActorReference | null;
  readonly attempt: number;
  readonly createdAt: string;
  readonly event: {
    readonly type: string;
    readonly schemaVersion: number;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}
