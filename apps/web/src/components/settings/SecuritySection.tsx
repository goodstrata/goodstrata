import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, LogOut, Monitor, Smartphone, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  changePassword,
  deleteUser,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  signOut,
  useSession,
} from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

interface SettingsUser {
  id: string;
  name: string;
  email: string;
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
      <ChangePasswordCard />
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
                <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
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

  const del = useMutation({
    mutationFn: async () => {
      const res = await deleteUser({ password });
      if (res.error) throw new Error(res.error.message ?? "Couldn't delete your account");
    },
    onSuccess: async () => {
      toast.success("Account deleted");
      await signOut();
      window.location.href = "/login";
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't delete your account"),
  });

  const canDelete =
    confirm.trim().toLowerCase() === user.email.toLowerCase() && password.length > 0;

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
                This permanently deletes your account and cannot be undone. To confirm, type your
                email address and enter your password.
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
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <Field label="Password" htmlFor="delete-password">
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
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
