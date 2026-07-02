import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * An empty register is an invitation to act (DESIGN.md §1.4): icon in a muted
 * circle, title, one sentence, optional action.
 */
function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-1.5 flex size-10 items-center justify-center rounded-full bg-muted">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  );
}

export { EmptyState };
