import { createFileRoute } from "@tanstack/react-router";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  return (
    <AuthShell
      heading={
        <div className="flex flex-col gap-3">
          <h1 className="page-title text-balance lg:text-4xl">Create your account</h1>
          <p className="text-balance text-muted-foreground">
            Set up your owners corporation in minutes. The agents handle the admin. You stay in
            charge of every decision.
          </p>
        </div>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
