import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const [electionMeetingId, setElectionMeetingId] = useState("");
  const [electedUserIds, setElectedUserIds] = useState<string[]>([]);
  const [expansionMotionId, setExpansionMotionId] = useState("");
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
  const { data: meetings } = useQuery({
    queryKey: ["meetings", schemeId],
    queryFn: async () =>
      unwrap<{
        meetings: {
          id: string;
          title: string;
          kind: string;
          status: string;
          scheduledAt: string;
        }[];
      }>(await api.schemes[":schemeId"].meetings.$get({ param: { schemeId } })),
    enabled: isOfficer,
  });

  const recordElection = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].committee.elections.$post({
          param: { schemeId },
          json: {
            meetingId: electionMeetingId,
            electedUserIds,
            ...(electedUserIds.length > 7 && expansionMotionId.trim()
              ? { expansionMotionId: expansionMotionId.trim() }
              : {}),
          },
        }),
      ),
    onSuccess: () => {
      toast.success("AGM committee election recorded");
      setElectionMeetingId("");
      setElectedUserIds([]);
      setExpansionMotionId("");
      void queryClient.invalidateQueries({ queryKey: ["committee", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
    },
    onError: (error) => toast.error(error.message),
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
            <CardTitle>Record AGM election</CardTitle>
            <CardDescription>
              Replace the outgoing committee with the 3–12 owners elected at an issued AGM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="AGM">
              {(control) => (
                <Select value={electionMeetingId} onValueChange={setElectionMeetingId}>
                  <SelectTrigger id={control.id} className="w-full">
                    <SelectValue placeholder="Select an AGM…" />
                  </SelectTrigger>
                  <SelectContent>
                    {meetings?.meetings
                      .filter((meeting) => meeting.kind === "agm" && meeting.status !== "draft")
                      .map((meeting) => (
                        <SelectItem key={meeting.id} value={meeting.id}>
                          {meeting.title} ·{" "}
                          {new Date(meeting.scheduledAt).toLocaleDateString("en-AU")}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <div className="space-y-2">
              <p className="text-sm font-medium">Elected owners ({electedUserIds.length})</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {members?.members.map((member) => {
                  const selected = electedUserIds.includes(member.userId);
                  return (
                    <Button
                      key={member.userId}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      className="h-auto min-h-11 justify-start px-3 py-2 text-left"
                      aria-pressed={selected}
                      onClick={() =>
                        setElectedUserIds((current) =>
                          selected
                            ? current.filter((id) => id !== member.userId)
                            : current.length < 12
                              ? [...current, member.userId]
                              : current,
                        )
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{member.name}</span>
                        <span className="block truncate text-xs font-normal opacity-75">
                          {member.email}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>

            {electedUserIds.length > 7 && (
              <Field
                label="Expansion motion ID"
                hint="Required for 8–12 members; the ordinary motion must be finally carried at this AGM."
              >
                <Input
                  value={expansionMotionId}
                  onChange={(event) => setExpansionMotionId(event.target.value)}
                  placeholder="Carried motion UUID"
                />
              </Field>
            )}

            <Button
              onClick={() => recordElection.mutate()}
              pending={recordElection.isPending}
              disabled={
                !electionMeetingId ||
                electedUserIds.length < 3 ||
                electedUserIds.length > 12 ||
                (electedUserIds.length > 7 && !expansionMotionId.trim())
              }
            >
              Record election
            </Button>
          </CardContent>
        </Card>
      )}

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
                      hint={
                        members && members.members.length === 0
                          ? "No members have joined yet — invite people from the People tab first."
                          : undefined
                      }
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
