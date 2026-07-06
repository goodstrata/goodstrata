import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useRef } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { signUp, useSession } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: JoinPage,
});

interface InvitePreview {
  schemeName: string;
  role: string;
  email: string;
  /** Set from the invited person record; when present the join form locks it. */
  name: string | null;
}

const joinSchema = z.object({
  name: z.string(),
  password: z.string().min(8, "Use at least 8 characters."),
});

function JoinPage() {
  const { token } = Route.useSearch();
  const { data: session, isPending } = useSession();

  if (!token) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
        <EmptyState
          icon={Building2}
          title="Missing invite token"
          description="This link is incomplete. Open the invite link from your email again, or sign in to your existing account."
          action={
            <Button asChild variant="outline">
              <Link to="/login">Go to sign in</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm space-y-3 md:mt-16">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return session?.user ? <AcceptInvite token={token} /> : <SignupThenAccept token={token} />;
}

function AcceptInvite({ token }: { token: string }) {
  const navigate = useNavigate();
  const accept = useMutation({
    mutationFn: async () =>
      unwrap<{ schemeId: string }>(await api.invites.accept.$post({ json: { token } })),
    onSuccess: (data) =>
      void navigate({ to: "/schemes/$schemeId", params: { schemeId: data.schemeId } }),
  });

  return (
    <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Accept your invite</CardTitle>
          <CardDescription>
            You're signed in — accept to join the owners corporation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {accept.error && <FormMessage>{accept.error.message}</FormMessage>}
          <Button pending={accept.isPending} onClick={() => accept.mutate()}>
            Accept invite
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SignupThenAccept({ token }: { token: string }) {
  const navigate = useNavigate();
  const previewRef = useRef<InvitePreview | undefined>(undefined);

  // Unauthenticated preview via query param (public by design: token IS the secret).
  const {
    data: preview,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async (): Promise<InvitePreview> => {
      const res = await fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("This invite is invalid or has expired.");
      return (await res.json()) as InvitePreview;
    },
    retry: false,
  });
  previewRef.current = preview;

  const form = useAppForm({
    schema: joinSchema,
    defaultValues: { name: "", password: "" },
    onSubmit: async ({ name, password }) => {
      const current = previewRef.current;
      if (!current) throw new Error("This invite is invalid or has expired.");
      const signup = await signUp.email({
        email: current.email,
        password,
        // The invite already carries the person's name; only fall back to the
        // typed field (or the email local-part) when it doesn't.
        name: current.name?.trim() || name.trim() || current.email.split("@")[0]!,
      });
      if (signup.error) throw new Error(signup.error.message ?? "Sign up failed.");
      const data = await unwrap<{ schemeId: string }>(
        await api.invites.accept.$post({ json: { token } }),
      );
      void navigate({ to: "/schemes/$schemeId", params: { schemeId: data.schemeId } });
    },
  });

  if (isError) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
        <ErrorState
          title="Invite unavailable"
          message={
            error instanceof Error ? error.message : "This invite is invalid or has expired."
          }
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (isPending || !preview) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm space-y-3 md:mt-16">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Join {preview.schemeName}</CardTitle>
          <CardDescription>
            You've been invited as{" "}
            <b className="font-medium text-foreground">{preview.role.replace(/_/g, " ")}</b>{" "}
            <span className="break-all">({preview.email})</span>. Create your account to join.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            {preview.name ? (
              <Field label="Name" htmlFor="join-name" hint="Set from your invitation.">
                <Input
                  id="join-name"
                  value={preview.name}
                  readOnly
                  disabled
                  autoComplete="name"
                />
              </Field>
            ) : (
              <form.Field name="name">
                {(field) => (
                  <Field label="Name" htmlFor="join-name">
                    <Input
                      id="join-name"
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
            <form.Field name="password">
              {(field) => (
                <Field
                  label="Password"
                  htmlFor="join-password"
                  required
                  error={fieldError(field.state.meta.errors)}
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
            <FormError form={form} />
            <SubmitButton form={form} className="w-full">
              Create account & join
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
