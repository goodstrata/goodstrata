import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Laptop, LogOut, Mail, Monitor, Smartphone, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { GoogleMark, useAuthPageInfo } from "@/components/auth/social-sign-in";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  changePassword,
  deleteUser,
  linkSocial,
  listAccounts,
  listSessions,
  requestPasswordReset,
  revokeOtherSessions,
  revokeSession,
  signOut,
  unlinkAccount,
  useSession,
} from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

interface SettingsUser {
  id: string;
  name: string;
  email: string;
}

interface LinkedAccount {
  id: string;
  /** better-auth provider id — "credential" is email/password. */
  providerId: string;
}

/**
 * The user's linked auth methods. Shared (same query key) between the
 * password, connected-accounts and delete cards so each can adapt to
 * whether a password ("credential" account) exists.
 */
function useLinkedAccounts() {
  return useQuery({
    queryKey: ["settings-accounts"],
    queryFn: async () => {
      const res = await listAccounts();
      if (res.error) throw new Error(res.error.message ?? "Couldn't load connected accounts");
      return (res.data ?? []) as LinkedAccount[];
    },
  });
}

interface SessionRow {
  id: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function SecuritySection({ user }: { user: SettingsUser }) {
  return (
    <div className="space-y-6">
      <PasswordCard user={user} />
      <ConnectedAccountsCard />
      <SessionsCard />
      <DangerCard user={user} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Change password                                                            */
/* -------------------------------------------------------------------------- */

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string().min(1, "Re-enter the new password."),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ["confirm"],
    message: "Passwords don't match.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you haven't used here.",
  });

/**
 * Adapts to how the account authenticates: users with a password get the
 * change form; social-only users (e.g. signed up with Google) get an emailed
 * link to set one — asking them for a "current password" would dead-end.
 */
function PasswordCard({ user }: { user: SettingsUser }) {
  const accounts = useLinkedAccounts();

  if (accounts.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Checking how you sign in…</CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  const hasPassword =
    !accounts.isSuccess || accounts.data.some((a) => a.providerId === "credential");
  // On error we fall back to the change form — it's the safe default and
  // better-auth still enforces the current password server-side.
  return hasPassword ? <ChangePasswordCard /> : <SetPasswordCard email={user.email} />;
}

function SetPasswordCard({ email }: { email: string }) {
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: async () => {
      const res = await requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't send the email");
    },
    onSuccess: () => setSent(true),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send the email"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          This account has no password yet — you sign in another way, such as with Google.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Setting a password adds a second way in, and lets you disconnect Google later without
          locking yourself out.
        </p>
        {sent ? (
          <Alert tone="info">
            <Mail aria-hidden="true" />
            <AlertTitle>Check your inbox</AlertTitle>
            <AlertDescription>
              We've emailed <span className="font-medium text-foreground">{email}</span> a link to
              set your password. It expires shortly — request another if it lapses.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="border-t">
        <Button
          type="button"
          variant="outline"
          pending={send.isPending}
          onClick={() => send.mutate()}
        >
          <KeyRound className="size-4" aria-hidden="true" />
          {sent ? "Resend the link" : "Email me a link to set one"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ChangePasswordCard() {
  const queryClient = useQueryClient();
  const form = useAppForm({
    schema: passwordSchema,
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
    onSubmit: async ({ currentPassword, newPassword }) => {
      const res = await changePassword({
        currentPassword,
        newPassword,
        // Rotate everyone else out — a password change should end other devices.
        revokeOtherSessions: true,
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't change your password");
      toast.success("Password changed. Other devices were signed out.");
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ["settings-sessions"] });
    },
  });

  return (
    <Card>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Change it here. We'll sign out your other devices as a precaution.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm space-y-4">
          <form.Field name="currentPassword">
            {(field) => (
              <Field
                label="Current password"
                htmlFor="current-password"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  enterKeyHint="next"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="newPassword">
            {(field) => (
              <Field
                label="New password"
                htmlFor="new-password"
                required
                hint="At least 8 characters."
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  enterKeyHint="next"
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
                htmlFor="confirm-password"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  enterKeyHint="done"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <FormError form={form} />
        </CardContent>
        <CardFooter className="border-t">
          <SubmitButton form={form}>Change password</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Connected accounts                                                         */
/* -------------------------------------------------------------------------- */

function ConnectedAccountsCard() {
  const queryClient = useQueryClient();
  // Runtime capability: which social providers this deployment has configured.
  const { data: info } = useAuthPageInfo();

  const { data, isPending, isError, error, refetch } = useLinkedAccounts();

  const link = useMutation({
    mutationFn: async () => {
      const res = await linkSocial({ provider: "google", callbackURL: "/settings" });
      if (res.error) throw new Error(res.error.message ?? "Couldn't connect Google");
      // Success means the browser is redirecting to Google; the mutation stays
      // pending until navigation happens so the button can't be re-clicked.
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't connect Google"),
  });

  const unlink = useMutation({
    mutationFn: async () => {
      const res = await unlinkAccount({ providerId: "google" });
      if (res.error) throw new Error(res.error.message ?? "Couldn't disconnect Google");
    },
    onSuccess: () => {
      toast.success("Google disconnected");
      void queryClient.invalidateQueries({ queryKey: ["settings-accounts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't disconnect Google"),
  });

  const accounts = data ?? [];
  const googleConfigured = Boolean(info?.socialProviders?.includes("google"));
  const googleLinked = accounts.some((a) => a.providerId === "google");
  // Disconnecting your only sign-in method would lock you out — better-auth
  // refuses server-side; we grey the button and explain instead.
  const hasOtherMethod = accounts.some((a) => a.providerId !== "google");

  // Nothing to offer: deployment has no Google configured and nothing linked
  // (a linked account still shows so it can be disconnected after the
  // credentials are removed from the deployment).
  if (!googleConfigured && !googleLinked) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>Other ways to sign in to this account.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        ) : isError ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Couldn't load connected accounts."}
            onRetry={() => void refetch()}
          />
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <GoogleMark className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Google</span>
                {googleLinked ? (
                  <Badge tone="positive" className="shrink-0">
                    Connected
                  </Badge>
                ) : null}
              </div>
              <p className="text-13 text-muted-foreground">
                {googleLinked
                  ? hasOtherMethod
                    ? "You can sign in with your Google account."
                    : "Your only sign-in method. Set a password before disconnecting."
                  : "Sign in with one click using your Google account."}
              </p>
            </div>
            {googleLinked ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!hasOtherMethod}
                pending={unlink.isPending}
                onClick={() => unlink.mutate()}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                pending={link.isPending}
                onClick={() => link.mutate()}
              >
                Connect
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Active sessions                                                            */
/* -------------------------------------------------------------------------- */

function describeAgent(ua: string | null | undefined): { label: string; icon: typeof Monitor } {
  if (!ua) return { label: "Unknown device", icon: Monitor };
  const browser = /Edg/.test(ua)
    ? "Edge"
    : /OPR|Opera/.test(ua)
      ? "Opera"
      : /Chrome/.test(ua)
        ? "Chrome"
        : /Firefox/.test(ua)
          ? "Firefox"
          : /Safari/.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iPhone|iPad|iOS/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  const mobile = /iPhone|Android|Mobile/.test(ua);
  const icon = mobile ? Smartphone : /Macintosh|Windows|Linux/.test(ua) ? Laptop : Monitor;
  return { label: os ? `${browser} on ${os}` : browser, icon };
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentToken = session?.session.token;

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["settings-sessions"],
    queryFn: async () => {
      const res = await listSessions();
      if (res.error) throw new Error(res.error.message ?? "Couldn't load sessions");
      return (res.data ?? []) as unknown as SessionRow[];
    },
  });

  const revokeOne = useMutation({
    mutationFn: async (token: string) => {
      const res = await revokeSession({ token });
      if (res.error) throw new Error(res.error.message ?? "Couldn't revoke session");
    },
    onSuccess: () => {
      toast.success("Signed out that device");
      void queryClient.invalidateQueries({ queryKey: ["settings-sessions"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't revoke session"),
  });

  const revokeRest = useMutation({
    mutationFn: async () => {
      const res = await revokeOtherSessions();
      if (res.error) throw new Error(res.error.message ?? "Couldn't sign out other devices");
    },
    onSuccess: () => {
      toast.success("Signed out everywhere else");
      void queryClient.invalidateQueries({ queryKey: ["settings-sessions"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't sign out other devices"),
  });

  const sessions = data ?? [];
  const others = sessions.filter((s) => s.token !== currentToken);
  // Current session first, then most-recently-active.
  const ordered = [...sessions].sort((a, b) => {
    if (a.token === currentToken) return -1;
    if (b.token === currentToken) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Where you're signed in. Revoke anything you don't recognise.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Couldn't load your sessions."}
            onRetry={() => void refetch()}
          />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={Monitor}
            title="No active sessions"
            description="Signed-in devices and browsers will appear here — sign in elsewhere to see a session listed."
          />
        ) : (
          <ul className="divide-y">
            {ordered.map((s) => {
              const { label, icon: Icon } = describeAgent(s.userAgent);
              const isCurrent = s.token === currentToken;
              return (
                <li
                  key={s.id}
                  title={`Signed in ${new Date(s.createdAt).toLocaleString()} · Expires ${new Date(s.expiresAt).toLocaleString()}`}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{label}</span>
                      {isCurrent ? (
                        <Badge tone="positive" className="shrink-0">
                          This device
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-13 text-muted-foreground">
                      {s.ipAddress ? `${s.ipAddress} · ` : ""}Active {relativeTime(s.updatedAt)}
                    </p>
                  </div>
                  {isCurrent ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      pending={revokeOne.isPending && revokeOne.variables === s.token}
                      onClick={() => revokeOne.mutate(s.token)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {others.length > 0 ? (
        <CardFooter className="border-t">
          <Button
            type="button"
            variant="outline"
            pending={revokeRest.isPending}
            onClick={() => revokeRest.mutate()}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out everywhere else
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete account                                                             */
/* -------------------------------------------------------------------------- */

function DangerCard({ user }: { user: SettingsUser }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");

  // Social-only accounts have no password to confirm with; better-auth then
  // requires a recent sign-in instead, which we surface in the error mapping.
  const accounts = useLinkedAccounts();
  const hasPassword =
    !accounts.isSuccess || accounts.data.some((a) => a.providerId === "credential");

  const del = useMutation({
    mutationFn: async () => {
      const res = await deleteUser(hasPassword ? { password } : {});
      if (res.error) throw new Error(res.error.message ?? "Couldn't delete your account");
    },
    onSuccess: async () => {
      toast.success("Account deleted");
      await signOut();
      window.location.href = "/login";
    },
  });

  const deleteError = del.isError
    ? (() => {
        const message =
          del.error instanceof Error ? del.error.message : "Couldn't delete your account";
        return /session.*(expired|fresh)/i.test(message)
          ? "For safety this needs a recent sign-in. Sign out, sign back in, then try again."
          : message;
      })()
    : null;

  const canDelete =
    confirm.trim().toLowerCase() === user.email.toLowerCase() &&
    (!hasPassword || password.length > 0);

  return (
    <Card className="border-critical/30">
      <CardHeader>
        <CardTitle className="text-critical">Delete account</CardTitle>
        <CardDescription>
          Permanently remove your GoodStrata account and sign-in. This can't be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your name will no longer appear against past decisions, votes or messages, and you'll lose
          access to every building you belong to. Records the corporation must keep are retained.
        </p>
      </CardContent>
      <CardFooter className="border-t">
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setConfirm("");
              setPassword("");
              del.reset();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" variant="destructive">
              <TriangleAlert className="size-4" aria-hidden="true" />
              Delete my account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                {hasPassword
                  ? "This permanently deletes your account and cannot be undone. To confirm, type your email address and enter your password."
                  : "This permanently deletes your account and cannot be undone. To confirm, type your email address."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Field
                label={
                  <>
                    Type <span className="font-mono text-foreground">{user.email}</span> to confirm
                  </>
                }
                htmlFor="delete-confirm"
              >
                <Input
                  id="delete-confirm"
                  autoComplete="off"
                  autoCapitalize="none"
                  enterKeyHint={hasPassword ? "next" : "done"}
                  spellCheck={false}
                  value={confirm}
                  onChange={(e) => {
                    del.reset();
                    setConfirm(e.target.value);
                  }}
                />
              </Field>
              {hasPassword ? (
                <Field label="Password" htmlFor="delete-password">
                  <Input
                    id="delete-password"
                    type="password"
                    autoComplete="current-password"
                    enterKeyHint="done"
                    value={password}
                    onChange={(e) => {
                      del.reset();
                      setPassword(e.target.value);
                    }}
                  />
                </Field>
              ) : null}
              {deleteError ? <FormMessage>{deleteError}</FormMessage> : null}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={!canDelete}
                pending={del.isPending}
                onClick={() => del.mutate()}
              >
                Delete account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
