"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className={cn(
        "rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-soft dark:border-zinc-800/80 dark:bg-zinc-950",
        className
      )}
      {...props}
    />
  );
}
