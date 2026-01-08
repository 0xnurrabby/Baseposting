import React from "react";

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className="h-4 w-full animate-pulse rounded-lg bg-white/10"
          style={{ width: `${Math.max(55, 100 - i * 12)}%` }}
        />
      ))}
    </div>
  );
}
