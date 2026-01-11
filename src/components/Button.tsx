import React from 'react'
import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  isLoading?: boolean
}

export function Button({ className, variant = 'primary', isLoading, disabled, children, ...props }: ButtonProps) {
  const styles = {
    primary:
      'bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-900 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100',
    secondary:
      'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 active:bg-zinc-100 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800',
    ghost:
      'bg-transparent text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 dark:text-white dark:hover:bg-zinc-900 dark:active:bg-zinc-800',
    danger:
      'bg-red-600 text-white hover:bg-red-500 active:bg-red-600',
  } as const

  return (
    <button
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-zinc-400/40 disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner />
          <span>Working…</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
