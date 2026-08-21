export const ADMIN_PERMISSIONS = [
  "users.read",
  "users.write",
  "contacts.export",
  "participants.export",
  "outreach.read",
  "outreach.write",
  "outreach.delete",
  "events.read",
  "events.write",
  "events.publish",
  "accommodation.read",
  "accommodation.manage",
  "participants.manage",
  "expenses.read",
  "expenses.manage",
  "inventory.read",
  "inventory.manage",
  "event_finance.read",
  "event_finance.manage",
  "orders.exclude",
  "orders.cancel",
  "orders.read",
  "orders.create",
  "orders.manual_paid",
  "payments.read",
  "payments.refund",
  "wallet.adjust",
  "referrals.manage",
  "broadcasts.send",
  "scenarios.publish",
  "imports.execute",
  "system.read",
  "system.manage",
  "admins.manage",
  "team.read",
  "team.manage",
  "mentor_slots.manage",
  "mentor_slots.book"
] as const;

export type AdminPermission = typeof ADMIN_PERMISSIONS[number];

export type AuthenticatorAssuranceLevel = "aal1" | "aal2";

export interface AdminRequestActor {
  readonly adminId: string;
  readonly authSubject: string;
  readonly roleCodes: readonly string[];
  readonly permission: AdminPermission;
}
