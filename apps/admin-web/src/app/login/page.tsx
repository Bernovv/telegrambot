import { getPublicSupabaseConfiguration } from "@/lib/environment";
import { adminDestinationForAssurance } from "@/lib/mfa";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Вход" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createServerSupabaseClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || !assurance) {
        redirect("/mfa");
      }
      redirect(adminDestinationForAssurance(assurance.currentLevel));
    }
  }
  const configured = getPublicSupabaseConfiguration() !== null;

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark brand-mark-large" aria-hidden="true">
          <LockKeyhole size={24} />
        </div>
        <p className="eyebrow">Ticket platform</p>
        <h1 id="login-title">Операционная панель</h1>
        <p className="login-copy">
          Войдите с рабочей учётной записью администратора.
        </p>
        <LoginForm configured={configured} />
      </section>
      <aside className="login-context" aria-hidden="true">
        <div>
          <span className="context-index">01</span>
          <p>Заказы и пользователи в едином операционном контуре.</p>
        </div>
        <div>
          <span className="context-index">02</span>
          <p>Доступ управляется ролями и политикой MFA.</p>
        </div>
        <div>
          <span className="context-index">03</span>
          <p>Контакты скрыты, финансовые данные неизменяемы.</p>
        </div>
      </aside>
    </main>
  );
}
