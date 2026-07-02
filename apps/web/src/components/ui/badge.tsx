import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
      /** Status tones (DESIGN.md §3.3) — dark-safe, tones brighten in .dark. */
      tone: {
        positive: "border-positive/20 bg-positive/10 text-positive",
        caution: "border-caution/20 bg-caution/10 text-caution",
        critical: "border-critical/20 bg-critical/10 text-critical",
        info: "border-info/20 bg-info/10 text-info",
        agent: "border-agent/20 bg-agent/10 text-agent",
        neutral: "border-neutral-tone/20 bg-neutral-tone/10 text-neutral-tone",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  // A tone stands alone: unless a variant is explicitly requested alongside,
  // skip the default variant so tone colors aren't fighting bg-primary.
  const appliedVariant = variant ?? (tone ? null : "default");

  return (
    <Comp
      data-slot="badge"
      data-variant={appliedVariant ?? undefined}
      data-tone={tone ?? undefined}
      className={cn(badgeVariants({ variant: appliedVariant, tone }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
