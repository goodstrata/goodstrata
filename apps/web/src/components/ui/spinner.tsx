import { Loader2Icon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

const spinnerSizes = {
  sm: "size-3",
  default: "size-4",
  lg: "size-6",
} as const;

function Spinner({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"svg"> & { size?: keyof typeof spinnerSizes }) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("animate-spin", spinnerSizes[size], className)}
      {...props}
    />
  );
}

export { Spinner };
