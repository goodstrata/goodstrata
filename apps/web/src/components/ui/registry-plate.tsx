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
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <p
          className={cn(
            "col-start-1 row-start-1 font-mono text-muted-foreground",
            compact ? "text-[11px]" : "text-xs",
          )}
        >
          {eyebrow}
        </p>
        <Name
          className={cn(
            "mt-0.5 min-w-0 font-display font-bold tracking-tight",
            compact
              ? "col-start-1 row-start-2 truncate text-xl"
              : "col-span-2 row-start-2 break-words text-3xl leading-tight text-balance sm:col-span-1 md:text-4xl",
          )}
        >
          {name}
        </Name>
        {meta && (
          <p
            className={cn(
              "mt-0.5 min-w-0 break-words text-13 text-muted-foreground",
              compact ? "col-start-1 row-start-3" : "col-span-2 row-start-3 sm:col-span-1",
            )}
          >
            {meta}
          </p>
        )}
        {badge && (
          <div className="col-start-2 row-start-1 shrink-0 self-start pt-0.5 sm:row-span-3">
            {badge}
          </div>
        )}
      </div>
      <div className={cn("flex items-center gap-2", compact ? "mt-2" : "mt-3")}>
        <StrataMotif compact={compact} />
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </header>
  );
}

export { RegistryPlate };
