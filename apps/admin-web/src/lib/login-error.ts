// Supabase отвечает машиночитаемым кодом, и разница между ними принципиальна для того, кто
// пытается войти: «неверный пароль» человек исправит сам, а «провайдер выключен» и «почта не
// подтверждена» чинятся только в настройках проекта — и искать их надо в разных местах.
// Общая фраза про MFA, которая была здесь раньше, отправляла разбираться не туда.
export function loginErrorMessage(error: unknown): string {
  const code = readCode(error);
  if (code === "email_provider_disabled") {
    return "Вход по почте отключён в настройках Supabase: Authentication → Sign In / Providers → Email.";
  }
  if (code === "email_not_confirmed") {
    return "Почта не подтверждена. Подтвердите пользователя в Supabase → Authentication → Users.";
  }
  if (code === "invalid_credentials") {
    return "Неверная почта или пароль.";
  }
  if (code === "over_request_rate_limit" || code === "too_many_requests") {
    return "Слишком много попыток входа. Подождите пару минут и попробуйте снова.";
  }
  if (code === "user_banned") {
    return "Пользователь заблокирован в Supabase.";
  }
  return "Не удалось войти. Проверьте почту и пароль.";
}

function readCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const record = error as Record<string, unknown>;
  if (typeof record.code === "string") {
    return record.code;
  }
  // У части ответов кода нет — остаётся текст сообщения.
  if (typeof record.message === "string") {
    const message = record.message.toLowerCase();
    if (message.includes("email logins are disabled")) {
      return "email_provider_disabled";
    }
    if (message.includes("email not confirmed")) {
      return "email_not_confirmed";
    }
    if (message.includes("invalid login credentials")) {
      return "invalid_credentials";
    }
  }
  return null;
}
