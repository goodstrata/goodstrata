import type * as React from "react";

import { cn } from "@/lib/utils";

interface RegistryPlateProps {
  /** Mono identifier line, e.g. "PS 543921K · Tier 2". */
  eyebrow: React.ReactNode;
  name: React.ReactNode;
  /** Optional muted meta line under the name. */
  meta?: React.ReactNode;
  /** Optional badge rendered top-right of the plate. */
  badge?: React.ReactNode;
  /** Compact variant for dashboard scheme cards. */
  compact?: boolean;
  className?: string;
}

/** Three stacked floor plates, slightly offset like the logo (DESIGN.md §2). */
function StrataMotif({ compact }: { compact: boolean }) {
  const bar = cn("h-[2px] rounded-full bg-primary", compact ? "w-2.5" : "w-4");
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 flex-col", compact ? "gap-[2px]" : "gap-[3px]")}
    >
      <span className={cn(bar, compact ? "ml-[3px]" : "ml-[5px]")} />
      <span className={cn(bar, compact ? "ml-[1.5px]" : "ml-[2.5px]")} />
      <span className={bar} />
    </span>
  );
}

/**
 * The Registry Plate — the signature scheme nameplate (DESIGN.md §2): mono
 * identifier line, bold display name, hairline rule led by the strata motif.
 */
function RegistryPlate({
  eyebrow,
  name,
  meta,
  badge,
  compact = false,
  className,
}: RegistryPlateProps) {
  const Name = compact ? "p" : "h1";
  return (
    <header data-slot="registry-plate" className={cn("min-w-0", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-mono text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
            {eyebrow}
          </p>
          <Name
            className={cn(
              "mt-0.5 truncate font-display font-bold tracking-tight",
              compact ? "text-xl" : "text-3xl md:text-4xl",
            )}
          >
            {name}
          </Name>
          {meta && <p className="mt-0.5 text-13 text-muted-foreground">{meta}</p>}
        </div>
        {badge && <div className="shrink-0 pt-0.5">{badge}</div>}
      </div>
      <div className={cn("flex items-center gap-2", compact ? "mt-2" : "mt-3")}>
        <StrataMotif compact={compact} />
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </header>
  );
}

export { RegistryPlate };
