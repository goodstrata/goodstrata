import type * as React from "react";

import { cn } from "@/lib/utils";

/** Registry kicker: mono, uppercase, tracked (DESIGN.md §4). */
function Eyebrow({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"span"> & { size?: "default" | "sm" }) {
  return (
    <span
      data-slot="eyebrow"
      className={cn(size === "sm" ? "eyebrow-sm" : "eyebrow", "text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Eyebrow };
