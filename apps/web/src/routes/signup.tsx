import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, MapPin, Sparkles } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  return (
    <AuthShell
      heading={
        <div className="flex flex-col gap-2">
          <h1 className="page-title text-balance">
            Create your account
          </h1>
          <p className="text-balance text-sm text-muted-foreground">
            Set up your owners corporation in minutes. The agents handle the admin — you stay in
            charge of every decision.
          </p>
        </div>
      }
    >
      <SignUpForm />

      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-13 text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
          Free forever
        </li>
        <li className="flex items-center gap-1.5">
          <GitBranch className="size-3.5 text-primary" aria-hidden="true" />
          Open source
        </li>
        <li className="flex items-center gap-1.5">
          <MapPin className="size-3.5 text-primary" aria-hidden="true" />
          Your data stays in Australia
        </li>
      </ul>
    </AuthShell>
  );
}
