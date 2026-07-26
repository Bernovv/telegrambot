import type { ReactNode } from "react";

export function StatusPill({
  tone = "neutral",
  children
}: Readonly<{
  tone?: "positive" | "warning" | "neutral" | "danger";
  children: ReactNode;
}>) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}
