import { CircleAlertIcon } from "lucide-react";
import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Accessibility props Field injects into its control. */
export interface FieldControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  "aria-required": true | undefined;
}

interface FieldProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Override the generated control id (must match the control's own id). */
  htmlFor?: string;
  className?: string;
  /**
   * A single control element (id/aria props are cloned onto it) or a render
   * function receiving them — use the function form when the focusable
   * control is nested (e.g. a radix Select trigger).
   */
  children:
    | React.ReactElement<Partial<FieldControlProps>>
    | ((props: FieldControlProps) => React.ReactNode);
}

/**
 * Label + control + hint + error, with htmlFor / aria-invalid /
 * aria-describedby wired (DESIGN.md §7.1).
 */
function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  const generatedId = React.useId();
  const id = htmlFor ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const controlProps: FieldControlProps = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required || undefined,
  };

  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
        {required && (
          <span aria-hidden="true" className="-ml-1 text-critical">
            *
          </span>
        )}
      </Label>
      {typeof children === "function"
        ? children(controlProps)
        : React.cloneElement(children, controlProps)}
      {hint && !error && (
        <p id={hintId} data-slot="field-hint" className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          data-slot="field-error"
          className="flex items-start gap-1 text-[13px] text-critical"
        >
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Vertical stack of fields with consistent spacing. */
function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="field-group" className={cn("flex flex-col gap-4", className)} {...props} />
  );
}

export { Field, FieldGroup };
