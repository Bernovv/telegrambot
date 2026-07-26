"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function LoginForm({ configured }: { readonly configured: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    configured ? null : "Supabase Auth не настроен для этой среды."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || pending) {
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const emailValue = form.get("email");
    const passwordValue = form.get("password");
    const email = typeof emailValue === "string" ? emailValue.trim() : "";
    const password = typeof passwordValue === "string" ? passwordValue : "";
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (signInError) {
        setError("Не удалось войти. Проверьте данные и требования MFA.");
        return;
      }
      router.replace("/mfa");
      router.refresh();
    } catch {
      setError("Сервис авторизации временно недоступен.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="login-form"
      onSubmit={(event) => void submit(event)}
    >
      <label>
        <span>Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          disabled={!configured || pending}
          placeholder="admin@company.ru"
        />
      </label>
      <label>
        <span>Пароль</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={!configured || pending}
        />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button
        className="primary-button login-submit"
        type="submit"
        disabled={!configured || pending}
      >
        {pending ? <LoaderCircle className="spin" size={18} /> : null}
        <span>{pending ? "Входим" : "Войти"}</span>
        {!pending ? <ArrowRight size={18} /> : null}
      </button>
    </form>
  );
}
