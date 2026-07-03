import { CircleAlertIcon, type LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

const toneStyles = {
  critical: "border-critical/25 bg-critical/8 text-critical",
  positive: "border-positive/25 bg-positive/8 text-positive",
} as const;

/**
 * Compact inline form/field message (DESIGN.md §8): tinted panel, hairline tone
 * border, whole message in the tone colour at text-13. Distinct from the larger
 * Alert (text-foreground body, px-4/text-sm) — this is the dense form treatment.
 * Defaults to a critical alert; pass `tone="positive"` for the success twin.
 */
export function FormMessage({
  tone = "critical",
  icon: Icon = CircleAlertIcon,
  role,
  className,
  children,
}: {
  tone?: keyof typeof toneStyles;
  icon?: LucideIcon;
  /** Defaults to "alert" for critical, "status" for positive. */
  role?: "alert" | "status";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={role ?? (tone === "critical" ? "alert" : "status")}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-13",
        toneStyles[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
