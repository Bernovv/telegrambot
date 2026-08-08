import type {
  ExpenseStatus,
  VendorKind
} from "@ticket-platform/contracts/admin-expenses";

export function expenseStatusLabel(status: ExpenseStatus): string {
  switch (status) {
    case "committed":
      return "Договорились";
    case "paid":
      return "Оплачено";
    case "cancelled":
      return "Отменено";
    default:
      return "В плане";
  }
}

export function expenseStatusTone(
  status: ExpenseStatus
): "positive" | "neutral" | "warning" | "danger" {
  switch (status) {
    case "paid":
      return "positive";
    case "committed":
      return "warning";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export function vendorKindLabel(kind: VendorKind): string {
  switch (kind) {
    case "rent":
      return "Аренда";
    case "catering":
      return "Питание";
    case "transport":
      return "Транспорт";
    case "venue":
      return "Площадка";
    case "staff":
      return "Персонал";
    default:
      return "Другое";
  }
}
