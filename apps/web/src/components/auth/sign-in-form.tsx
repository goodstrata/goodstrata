import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export function SignInForm() {
  // Set when the account exists but its email isn't verified yet (403 from
  // better-auth). We surface the same "check your email" screen as signup so
  // the user can resend rather than hit a dead end.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const form = useAppForm({
    schema: signInSchema,
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ email, password }) => {
      const result = await signIn.email({ email, password });
      if (result.error) {
        // 403 EMAIL_NOT_VERIFIED: not a failure the user can fix by retrying —
        // route them to verification instead of showing a red banner.
        if (result.error.status === 403) {
          setPendingEmail(email);
          return;
        }
        throw new Error(
          result.error.message ?? "Couldn't sign you in. Check your details and try again.",
        );
      }
      // Full navigation: the session store re-initialises from the cookie, so
      // the home page can't race a stale null session back to /login.
      window.location.href = "/";
    },
  });

  if (pendingEmail) {
    return <VerifyEmailNotice email={pendingEmail} onStartOver={() => setPendingEmail(null)} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sign in</CardTitle>
        <CardDescription>Welcome back to your owners corporation.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Renders only when this deployment has Google configured. Same
            post-login landing as the email flow (full navigation to "/"). */}
        <SocialSignIn callbackURL="/" />
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
                htmlFor="signin-email"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  placeholder="you@example.com"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  enterKeyHint="next"
                  spellCheck={false}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <Field
                label="Password"
                htmlFor="signin-password"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  placeholder="Your password"
                  type="password"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <FormError form={form} />
          <SubmitButton form={form} className="w-full">
            Sign in
          </SubmitButton>
        </form>
        <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <Button asChild variant="link" className="h-auto p-0 text-sm">
            <Link to="/signup">New here? Create an account</Link>
          </Button>
          <Link
            to="/forgot-password"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
