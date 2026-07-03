import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

// better-auth appends ?token=... (and ?error=... on an invalid/expired link).
const search = z.object({
  token: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: search,
  component: ResetPasswordPage,
});

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match.",
    path: ["confirm"],
  });

function ResetPasswordPage() {
  const { token, error } = Route.useSearch();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  const form = useAppForm({
    schema,
    defaultValues: { password: "", confirm: "" },
    onSubmit: async ({ password }) => {
      if (!token) throw new Error("This reset link is invalid. Request a new one.");
      const result = await resetPassword({ newPassword: password, token });
      if (result.error) {
        throw new Error(result.error.message ?? "Couldn't reset your password. Try again.");
      }
      setDone(true);
      setTimeout(() => void navigate({ to: "/login" }), 1400);
    },
  });

  if (error || !token) {
    return (
      <div className="mx-auto w-full max-w-sm py-2 md:py-10">
        <EmptyState
          title="This link has expired"
          description="Password reset links are single-use and time-limited. Request a fresh one to continue."
          action={
            <Link
              to="/forgot-password"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Request a new link
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-2 md:py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Set a new password</CardTitle>
          <CardDescription>
            {done
              ? "Password updated — taking you to sign in…"
              : "Choose a new password for your account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <form.Field name="password">
              {(field) => (
                <Field
                  label="New password"
                  htmlFor="reset-password"
                  required
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="confirm">
              {(field) => (
                <Field
                  label="Confirm new password"
                  htmlFor="reset-confirm"
                  required
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
            <FormError form={form} />
            <SubmitButton form={form} className="w-full" disabled={done}>
              Update password
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
