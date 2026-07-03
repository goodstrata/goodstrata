import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PasswordStrength } from "@/components/auth/password-strength";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signUp } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

/** sessionStorage key the onboarding wizard (routes/index.tsx) reads to prefill the scheme name. */
export const ONBOARDING_BUILDING_KEY = "goodstrata:onboarding:buildingName";

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  buildingName: z.string().optional(),
  consent: z.boolean().refine((v) => v === true, {
    error: "Please accept the Terms and Privacy Policy to continue.",
  }),
});

export function SignUpForm() {
  // Set once the account exists but isn't signed in — i.e. verification is
  // required. See onSubmit for how we tell the two cases apart.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const form = useAppForm({
    schema: signUpSchema,
    defaultValues: { name: "", email: "", password: "", buildingName: "", consent: false },
    onSubmit: async ({ name, email, password, buildingName }) => {
      const result = await signUp.email({ email, password, name: name.trim() });
      if (result.error) {
        throw new Error(result.error.message ?? "Couldn't create your account. Try again.");
      }
      // Prime the onboarding wizard without touching the signup API contract.
      const building = buildingName?.trim();
      if (building) sessionStorage.setItem(ONBOARDING_BUILDING_KEY, building);

      // Detection (no API change, no config leak): with
      // requireEmailVerification on, better-auth withholds the session and
      // returns { token: null } — so a truthy token means we're actually
      // signed in (local/dev) and can go straight to the app. A null token
      // means "verify first".
      if (result.data?.token) {
        window.location.href = "/";
      } else {
        setPendingEmail(email);
      }
    },
  });

  if (pendingEmail) {
    return <VerifyEmailNotice email={pendingEmail} onStartOver={() => setPendingEmail(null)} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Create your account</CardTitle>
        <CardDescription>Set up GoodStrata for your owners corporation.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <form.Field name="name">
            {(field) => (
              <Field
                label="Name"
                htmlFor="signup-name"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  placeholder="Your name"
                  autoComplete="name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="email">
            {(field) => (
              <Field
                label="Email"
                htmlFor="signup-email"
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
          <form.Field name="password">
            {(field) => (
              <Field
                label="Password"
                htmlFor="signup-password"
                required
                error={fieldError(field.state.meta.errors)}
                hint={!field.state.value ? "At least 8 characters." : undefined}
              >
                <Input
                  placeholder="Choose a password"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.values.password}>
            {(password) => <PasswordStrength password={password} />}
          </form.Subscribe>
          <form.Field name="buildingName">
            {(field) => (
              <Field
                label="Building name"
                htmlFor="signup-building"
                hint="Optional — we'll use it to set up your first scheme."
              >
                <Input
                  placeholder="e.g. 48 Rose St, Fitzroy"
                  autoComplete="off"
                  value={field.state.value ?? ""}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="consent">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-start gap-2.5 text-13 text-muted-foreground">
                  <input
                    type="checkbox"
                    id="signup-consent"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={field.state.value}
                    aria-invalid={fieldError(field.state.meta.errors) ? true : undefined}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    onBlur={field.handleBlur}
                  />
                  <span>
                    I agree to the{" "}
                    <a
                      href="https://goodstrata.com.au/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Terms
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://goodstrata.com.au/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
                {fieldError(field.state.meta.errors) && (
                  <p className="text-13 text-critical">{fieldError(field.state.meta.errors)}</p>
                )}
              </div>
            )}
          </form.Field>
          <FormError form={form} />
          <form.Subscribe selector={(s) => s.values.consent}>
            {(consent) => (
              <SubmitButton form={form} disabled={!consent} className="w-full">
                Create account
              </SubmitButton>
            )}
          </form.Subscribe>
        </form>
        <div className="mt-3">
          <Button asChild variant="link" className="h-auto p-0 text-sm">
            <Link to="/login">Already have an account? Sign in</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
