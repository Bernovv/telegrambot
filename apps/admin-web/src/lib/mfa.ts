export type AdminAuthDestination = "/mfa" | "/users";

export function adminDestinationForAssurance(
  currentLevel: string | null
): AdminAuthDestination {
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
