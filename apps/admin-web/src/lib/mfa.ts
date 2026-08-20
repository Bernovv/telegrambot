export type AdminAuthDestination = "/mfa" | "/users";

/**
 * Куда вести вошедшего. Когда второй фактор выключен, уровень подтверждения роли не
 * играет: экран с кодом показывать нечего, и человек идёт сразу в панель.
 */
export function adminDestinationForAssurance(
  currentLevel: string | null,
  mfaRequired = true
): AdminAuthDestination {
  if (!mfaRequired) {
    return "/users";
  }
  return currentLevel === "aal2" ? "/users" : "/mfa";
}

export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isValidTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function totpQrDataUrl(svg: string): string {
  return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
}
