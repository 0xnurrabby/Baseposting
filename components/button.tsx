"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ className, loading, disabled, variant = "primary", children, ...props }: Props) {
  const isDisabled = disabled || loading;
  const styles =
    variant === "primary"
      ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
      : variant === "secondary"
      ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
      : "bg-transparent text-zinc-950 dark:text-zinc-50";

  return (
    <motion.button
      whileTap={isDisabled ? undefined : { scale: 0.98 }}
      whileHover={isDisabled ? undefined : { y: -1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-soft",
        "focus:outline-none focus:ring-2 focus:ring-zinc-400/40 dark:focus:ring-zinc-500/40",
        "disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed",
        styles,
        className
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>Working…</span>
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
}
