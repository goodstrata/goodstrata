import type * as React from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /**
   * Heading level for the title. Default "h1" for standalone pages (e.g. the
   * dashboard); pass "h2" inside a scheme section beneath the RegistryPlate h1.
   */
  as?: "h1" | "h2";
}

/** Section page header: title, one-line purpose, primary action (DESIGN.md §6.2). */
function PageHeader({
  title,
  description,
  actions,
  className,
  as: Heading = "h1",
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex flex-col gap-3 md:flex-row md:items-start md:justify-between", className)}
    >
      <div className="min-w-0 space-y-1">
        <Heading className="font-display text-2xl font-medium tracking-tight md:text-[1.75rem]">
          {title}
        </Heading>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { PageHeader };
