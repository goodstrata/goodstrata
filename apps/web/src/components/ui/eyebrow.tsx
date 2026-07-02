import type * as React from "react";

import { cn } from "@/lib/utils";

/** Registry kicker: mono, uppercase, tracked (DESIGN.md §4). */
function Eyebrow({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="eyebrow"
      className={cn("eyebrow text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Eyebrow };
