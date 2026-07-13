import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mail, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { unwrap } from "@/lib/api";
import { changeEmail, sendVerificationEmail, updateUser, useSession } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

interface SettingsUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  emailVerified: boolean;
}

function initials(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const nameSchema = z.object({
  name: z.string().trim().min(1, "Enter a display name.").max(80, "Keep it under 80 characters."),
});

const emailSchema = z.object({
  email: z.email("Enter a valid email address."),
});

export function ProfileSection({ user }: { user: SettingsUser }) {
  const { refetch } = useSession();

  return (
    <div className="space-y-6">
      <AvatarCard user={user} onChange={() => void refetch()} />
      <DisplayNameCard user={user} onSaved={() => void refetch()} />
      <EmailCard user={user} onSent={() => void refetch()} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

function AvatarCard({ user, onChange }: { user: SettingsUser; onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Object URLs hold the file in memory until revoked.
  const clearPreview = () =>
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return unwrap<{ image: string }>(
        await fetch("/api/profile/avatar", {
          method: "POST",
          body: form,
          credentials: "include",
        }),
      );
    },
    onSuccess: () => {
      toast.success("Photo updated");
      if (fileRef.current) fileRef.current.value = "";
      clearPreview();
      onChange();
    },
    onError: (e) => {
      clearPreview();
      toast.error(e instanceof Error ? e.message : "Upload failed");
    },
  });

  const remove = useMutation({
    // Server route clears user.image and deletes the stored file.
    mutationFn: async () =>
      unwrap<{ ok: boolean }>(
        await fetch("/api/profile/avatar", {
          method: "DELETE",
          credentials: "include",
        }),
      ),
    onSuccess: () => {
      toast.success("Photo removed");
      onChange();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove photo"),
  });

  function onPick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Keep images under 5 MB.");
      return;
    }
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    upload.mutate(file);
  }

  const shown = preview ?? user.image ?? undefined;
  const busy = upload.isPending || remove.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile photo</CardTitle>
        <CardDescription>
          Shown on your account and beside your name across the register.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative">
            <Avatar className="size-20 border">
              {shown ? <AvatarImage src={shown} alt="" /> : null}
              <AvatarFallback className="bg-accent text-xl font-semibold text-accent-foreground">
                {initials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
            {busy ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <Upload className="size-4" aria-hidden="true" />
                {user.image ? "Replace" : "Upload"}
              </button>
              {user.image ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove.mutate()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove
                </button>
              ) : null}
            </div>
            <p className="text-13 text-muted-foreground">PNG, JPEG, WebP or GIF, up to 5 MB.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Display name                                                               */
/* -------------------------------------------------------------------------- */

function DisplayNameCard({ user, onSaved }: { user: SettingsUser; onSaved: () => void }) {
  const form = useAppForm({
    schema: nameSchema,
    defaultValues: { name: user.name },
    onSubmit: async ({ name }) => {
      const res = await updateUser({ name: name.trim() });
      if (res.error) throw new Error(res.error.message ?? "Couldn't save your name");
      toast.success("Name saved");
      onSaved();
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
          <CardTitle>Display name</CardTitle>
          <CardDescription>The name people see on decisions, minutes and messages.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form.Field name="name">
            {(field) => (
              <Field
                label="Name"
                htmlFor="settings-name"
                required
                error={fieldError(field.state.meta.errors)}
                className="max-w-sm"
              >
                <Input
                  autoComplete="name"
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
          <form.Subscribe selector={(s) => s.values.name}>
            {(name) => (
              <SubmitButton form={form} disabled={name.trim() === user.name.trim()}>
                Save name
              </SubmitButton>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Email                                                                      */
/* -------------------------------------------------------------------------- */

function EmailCard({ user, onSent }: { user: SettingsUser; onSent: () => void }) {
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const resend = useMutation({
    mutationFn: async () => {
      const res = await sendVerificationEmail({ email: user.email, callbackURL: "/settings" });
      if (res.error) throw new Error(res.error.message ?? "Couldn't send email");
    },
    onSuccess: () => toast.success("Verification email sent"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send email"),
  });

  const form = useAppForm({
    schema: emailSchema,
    defaultValues: { email: "" },
    onSubmit: async ({ email }) => {
      const next = email.trim().toLowerCase();
      if (next === user.email.toLowerCase()) {
        throw new Error("That's already your email address.");
      }
      const res = await changeEmail({ newEmail: next, callbackURL: "/settings" });
      if (res.error) throw new Error(res.error.message ?? "Couldn't start the change");
      setPendingEmail(next);
      form.reset();
      onSent();
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
          <CardTitle>Email address</CardTitle>
          <CardDescription>
            Used to sign in and to reach you. Changes need confirmation from a link we email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">{user.email}</span>
            {user.emailVerified ? (
              <Badge tone="positive" className="gap-1">
                <CheckCircle2 className="size-3" aria-hidden="true" /> Verified
              </Badge>
            ) : (
              <Badge tone="caution" className="gap-1">
                <ShieldAlert className="size-3" aria-hidden="true" /> Unverified
              </Badge>
            )}
            {!user.emailVerified ? (
              <button
                type="button"
                disabled={resend.isPending}
                onClick={() => resend.mutate()}
                className="ml-auto text-13 font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
              >
                Resend verification
              </button>
            ) : null}
          </div>

          {pendingEmail ? (
            <Alert tone="info">
              <Mail aria-hidden="true" />
              <AlertTitle>Confirm your new address</AlertTitle>
              <AlertDescription>
                We've emailed a confirmation link for{" "}
                <span className="font-medium text-foreground">{pendingEmail}</span>. Your address
                changes once you follow it — until then, keep using {user.email}.
              </AlertDescription>
            </Alert>
          ) : null}

          <form.Field name="email">
            {(field) => (
              <Field
                label="New email"
                htmlFor="settings-email"
                error={fieldError(field.state.meta.errors)}
                className="max-w-sm"
              >
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  enterKeyHint="send"
                  spellCheck={false}
                  placeholder="you@example.com"
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
          <SubmitButton form={form}>Send confirmation</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}
