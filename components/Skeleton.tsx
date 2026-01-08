import { cn } from "@/components/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-zinc-200/60 dark:bg-white/10", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
    </div>
  );
}
