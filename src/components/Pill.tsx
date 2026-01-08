import React from "react";

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-400/15 text-emerald-200"
      : tone === "danger"
        ? "bg-rose-400/15 text-rose-200"
        : "bg-white/10 text-white/80";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${toneCls}`}>
      {children}
    </span>
  );
}
