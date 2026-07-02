import type * as React from "react";

import { cn } from "@/lib/utils";

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

/**
 * Format an integer amount of cents as Australian dollars. Negative amounts
 * use a proper minus sign (U+2212); `signed` adds a leading + to positives.
 */
export function formatMoney(cents: number, options?: { signed?: boolean }): string {
  const formatted = aud.format(cents / 100).replace(/-/, "−");
  return options?.signed && cents > 0 ? `+${formatted}` : formatted;
}

interface MoneyProps extends React.ComponentProps<"span"> {
  /** Integer cents — never float dollars (DESIGN.md §9). */
  cents: number;
  /** Show a leading + on positive amounts. */
  signed?: boolean;
}

/** Money in registry mono with tabular figures; negatives in oxide. */
function Money({ cents, signed = false, className, ...props }: MoneyProps) {
  return (
    <span
      data-slot="money"
      className={cn("font-mono tabular-nums", cents < 0 && "text-critical", className)}
      {...props}
    >
      {formatMoney(cents, { signed })}
    </span>
  );
}

export { Money };
