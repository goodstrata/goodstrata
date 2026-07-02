import {
  type DeepKeys,
  revalidateLogic,
  type StandardSchemaV1,
  useForm,
} from "@tanstack/react-form";
import { CircleAlertIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type FieldErrors<TValues> = Partial<Record<DeepKeys<TValues>, string>>;

interface ServerFormError<TValues> {
  form?: string;
  fields: FieldErrors<TValues>;
}

/** Map a 422 envelope's zod issues (`{path, message}[]`) onto field names. */
function zodIssueFields<TValues>(details: unknown): FieldErrors<TValues> | undefined {
  if (!Array.isArray(details)) return undefined;
  const fields: Record<string, string> = {};
  for (const issue of details) {
    if (typeof issue !== "object" || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof message !== "string" || !Array.isArray(path)) continue;
    const key = path.reduce<string>((acc, segment) => {
      if (typeof segment === "number") return `${acc}[${segment}]`;
      if (typeof segment === "string") return acc ? `${acc}.${segment}` : segment;
      return acc;
    }, "");
    if (key && !(key in fields)) fields[key] = message;
  }
  return Object.keys(fields).length > 0 ? (fields as FieldErrors<TValues>) : undefined;
}

/**
 * First display message from a field's error list, which mixes zod issues
 * (`{message}`) and server strings. Use as
 * `<Field error={fieldError(field.state.meta.errors)}>`.
 */
export function fieldError(errors: ReadonlyArray<unknown>): string | undefined {
  for (const error of errors) {
    if (typeof error === "string" && error) return error;
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  }
  return undefined;
}

export interface AppFormOptions<TValues extends Record<string, unknown>> {
  schema: StandardSchemaV1<TValues, unknown>;
  defaultValues: TValues;
  /** The mutation. Throw (e.g. ApiError from unwrap) to surface errors. */
  onSubmit: (values: TValues) => Promise<unknown> | unknown;
}

/**
 * The app form kit (DESIGN.md §8): quiet until first submit, live after
 * (`revalidateLogic`), schema on `onDynamic`, and the submission wired as an
 * `onSubmitAsync` validator so a thrown ApiError's 422 zod issues map onto
 * fields and everything else becomes a form-level error (state.errorMap.onSubmit).
 */
export function useAppForm<TValues extends Record<string, unknown>>({
  schema,
  defaultValues,
  onSubmit,
}: AppFormOptions<TValues>) {
  return useForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: schema,
      onSubmitAsync: async ({ value }): Promise<ServerFormError<TValues> | undefined> => {
        try {
          await onSubmit(value);
          return undefined;
        } catch (error) {
          if (error instanceof ApiError) {
            const issues = zodIssueFields<TValues>(error.details);
            if (issues) {
              // Only map issues whose root path segment is a rendered field;
              // otherwise the error attaches to nothing and the form would
              // silently report success. Fall through to the form-level banner.
              const known = new Set(Object.keys(defaultValues));
              const fields = Object.fromEntries(
                Object.entries(issues).filter(([key]) => known.has(key.split(/[.[]/, 1)[0]!)),
              ) as FieldErrors<TValues>;
              if (Object.keys(fields).length > 0) return { fields };
            }
            return { form: error.message, fields: {} };
          }
          return {
            form: error instanceof Error ? error.message : "Something went wrong. Try again.",
            fields: {},
          };
        }
      },
    },
  });
}

export type AppForm<TValues extends Record<string, unknown>> = ReturnType<
  typeof useAppForm<TValues>
>;

/** Form-level server error, rendered above the submit button (DESIGN.md §8). */
export function FormError<TValues extends Record<string, unknown>>({
  form,
  className,
}: {
  form: AppForm<TValues>;
  className?: string;
}) {
  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        typeof error === "string" && error ? (
          <div
            role="alert"
            className={cn(
              "flex items-start gap-2 rounded-md border border-critical/25 bg-critical/8 px-3 py-2 text-[13px] text-critical",
              className,
            )}
          >
            <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null
      }
    </form.Subscribe>
  );
}

/** Submit button wired to the form's canSubmit/isSubmitting. */
export function SubmitButton<TValues extends Record<string, unknown>>({
  form,
  formId,
  children,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "form" | "type" | "pending"> & {
  form: AppForm<TValues>;
  /** HTML `form` attribute, for submit buttons outside the <form> element. */
  formId?: string;
}) {
  return (
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <Button
          type="submit"
          form={formId}
          pending={isSubmitting}
          disabled={disabled || !canSubmit}
          {...props}
        >
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}
