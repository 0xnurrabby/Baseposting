import React from "react";
import { motion } from "framer-motion";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ loading, variant = "primary", disabled, children, ...rest }: Props) {
  const base =
    "relative inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition outline-none";
  const variants: Record<string, string> = {
    primary:
      "bg-white text-zinc-950 hover:opacity-90 active:opacity-80 disabled:bg-white/30 disabled:text-white/60",
    secondary:
      "bg-white/10 text-white hover:bg-white/14 active:bg-white/18 disabled:bg-white/5 disabled:text-white/40",
    ghost:
      "bg-transparent text-white/80 hover:bg-white/10 active:bg-white/14 disabled:text-white/40",
  };

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      className={`${base} ${variants[variant]} ${loading ? "cursor-wait" : ""}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
          <span>Working…</span>
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
}
