import { AdminShell } from "@/components/admin-shell";
import { isAdminMfaRequired } from "@/lib/environment";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    redirect("/login");
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirect("/login");
  }
  // Второй фактор выключен — уровень подтверждения не спрашиваем вовсе: запрос к Supabase
  // ради значения, которое ни на что не влияет, только замедляет каждую страницу панели.
  if (isAdminMfaRequired()) {
    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) {
      redirect("/login");
    }
    if (assurance.currentLevel !== "aal2") {
      redirect("/mfa");
    }
  }

  return (
    <AdminShell identity={data.user.email ?? "Администратор"}>
      {children}
    </AdminShell>
  );
}
