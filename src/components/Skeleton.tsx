import React from 'react'
import { cn } from '@/lib/cn'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800/70', className)}
      {...props}
    />
  )
}
