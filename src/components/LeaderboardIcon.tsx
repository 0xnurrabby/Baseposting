import React from 'react'
import { cn } from '@/lib/cn'

// Podium + star icon (matches the idea from your reference, but customized).
export function LeaderboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5', className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Star */}
      <path d="M12 2.5l1.6 3.3 3.6.5-2.6 2.5.7 3.6-3.3-1.7-3.3 1.7.7-3.6-2.6-2.5 3.6-.5L12 2.5z" />
      {/* Podium */}
      <path d="M4 21h16" />
      <path d="M6 21v-6h4v6" />
      <path d="M10 21V11h4v10" />
      <path d="M14 21v-4h4v4" />
    </svg>
  )
}
