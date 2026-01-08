import React from "react";

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="gradient-border shadow-soft">
      <div className="card p-4 sm:p-5">{children}</div>
    </div>
  );
}
