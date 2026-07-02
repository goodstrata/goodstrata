import type * as React from "react";

import { cn } from "@/lib/utils";

/** dt/dd register for record detail: single column on mobile, aligned two-column from sm. */
function DescriptionList({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="description-list"
      className={cn("grid grid-cols-1 gap-y-3 sm:grid-cols-[10rem_1fr] sm:gap-x-6", className)}
      {...props}
    />
  );
}

interface DescriptionItemProps {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function DescriptionItem({ label, children, className }: DescriptionItemProps) {
  return (
    <div
      data-slot="description-item"
      className={cn(
        "flex flex-col gap-0.5 sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-baseline",
        className,
      )}
    >
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export { DescriptionItem, DescriptionList };
