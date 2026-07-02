import { CircleAlertIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: React.ReactNode;
  message: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}

/** What happened + what to do next (DESIGN.md §1.4). */
function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-critical/25 bg-critical/8 px-6 py-10 text-center",
        className,
      )}
    >
      <CircleAlertIcon aria-hidden="true" className="mb-1.5 size-5 text-critical" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-2.5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export { ErrorState };
