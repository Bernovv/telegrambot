export type OrderStatus =
  | "draft"
  | "awaiting_offer"
  | "awaiting_payment"
  | "payment_processing"
  | "paid"
  | "cancelled"
  | "expired"
  | "partially_refunded"
  | "refunded";

const transitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ["awaiting_offer", "cancelled", "expired"],
  awaiting_offer: ["awaiting_payment", "cancelled", "expired"],
  awaiting_payment: ["payment_processing", "paid", "cancelled", "expired"],
  payment_processing: ["awaiting_payment", "paid", "cancelled", "expired"],
  paid: ["partially_refunded", "refunded"],
  cancelled: [],
  expired: [],
  partially_refunded: ["refunded"],
  refunded: []
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Order cannot transition from ${from} to ${to}`);
  }
}

export function isOrderCompositionMutable(
  status: OrderStatus,
  offerAcceptedAt: Date | null
): boolean {
  return offerAcceptedAt === null && (status === "draft" || status === "awaiting_offer");
}
