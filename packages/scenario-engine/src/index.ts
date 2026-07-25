export type ScenarioNodeType =
  | "start"
  | "message"
  | "menu"
  | "phone_request"
  | "order_start"
  | "offer_acceptance"
  | "payment_start"
  | "end";

export interface ScenarioNode {
  readonly id: string;
  readonly type: ScenarioNodeType;
  readonly payload: Record<string, unknown>;
}
