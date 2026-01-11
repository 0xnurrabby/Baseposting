import React from 'react'
import { cn } from '@/lib/cn'

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600',
        className
      )}
      {...props}
    />
  )
}
