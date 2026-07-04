import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, Plus, ScrollText, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import {
  Dialog,
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
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDate, formatDateTime } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";

// ---------------------------------------------------------------------------
// Types (JSON — timestamps arrive as ISO strings).
// ---------------------------------------------------------------------------

type ComplaintStatus =
  | "received"
  | "under_discussion"
  | "notice_to_rectify"
  | "final_notice"
  | "resolved"
  | "withdrawn"
  | "vcat";

interface Complaint {
  id: string;
  complainantPersonId: string;
  respondentPersonId: string | null;
  subject: string;
  details: string;
  approvedForm: boolean;
  status: ComplaintStatus;
  receivedAt: string;
  meetByDate: string;
  resolvedAt: string | null;
}

interface BreachNotice {
  id: string;
  complaintId: string | null;
  subjectLotId: string | null;
  subjectPersonId: string | null;
  ruleRef: string;
  type: "notice_to_rectify" | "final_notice";
  issuedAt: string;
  rectifyByDate: string;
  status: string;
  details: string;
}

interface ComplaintEvent {
  id: string;
  kind: string;
  note: string | null;
  at: string;
  actor: { kind: string; id: string } | null;
}

interface Person {
  id: string;
  givenName: string | null;
  familyName: string | null;
  companyName: string | null;
}

// ---------------------------------------------------------------------------
// Presentation helpers.
// ---------------------------------------------------------------------------

type Tone = "positive" | "caution" | "critical" | "info" | "neutral";

const STATUS_TONE: Record<ComplaintStatus, Tone> = {
  received: "info",
  under_discussion: "caution",
  notice_to_rectify: "caution",
  final_notice: "critical",
  resolved: "positive",
  withdrawn: "neutral",
  vcat: "critical",
};

const BREACH_STATUS_TONE: Record<string, Tone> = {
  issued: "info",
  rectified: "positive",
  escalated: "critical",
  withdrawn: "neutral",
};

/** Which statuses a complaint may move to next (mirrors the service). */
const NEXT_STATUSES: Record<ComplaintStatus, ComplaintStatus[]> = {
  received: ["under_discussion", "resolved", "withdrawn"],
  under_discussion: ["notice_to_rectify", "resolved", "withdrawn", "vcat"],
  notice_to_rectify: ["final_notice", "resolved", "withdrawn", "vcat"],
  final_notice: ["vcat", "resolved", "withdrawn"],
  resolved: [],
  withdrawn: [],
  vcat: ["resolved", "withdrawn"],
};

const CLOSED: ComplaintStatus[] = ["resolved", "withdrawn"];

function statusLabel(status: string): string {
  if (status === "vcat") return "VCAT";
  return status.replace(/_/g, " ");
}

function StatusPill({ status }: { status: ComplaintStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} className="shrink-0 capitalize">
      {statusLabel(status)}
    </Badge>
  );
}

function personName(p: Person | undefined): string {
  if (!p) return "Unknown";
  if (p.companyName) return p.companyName;
  const name = [p.givenName, p.familyName].filter(Boolean).join(" ");
  return name || "Unnamed person";
}

/** Whole days from today (UTC date-only) until a YYYY-MM-DD deadline. */
function daysUntil(dateOnly: string): number {
  const today = new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = new Date(`${dateOnly}T00:00:00Z`).getTime();
  return Math.round((target - todayMs) / 86_400_000);
}

/** The statutory 28-day clock, rendered as a coloured line. */
function DeadlineClock({ complaint }: { complaint: Complaint }) {
  if (CLOSED.includes(complaint.status)) {
    return (
      <p className="text-13 text-muted-foreground">
        Closed{complaint.resolvedAt ? ` ${formatDate(complaint.resolvedAt)}` : ""}.
      </p>
    );
  }
  const days = daysUntil(complaint.meetByDate);
  const tone = days < 0 ? "text-critical" : days <= 7 ? "text-caution" : "text-muted-foreground";
  const label =
    days < 0
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
      : days === 0
        ? "Due today"
        : `${days} day${days === 1 ? "" : "s"} left`;
  return (
    <p className={`text-13 font-medium ${tone}`}>
      Must be dealt with by {formatDate(complaint.meetByDate)} · {label}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Tab.
// ---------------------------------------------------------------------------

export function GrievancesTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const invalidate = () => {
    for (const key of ["complaints", "my-complaints", "breach-notices"]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
    void queryClient.invalidateQueries({ queryKey: ["complaint"] });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        as="h2"
        title="Grievances"
        description="The owners corporation's approved dispute procedure (OC Act Part 10). Every complaint must be dealt with within 28 days."
        actions={<RaiseComplaintDialog schemeId={schemeId} onChange={invalidate} />}
      />
      {isOfficer ? (
        <>
          <ComplaintRegister schemeId={schemeId} onOpen={setSelectedId} />
          <ComplaintDetailSheet
            schemeId={schemeId}
            complaintId={selectedId}
            onOpenChange={(open) => !open && setSelectedId(null)}
            onChange={invalidate}
          />
        </>
      ) : (
        <MyComplaints schemeId={schemeId} onChange={invalidate} />
      )}
    </div>
  );
}

/**
 * Non-officers don't see the register, but they can track what they've
 * lodged — with the same 28-day clock the committee is held to.
 */
function MyComplaints({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-complaints", schemeId],
    queryFn: async () =>
      unwrap<{ complaints: Complaint[] }>(
        await api.schemes[":schemeId"].complaints.mine.$get({ param: { schemeId } }),
      ),
  });

  if (isLoading) return <Skeleton className="h-40" />;
  if (isError)
    return <ErrorState message="Couldn't load your complaints." onRetry={() => void refetch()} />;
  if (!data || data.complaints.length === 0)
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Raise a complaint in confidence"
        description="Lodged complaints go to your committee, who must meet and discuss the matter within 28 days. You can track progress here."
        action={<RaiseComplaintDialog schemeId={schemeId} onChange={onChange} />}
      />
    );

  return (
    <section>
      <h2 className="mb-2.5 text-base font-semibold">Your complaints</h2>
      <div className="space-y-2.5">
        {data.complaints.map((c) => (
          <Card key={c.id} className="py-0">
            <CardContent className="flex flex-col gap-2 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{c.subject}</p>
                <StatusPill status={c.status} />
              </div>
              <p className="line-clamp-2 text-13 text-muted-foreground">{c.details}</p>
              <p className="text-xs text-muted-foreground">Lodged {formatDate(c.receivedAt)}</p>
              <DeadlineClock complaint={c} />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Raise a complaint.
// ---------------------------------------------------------------------------

const raiseSchema = z.object({
  subject: z.string().trim().min(3, "Give the complaint a short subject."),
  details: z.string().trim().min(3, "Describe what happened."),
  respondentPersonId: z.string(),
  approvedForm: z.boolean(),
});

function RaiseComplaintDialog({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const people = usePeople(schemeId, open);

  const create = useMutation({
    mutationFn: async (values: z.infer<typeof raiseSchema>) =>
      unwrap(
        await api.schemes[":schemeId"].complaints.$post({
          param: { schemeId },
          json: {
            subject: values.subject,
            details: values.details,
            approvedForm: values.approvedForm,
            respondentPersonId: values.respondentPersonId || undefined,
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      toast.success("Complaint lodged — your committee has 28 days to deal with it");
      onChange();
    },
  });

  const form = useAppForm({
    schema: raiseSchema,
    defaultValues: { subject: "", details: "", respondentPersonId: "", approvedForm: true },
    onSubmit: (values) => create.mutateAsync(values),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden="true" className="size-4" /> Raise a complaint
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Raise a complaint</DialogTitle>
          <DialogDescription>
            This starts the owners corporation's approved grievance procedure.
          </DialogDescription>
        </DialogHeader>
        <form
          id="complaint-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="subject">
            {(field) => (
              <Field label="Subject" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    data-testid="complaint-subject"
                    placeholder="e.g. Noise from lot 4 after 11pm"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="details">
            {(field) => (
              <Field label="What happened?" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    data-testid="complaint-details"
                    className="min-h-28"
                    placeholder="Describe the issue — dates, who was involved, and what you'd like resolved."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="respondentPersonId">
            {(field) => (
              <Field
                label="Who is the complaint about?"
                hint="Optional — leave blank if it's about the owners corporation generally."
                error={fieldError(field.state.meta.errors)}
              >
                {(controlProps) => (
                  <Select
                    value={field.state.value || "none"}
                    onValueChange={(v) => field.handleChange(v === "none" ? "" : v)}
                  >
                    <SelectTrigger {...controlProps} data-testid="complaint-respondent">
                      <SelectValue placeholder="No one in particular" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No one in particular</SelectItem>
                      {(people.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {personName(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="approvedForm">
            {(field) => (
              <label className="flex items-start gap-2.5 text-13 text-muted-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={field.state.value}
                  onChange={(e) => field.handleChange(e.target.checked)}
                />
                <span>Lodged on the owners corporation's approved grievance form.</span>
              </label>
            )}
          </form.Field>
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="complaint-form">
            Lodge complaint
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Register (officers).
// ---------------------------------------------------------------------------

function usePeople(schemeId: string, enabled = true) {
  return useQuery({
    queryKey: ["people", schemeId],
    enabled,
    queryFn: async () =>
      (
        await unwrap<{ people: Person[] }>(
          await api.schemes[":schemeId"].people.$get({ param: { schemeId } }),
        )
      ).people,
  });
}

function ComplaintRegister({
  schemeId,
  onOpen,
}: {
  schemeId: string;
  onOpen: (id: string) => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["complaints", schemeId],
    queryFn: async () =>
      unwrap<{ complaints: Complaint[] }>(
        await api.schemes[":schemeId"].complaints.$get({ param: { schemeId } }),
      ),
  });
  const people = usePeople(schemeId);
  const [showClosed, setShowClosed] = useState(false);
  const nameOf = useMemo(() => {
    const map = new Map((people.data ?? []).map((p) => [p.id, personName(p)]));
    return (id: string | null) => (id ? (map.get(id) ?? "Unknown") : null);
  }, [people.data]);

  if (isLoading) return <Skeleton className="h-40" />;
  if (isError)
    return (
      <ErrorState message="Couldn't load the grievance register." onRetry={() => void refetch()} />
    );
  if (!data || data.complaints.length === 0)
    return (
      <EmptyState
        icon={Gavel}
        title="No complaints on record"
        description="When an owner or resident lodges a complaint, it appears here with its 28-day clock."
      />
    );

  // Most urgent statutory deadline first; closed matters tucked away.
  const open = data.complaints
    .filter((c) => !CLOSED.includes(c.status))
    .sort((a, b) => a.meetByDate.localeCompare(b.meetByDate));
  const closed = data.complaints.filter((c) => CLOSED.includes(c.status));
  const overdue = open.filter((c) => daysUntil(c.meetByDate) < 0).length;
  const dueSoon = open.filter((c) => {
    const d = daysUntil(c.meetByDate);
    return d >= 0 && d <= 7;
  }).length;
  const visible = showClosed ? [...open, ...closed] : open;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Overdue"
          value={overdue}
          tone={overdue > 0 ? "critical" : "neutral"}
          hint="past the 28-day deadline"
        />
        <StatCard
          label="Due within 7 days"
          value={dueSoon}
          tone={dueSoon > 0 ? "caution" : "neutral"}
          hint="meet-and-discuss clock running down"
        />
        <StatCard label="Open" value={open.length} hint="complaints still to deal with" />
      </div>

      {closed.length > 0 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowClosed((v) => !v)}
            aria-pressed={showClosed}
          >
            {showClosed ? "Hide closed" : `Show closed (${closed.length})`}
          </Button>
        </div>
      )}

      {visible.length === 0 && (
        <EmptyState
          icon={Gavel}
          title="Nothing open"
          description="Every complaint on the register has been resolved or withdrawn."
        />
      )}

      <div className="space-y-2.5">
        {visible.map((c) => (
          <Card key={c.id} className="py-0">
            <CardContent className="px-0 py-0">
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                data-testid={`complaint-${c.id}`}
                className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{c.subject}</p>
                  <StatusPill status={c.status} />
                </div>
                <p className="line-clamp-1 text-13 text-muted-foreground">{c.details}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>From {nameOf(c.complainantPersonId)}</span>
                  {c.respondentPersonId && <span>· about {nameOf(c.respondentPersonId)}</span>}
                  <span>· received {formatDate(c.receivedAt)}</span>
                </div>
                <DeadlineClock complaint={c} />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail (officers): timeline, status controls, breach notices.
// ---------------------------------------------------------------------------

interface ComplaintDetailPayload {
  complaint: Complaint;
  events: ComplaintEvent[];
  breachNotices: BreachNotice[];
}

function ComplaintDetailSheet({
  schemeId,
  complaintId,
  onOpenChange,
  onChange,
}: {
  schemeId: string;
  complaintId: string | null;
  onOpenChange: (open: boolean) => void;
  onChange: () => void;
}) {
  return (
    <Sheet open={complaintId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {complaintId && (
          <ComplaintDetailBody schemeId={schemeId} complaintId={complaintId} onChange={onChange} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ComplaintDetailBody({
  schemeId,
  complaintId,
  onChange,
}: {
  schemeId: string;
  complaintId: string;
  onChange: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["complaint", schemeId, complaintId],
    queryFn: async () =>
      unwrap<ComplaintDetailPayload>(
        await api.schemes[":schemeId"].complaints[":complaintId"].$get({
          param: { schemeId, complaintId },
        }),
      ),
  });
  const people = usePeople(schemeId);
  const nameOf = (id: string | null) => {
    if (!id) return null;
    return personName((people.data ?? []).find((p) => p.id === id));
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["complaint", schemeId, complaintId] });
    onChange();
  };

  if (isLoading)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    );
  if (isError || !data)
    return (
      <div className="p-6">
        <ErrorState message="Couldn't load this complaint." onRetry={() => void refetch()} />
      </div>
    );

  const { complaint, events, breachNotices } = data;

  return (
    <>
      <SheetHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <SheetTitle className="text-base">{complaint.subject}</SheetTitle>
          <StatusPill status={complaint.status} />
        </div>
        <SheetDescription asChild>
          <DeadlineClock complaint={complaint} />
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-8">
        <DescriptionList>
          <DescriptionItem label="Complainant">
            {nameOf(complaint.complainantPersonId)}
          </DescriptionItem>
          <DescriptionItem label="About">
            {nameOf(complaint.respondentPersonId) ?? "The owners corporation generally"}
          </DescriptionItem>
          <DescriptionItem label="Received">{formatDate(complaint.receivedAt)}</DescriptionItem>
          <DescriptionItem label="Approved form">
            {complaint.approvedForm ? "Yes" : "No"}
          </DescriptionItem>
        </DescriptionList>

        <section>
          <h3 className="mb-1.5 text-sm font-semibold">Complaint</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{complaint.details}</p>
        </section>

        <StatusControls schemeId={schemeId} complaint={complaint} onChanged={refresh} />

        <IssueBreachNotice schemeId={schemeId} complaint={complaint} onChanged={refresh} />

        {breachNotices.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Breach notices</h3>
            <div className="space-y-2">
              {breachNotices.map((n) => (
                <BreachNoticeRow key={n.id} schemeId={schemeId} notice={n} onChanged={refresh} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">History</h3>
          <ol className="space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3 text-sm">
                <div className="mt-1.5 size-2 shrink-0 rounded-full bg-border" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-medium capitalize">{statusLabel(ev.kind)}</p>
                  {ev.note && <p className="text-13 text-muted-foreground">{ev.note}</p>}
                  <p className="text-xs text-muted-foreground">{formatDateTime(ev.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

/** One breach notice with its outcome controls (issued → rectified/escalated/withdrawn). */
function BreachNoticeRow({
  schemeId,
  notice,
  onChanged,
}: {
  schemeId: string;
  notice: BreachNotice;
  onChanged: () => void;
}) {
  const close = useMutation({
    mutationFn: async (status: "rectified" | "escalated" | "withdrawn") =>
      unwrap(
        await api.schemes[":schemeId"]["breach-notices"][":breachNoticeId"].close.$post({
          param: { schemeId, breachNoticeId: notice.id },
          json: { status },
        }),
      ),
    onSuccess: (_data, status) => {
      toast.success(
        status === "rectified"
          ? "Notice marked rectified"
          : status === "escalated"
            ? "Notice marked escalated"
            : "Notice withdrawn",
      );
      onChanged();
    },
  });

  const days = daysUntil(notice.rectifyByDate);
  const clockTone =
    notice.status !== "issued"
      ? "text-muted-foreground"
      : days < 0
        ? "text-critical"
        : days <= 7
          ? "text-caution"
          : "text-muted-foreground";

  return (
    <div className="rounded-md border px-3 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium capitalize">{statusLabel(notice.type)}</span>
        <Badge tone={BREACH_STATUS_TONE[notice.status] ?? "neutral"} className="capitalize">
          {notice.status}
        </Badge>
      </div>
      <p className={`mt-1 text-13 ${clockTone}`}>
        {notice.ruleRef} · rectify by {formatDate(notice.rectifyByDate)}
        {notice.status === "issued" &&
          (days < 0
            ? ` · ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
            : days === 0
              ? " · due today"
              : ` · ${days} day${days === 1 ? "" : "s"} left`)}
      </p>
      <p className="mt-1 text-13 text-muted-foreground">{notice.details}</p>
      {close.isError && (
        <p role="alert" className="mt-1.5 text-13 text-critical">
          {close.error.message}
        </p>
      )}
      {notice.status === "issued" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={close.isPending}
            onClick={() => close.mutate("rectified")}
          >
            Mark rectified
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={close.isPending}
            onClick={() => close.mutate("escalated")}
          >
            Mark escalated
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={close.isPending}
            onClick={() => close.mutate("withdrawn")}
          >
            Withdraw
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusControls({
  schemeId,
  complaint,
  onChanged,
}: {
  schemeId: string;
  complaint: Complaint;
  onChanged: () => void;
}) {
  const next = NEXT_STATUSES[complaint.status];
  const [target, setTarget] = useState<ComplaintStatus | "">("");
  const [note, setNote] = useState("");

  const advance = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].complaints[":complaintId"].advance.$post({
          param: { schemeId, complaintId: complaint.id },
          json: { status: target as ComplaintStatus, note: note || undefined },
        }),
      ),
    onSuccess: () => {
      toast.success("Complaint updated");
      setTarget("");
      setNote("");
      onChanged();
    },
  });

  if (next.length === 0) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-13 text-muted-foreground">
        This complaint is closed. No further status changes are available.
      </p>
    );
  }

  return (
    <section className="space-y-2.5 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">Progress the complaint</h3>
      <Select value={target} onValueChange={(v) => setTarget(v as ComplaintStatus)}>
        <SelectTrigger data-testid="complaint-advance-status" aria-label="Next status">
          <SelectValue placeholder="Choose the next step" />
        </SelectTrigger>
        <SelectContent>
          {next.map((s) => (
            <SelectItem key={s} value={s} className="capitalize">
              {statusLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        className="min-h-16"
        aria-label="Note for the record"
        placeholder="Add a note for the record (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {advance.isError && (
        <p role="alert" className="text-13 text-critical">
          {advance.error.message}
        </p>
      )}
      <Button
        size="sm"
        disabled={!target || advance.isPending}
        pending={advance.isPending}
        onClick={() => advance.mutate()}
      >
        Update status
      </Button>
    </section>
  );
}

const breachSchema = z.object({
  ruleRef: z.string().trim().min(1, "Name the rule that was contravened."),
  type: z.enum(["notice_to_rectify", "final_notice"]),
  details: z.string().trim().min(3, "Describe the breach and what must be rectified."),
});

function IssueBreachNotice({
  schemeId,
  complaint,
  onChanged,
}: {
  schemeId: string;
  complaint: Complaint;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  const issue = useMutation({
    mutationFn: async (values: z.infer<typeof breachSchema>) =>
      unwrap(
        await api.schemes[":schemeId"]["breach-notices"].$post({
          param: { schemeId },
          json: {
            complaintId: complaint.id,
            subjectPersonId: complaint.respondentPersonId ?? undefined,
            ruleRef: values.ruleRef,
            type: values.type,
            details: values.details,
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      toast.success("Breach notice issued — 28 days to rectify");
      onChanged();
    },
  });

  const form = useAppForm({
    schema: breachSchema,
    defaultValues: { ruleRef: "", type: "notice_to_rectify" as const, details: "" },
    onSubmit: (values) => issue.mutateAsync(values),
  });

  const canIssue = complaint.respondentPersonId !== null;

  if (!canIssue) {
    return (
      <p className="text-13 text-muted-foreground">
        A breach notice needs someone to be addressed to — this complaint isn't about a specific
        person.
      </p>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ScrollText aria-hidden="true" className="size-4" /> Issue breach notice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue a breach notice</DialogTitle>
          <DialogDescription>
            A notice to rectify (or final notice) gives the named party 28 days to comply.
          </DialogDescription>
        </DialogHeader>
        <form
          id="breach-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="type">
            {(field) => (
              <Field label="Notice type" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Select
                    value={field.state.value}
                    onValueChange={(v) =>
                      field.handleChange(v as "notice_to_rectify" | "final_notice")
                    }
                  >
                    <SelectTrigger {...controlProps} data-testid="breach-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="notice_to_rectify">Notice to rectify</SelectItem>
                      <SelectItem value="final_notice">Final notice</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="ruleRef">
            {(field) => (
              <Field label="Rule contravened" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    data-testid="breach-rule"
                    placeholder="e.g. Model Rule 4.1 (noise)"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="details">
            {(field) => (
              <Field
                label="What must be rectified?"
                required
                error={fieldError(field.state.meta.errors)}
              >
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    data-testid="breach-details"
                    className="min-h-24"
                    placeholder="Set out the breach and the steps required to comply."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="breach-form">
            Issue notice
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
