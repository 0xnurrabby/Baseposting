import * as React from "react";
import { cn } from "@/components/cn";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
};

export function Button({ className, variant = "primary", loading, disabled, children, ...props }: Props) {
  const isDisabled = disabled || loading;
  return (
    <button
      disabled={isDisabled}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition",
        "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent focus:ring-blue-500",
        "active:scale-[0.99]",
        isDisabled && "cursor-not-allowed opacity-60 active:scale-100",
        variant === "primary" &&
          "bg-blue-600 text-white shadow-soft hover:bg-blue-500",
        variant === "secondary" &&
          "bg-zinc-900/5 text-zinc-900 hover:bg-zinc-900/10 dark:bg-white/10 dark:text-zinc-50 dark:hover:bg-white/15",
        variant === "ghost" &&
          "bg-transparent text-zinc-900 hover:bg-zinc-900/5 dark:text-zinc-50 dark:hover:bg-white/10",
        className
      )}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          <span>{children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
