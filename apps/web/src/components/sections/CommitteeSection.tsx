import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { useIsOfficer } from "@/lib/roles";

const ROLES = ["chair", "secretary", "treasurer", "committee_member"] as const;
type RoleValue = (typeof ROLES)[number];

const assignSchema = z.object({
  userId: z.string().min(1, "Select a member to assign."),
  role: z.enum(ROLES),
});
type AssignValues = z.infer<typeof assignSchema>;

export function CommitteeSection({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const {
    data: committee,
    isError: committeeError,
    error: committeeErr,
    refetch: refetchCommittee,
  } = useQuery({
    queryKey: ["committee", schemeId],
    queryFn: async () =>
      unwrap<{ committee: { userId: string; role: string }[] }>(
        await api.schemes[":schemeId"].committee.$get({ param: { schemeId } }),
      ),
  });
  const { data: members } = useQuery({
    queryKey: ["members", schemeId],
    queryFn: async () =>
      unwrap<{ members: { userId: string; name: string; email: string }[] }>(
        await api.schemes[":schemeId"].members.$get({ param: { schemeId } }),
      ),
  });

  const formRef = useRef<{ reset: () => void } | null>(null);
  const form = useAppForm<AssignValues>({
    schema: assignSchema,
    defaultValues: { userId: "", role: "chair" },
    onSubmit: async ({ userId, role }) => {
      await unwrap(
        await api.schemes[":schemeId"].committee.$post({
          param: { schemeId },
          json: { userId, role },
        }),
      );
      toast.success("Committee role assigned");
      void queryClient.invalidateQueries({ queryKey: ["committee", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["members", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
      formRef.current?.reset();
    },
  });
  formRef.current = form;

  const nameFor = (id: string) => members?.members.find((m) => m.userId === id)?.name ?? id;
  // One row per person, with all of their office-holder roles.
  const officers = new Map<string, string[]>();
  for (const m of committee?.committee ?? []) {
    if (m.role === "owner" || m.role === "tenant") continue;
    officers.set(m.userId, [...(officers.get(m.userId) ?? []), m.role]);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current committee</CardTitle>
          <CardDescription>Office holders for this owners corporation.</CardDescription>
        </CardHeader>
        <CardContent>
          {committeeError ? (
            <ErrorState
              message={
                committeeErr instanceof Error
                  ? committeeErr.message
                  : "Couldn't load the committee."
              }
              onRetry={() => void refetchCommittee()}
            />
          ) : !committee ? (
            <Skeleton className="h-20" />
          ) : (
            <ul className="space-y-2.5 text-sm" data-testid="committee-list">
              {officers.size === 0 ? (
                <li className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-center">
                  <User aria-hidden="true" className="size-5 text-muted-foreground" />
                  <span className="font-medium">No office holders yet</span>
                  <span className="text-muted-foreground">
                    {isOfficer
                      ? "Assign a member below to record the committee."
                      : "Office holders will appear here once assigned."}
                  </span>
                </li>
              ) : (
                [...officers].map(([memberId, roles]) => (
                  <li key={memberId} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{nameFor(memberId)}</span>
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {roles.map((r) => (
                        <Badge key={r} tone="info">
                          {r.replace("_", " ")}
                        </Badge>
                      ))}
                    </span>
                  </li>
                ))
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {isOfficer && (
        <Card>
          <CardHeader>
            <CardTitle>Assign role</CardTitle>
            <CardDescription>Appoint a member as an office holder.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <form.Field name="userId">
                  {(field) => (
                    <Field
                      className="flex-1"
                      label="Member"
                      error={fieldError(field.state.meta.errors)}
                    >
                      {(control) => (
                        <Select
                          value={field.state.value}
                          onValueChange={(v) => field.handleChange(v)}
                        >
                          <SelectTrigger
                            id={control.id}
                            aria-invalid={control["aria-invalid"]}
                            aria-describedby={control["aria-describedby"]}
                            className="w-full"
                            data-testid="committee-member"
                          >
                            <SelectValue placeholder="Select member…" />
                          </SelectTrigger>
                          <SelectContent>
                            {members?.members.map((m) => (
                              <SelectItem key={m.userId} value={m.userId}>
                                {m.name} ({m.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  )}
                </form.Field>
                <form.Field name="role">
                  {(field) => (
                    <Field
                      className="sm:w-48"
                      label="Role"
                      error={fieldError(field.state.meta.errors)}
                    >
                      {(control) => (
                        <Select
                          value={field.state.value}
                          onValueChange={(v) => field.handleChange(v as RoleValue)}
                        >
                          <SelectTrigger
                            id={control.id}
                            aria-invalid={control["aria-invalid"]}
                            aria-describedby={control["aria-describedby"]}
                            className="w-full"
                            data-testid="committee-role"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="chair">Chair</SelectItem>
                            <SelectItem value="secretary">Secretary</SelectItem>
                            <SelectItem value="treasurer">Treasurer</SelectItem>
                            <SelectItem value="committee_member">Committee member</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  )}
                </form.Field>
              </div>
              <FormError form={form} className="mt-3" />
              <div className="mt-4">
                <SubmitButton form={form}>Assign</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
