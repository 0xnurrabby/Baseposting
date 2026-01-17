import React from 'react'

// Simple podium + star icon (inspired by the reference image)
export function LeaderboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* star */}
      <path
        d="M12 2.6l1.67 3.38 3.73.54-2.7 2.63.64 3.71L12 11.72 8.66 12.86l.64-3.71-2.7-2.63 3.73-.54L12 2.6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* podium */}
      <path
        d="M6.5 21V12.8c0-.44.36-.8.8-.8h3.4c.44 0 .8.36.8.8V21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 21V10.6c0-.44.36-.8.8-.8h2.9c.44 0 .8.36.8.8V21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M3 21h18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
