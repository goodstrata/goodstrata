import { createFileRoute, Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

const schema = z.object({ email: z.email("Enter a valid email address.") });

function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const form = useAppForm({
    schema,
    defaultValues: { email: "" },
    onSubmit: async ({ email }) => {
      const result = await requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Couldn't send the reset email. Try again.");
      }
      setSent(true);
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-2 md:py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reset your password</CardTitle>
          <CardDescription>
            {sent
              ? "Check your inbox."
              : "Enter your email and we'll send you a link to set a new password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="flex items-start gap-2 rounded-md border border-primary/20 bg-accent/40 px-3 py-2.5 text-sm text-accent-foreground">
                <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  If an account exists for that address, a reset link is on its way. The link
                  expires shortly.
                </span>
              </p>
              <Link to="/login" className="text-sm text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void form.handleSubmit();
                }}
                className="flex flex-col gap-4"
              >
                <form.Field name="email">
                  {(field) => (
                    <Field
                      label="Email"
                      htmlFor="forgot-email"
                      required
                      error={fieldError(field.state.meta.errors)}
                    >
                      <Input
                        placeholder="you@example.com"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    </Field>
                  )}
                </form.Field>
                <FormError form={form} />
                <SubmitButton form={form} className="w-full">
                  Send reset link
                </SubmitButton>
              </form>
              <Link
                to="/login"
                className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground"
              >
                Back to sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
