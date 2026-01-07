import clsx from "clsx";
import { motion } from "framer-motion";
import type { PropsWithChildren, HTMLAttributes } from "react";

export function Panel({
  title,
  right,
  className,
  children,
}: PropsWithChildren<{ title: string; right?: React.ReactNode; className?: string }>) {
  return (
    <div className={clsx("terminal-border rounded-2xl p-3 md:p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">::</span>
          <h2 className="text-sm md:text-base font-semibold tracking-tight">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="my-3 h-px w-full bg-slate-700/30" />;
}

export function Kbd({ children }: PropsWithChildren) {
  return <span className="code-pill rounded-lg px-2 py-1 text-[11px] text-cyan-200">{children}</span>;
}

export function FadeIn({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {children}
    </motion.div>
  );
}

export function SmallLabel({ children }: PropsWithChildren) {
  return <div className="text-[11px] uppercase tracking-wider text-slate-400">{children}</div>;
}

export function Badge({ children, tone = "cyan" }: PropsWithChildren<{ tone?: "cyan" | "slate" | "green" | "red" }>) {
  const cls =
    tone === "cyan"
      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
      : tone === "green"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
        : tone === "red"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
          : "border-slate-400/20 bg-slate-400/10 text-slate-200";
  return <span className={clsx("inline-flex items-center rounded-lg border px-2 py-1 text-[11px]", cls)}>{children}</span>;
}

export function Button({
  className,
  ...props
}: HTMLAttributes<HTMLButtonElement> & { disabled?: boolean; onClick?: () => void }) {
  // eslint-disable-next-line jsx-a11y/role-supports-aria-props
  return <button className={clsx("btn", className)} {...props} />;
}
