import * as React from "react";
import { cn } from "@/components/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200/60 bg-white/60 p-4 shadow-soft backdrop-blur dark:border-white/10 dark:bg-white/5",
        className
      )}
      {...props}
    />
  );
}
