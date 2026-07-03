import { useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

/** Governance-facing subset of the register's invitable roles. */
const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "committee_member", label: "Committee member" },
  { value: "chair", label: "Chair" },
  { value: "secretary", label: "Secretary" },
  { value: "treasurer", label: "Treasurer" },
] as const;

type InviteRole = (typeof ROLE_OPTIONS)[number]["value"];

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  role: z.enum(["owner", "committee_member", "chair", "secretary", "treasurer"]),
});

interface SentInvite {
  email: string;
  role: InviteRole;
}

export function InviteStep({
  schemeId,
  onFinish,
  onBack,
}: {
  schemeId: string;
  onFinish: () => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [sent, setSent] = useState<SentInvite[]>([]);

  const form = useAppForm({
    schema: inviteSchema,
    defaultValues: { email: "", role: "owner" as InviteRole },
    onSubmit: async ({ email, role }) => {
      // The invite endpoint works off a person record, so create the person
      // first, then send their invite — both persisted server-side.
      const { person } = await unwrap<{ person: { id: string } }>(
        await api.schemes[":schemeId"].people.$post({
          param: { schemeId },
          json: { email },
        }),
      );
      await unwrap(
        await api.schemes[":schemeId"].people[":personId"].invite.$post({
          param: { schemeId, personId: person.id },
          json: { role },
        }),
      );
      setSent((prev) => [...prev, { email, role }]);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
    },
  });

  const roleLabel = (role: InviteRole) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-medium tracking-tight md:text-[1.75rem]">
          Invite your committee & owners
        </h1>
        <p className="text-sm text-muted-foreground">
          Send an invite and each person gets a secure link to join. You can always do this later
          from the People register — no need to add everyone now.
        </p>
      </div>

      <form
        id="onboarding-invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <form.Field name="email">
            {(field) => (
              <Field
                label="Email address"
                htmlFor="invite-email"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="off"
                  inputMode="email"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="role">
            {(field) => (
              <Field label="Role" htmlFor="invite-role" error={fieldError(field.state.meta.errors)}>
                {(control) => (
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as InviteRole)}
                  >
                    <SelectTrigger
                      id={control.id}
                      aria-invalid={control["aria-invalid"]}
                      aria-describedby={control["aria-describedby"]}
                      className="w-full sm:w-44"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
        </div>

        <FormError form={form} />

        <div>
          <SubmitButton form={form} formId="onboarding-invite-form" variant="outline">
            <Mail className="size-4" /> Send invite
          </SubmitButton>
        </div>
      </form>

      {sent.length > 0 && (
        <ul className="space-y-2">
          {sent.map((invite) => (
            <li
              key={invite.email}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-xs"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
              >
                {invite.email[0]?.toUpperCase() ?? "?"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{invite.email}</p>
                <p className="text-xs text-muted-foreground">{roleLabel(invite.role)}</p>
              </div>
              <StatusBadge status="invited" />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="button" size="lg" onClick={onFinish}>
          {sent.length > 0 ? "Finish setup" : "I'll do this later"}
        </Button>
      </div>
    </div>
  );
}
