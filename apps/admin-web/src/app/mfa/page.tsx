import { MfaForm } from "@/components/mfa-form";
import { isAdminMfaRequired } from "@/lib/environment";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Подтверждение входа" };
export const dynamic = "force-dynamic";

export default async function MfaPage() {
  // Ссылку на этот экран могли сохранить в закладках, а он выключен. Отправлять человека
  // заводить код, который у него всё равно не спросят, — тупик.
  if (!isAdminMfaRequired()) {
    redirect("/users");
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    redirect("/login");
  }
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    redirect("/login");
  }
  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) {
    redirect("/login");
  }
  if (assurance.currentLevel === "aal2") {
    redirect("/users");
  }

  return (
    <main className="login-page">
      <section className="login-panel mfa-login-panel" aria-labelledby="mfa-title">
        <div className="brand-mark brand-mark-large" aria-hidden="true">
          <ShieldCheck size={24} />
        </div>
        <p className="eyebrow">Ticket platform</p>
        <h1 id="mfa-title">Защита учётной записи</h1>
        <p className="login-copy">{userData.user.email ?? "Администратор"}</p>
        <MfaForm />
      </section>
      <aside className="login-context" aria-hidden="true">
        <div>
          <span className="context-index">01</span>
          <p>Одноразовый код подтверждает защищённую административную сессию.</p>
        </div>
        <div>
          <span className="context-index">02</span>
          <p>Секрет остаётся только в приложении-аутентификаторе.</p>
        </div>
        <div>
          <span className="context-index">03</span>
          <p>Финансовые операции доступны только на уровне aal2.</p>
        </div>
      </aside>
    </main>
  );
}
