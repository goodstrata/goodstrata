import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, CircleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { signIn, signUp } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

interface DemoInfo {
  demo: boolean;
  accounts: { label: string; email: string; password: string }[];
}

const authSchema = z.object({
  name: z.string(),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [entering, setEntering] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const { data: demoInfo } = useQuery({
    queryKey: ["demo-info"],
    queryFn: async () => (await fetch("/api/demo-info")).json() as Promise<DemoInfo>,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const form = useAppForm({
    schema: authSchema,
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: async ({ name, email, password }) => {
      const result =
        modeRef.current === "signin"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name: name || email.split("@")[0]! });
      if (result.error) {
        throw new Error(result.error.message ?? "Something went wrong. Try again.");
      }
      // Full navigation: the session store re-initialises from the cookie, so
      // the home page can't race a stale null session back to /login.
      window.location.href = "/";
    },
  });

  async function enterDemo(account: { label: string; email: string; password: string }) {
    setEntering(account.email);
    setDemoError(null);
    try {
      const result = await signIn.email({ email: account.email, password: account.password });
      if (result.error) {
        setDemoError(result.error.message ?? "Demo sign-in failed.");
        setEntering(null);
        return;
      }
      window.location.href = "/";
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Demo sign-in failed.");
      setEntering(null);
    }
  }

  const hasDemo = Boolean(demoInfo?.demo && demoInfo.accounts.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-2 md:py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <img
          src="/logo-on-light.svg"
          alt=""
          aria-hidden="true"
          className="h-8 w-auto dark:hidden"
        />
        <img
          src="/logo-on-dark.svg"
          alt=""
          aria-hidden="true"
          className="hidden h-8 w-auto dark:block"
        />
        <h1 className="text-balance font-display text-2xl font-medium tracking-tight md:text-[1.75rem]">
          The building runs itself. You stay in charge.
        </h1>
      </div>

      {hasDemo && (
        <Card className="border-primary/20 bg-accent/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-5 text-primary" aria-hidden="true" />
              Explore the demo building
            </CardTitle>
            <CardDescription>
              48 Rose St, Fitzroy — 12 lots, live agents, resets itself. Jump in as:
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {demoError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-critical/25 bg-critical/8 px-3 py-2 text-[13px] text-critical"
              >
                <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{demoError}</span>
              </div>
            )}
            {demoInfo?.accounts.map((account) => (
              <Button
                key={account.email}
                size="lg"
                pending={entering === account.email}
                disabled={entering !== null}
                onClick={() => void enterDemo(account)}
              >
                Enter as {account.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {hasDemo && (
        <div className="relative">
          <Separator />
          <span className="absolute inset-x-0 -top-2.5 mx-auto w-fit bg-background px-3 text-xs text-muted-foreground">
            or use a regular account
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Welcome back to your owners corporation."
              : "Set up your GoodStrata account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            {mode === "signup" && (
              <form.Field name="name">
                {(field) => (
                  <Field label="Name" htmlFor="login-name">
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
            )}
            <form.Field name="email">
              {(field) => (
                <Field
                  label="Email"
                  htmlFor="login-email"
                  required
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    placeholder="Email"
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
                  htmlFor="login-password"
                  required
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    placeholder="Password"
                    type="password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
            <FormError form={form} />
            <SubmitButton form={form} className="w-full">
              {mode === "signin" ? "Sign in" : "Sign up"}
            </SubmitButton>
          </form>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
            </Button>
            {mode === "signin" && (
              <Link
                to="/forgot-password"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
