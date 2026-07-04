import type * as React from "react";

import { cn } from "@/lib/utils";

type StatTone = "positive" | "caution" | "critical" | "info" | "agent" | "neutral";

const statToneClasses: Record<StatTone, string> = {
  positive: "text-positive",
  caution: "text-caution",
  critical: "text-critical",
  info: "text-info",
  agent: "text-agent",
  neutral: "text-neutral-tone",
};

interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
  /** Hero figures render in the display serif instead of the registry mono. */
  hero?: boolean;
  className?: string;
}

/** Mono-set figure with a small sans label on a hairline card (DESIGN.md §7.1). */
function StatCard({ label, value, hint, tone, hero = false, className }: StatCardProps) {
  return (
    <div
      data-slot="stat-card"
      className={cn("min-w-0 rounded-lg border bg-card px-4 py-3 shadow-xs", className)}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-xl break-words sm:text-2xl",
          hero ? "font-display font-bold tracking-tight" : "font-mono font-bold tabular-nums",
          tone && statToneClasses[tone],
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-13 text-muted-foreground">{hint}</p>}
    </div>
  );
}

export { StatCard };
