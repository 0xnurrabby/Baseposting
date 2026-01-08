"use client";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-zinc-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-zinc-950 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/70 dark:text-zinc-50",
        className
      )}
      {...props}
    />
  );
}
