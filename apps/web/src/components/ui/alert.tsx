import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current",
      },
      /** Status tones (DESIGN.md §3.3): tinted panel, hairline tone border, toned icon. */
      tone: {
        positive: "border-positive/25 bg-positive/8 text-foreground [&>svg]:text-positive",
        caution: "border-caution/25 bg-caution/8 text-foreground [&>svg]:text-caution",
        critical: "border-critical/25 bg-critical/8 text-foreground [&>svg]:text-critical",
        info: "border-info/25 bg-info/8 text-foreground [&>svg]:text-info",
        agent: "border-agent/25 bg-agent/8 text-foreground [&>svg]:text-agent",
        neutral:
          "border-neutral-tone/25 bg-neutral-tone/8 text-foreground [&>svg]:text-neutral-tone",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  tone,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  // A tone stands alone: skip the default variant unless one is explicit.
  const appliedVariant = variant ?? (tone ? null : "default");
  return (
    <div
      data-slot="alert"
      role="alert"
      data-tone={tone ?? undefined}
      className={cn(alertVariants({ variant: appliedVariant, tone }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
