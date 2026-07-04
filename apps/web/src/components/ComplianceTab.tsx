import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  Check,
  CircleSlash,
  FileText,
  Flame,
  Landmark,
  Plus,
  Receipt,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDate } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";

/** Mirror of the row shape returned by GET /schemes/:id/compliance. */
interface Obligation {
  id: string;
  schemeId: string | null;
  kind: string;
  title: string;
  dueOn: string;
  status: string;
  escalationState: string;
  responsibleRole: string | null;
  completedAt: string | null;
}

type Tone = "positive" | "caution" | "critical" | "info" | "agent" | "neutral";

/** Kind → human label + icon. Mirrors the service's KIND_LABEL, in calendar order. */
const KINDS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "agm_due", label: "AGM due", icon: CalendarDays },
  { key: "insurance_renewal", label: "Insurance renewal", icon: ShieldCheck },
  { key: "valuation", label: "Insurance valuation", icon: Landmark },
  { key: "esm_inspection", label: "Essential safety measures", icon: Flame },
  { key: "financial_statements", label: "Financial statements", icon: FileText },
  { key: "bas", label: "BAS lodgement", icon: Receipt },
  { key: "registration_renewal", label: "Manager registration renewal", icon: BadgeCheck },
  { key: "pi_expiry", label: "Manager PI insurance", icon: ScrollText },
  { key: "custom", label: "Other obligations", icon: CalendarClock },
];
const KIND_META = new Map(KINDS.map((k) => [k.key, k]));

/** Escalation band → tone + short label for the pill. */
const NONE_ESC: { tone: Tone; label: string } = { tone: "neutral", label: "> 90 days" };
const ESCALATION: Record<string, { tone: Tone; label: string }> = {
  overdue: { tone: "critical", label: "overdue" },
  due: { tone: "critical", label: "due now" },
  t_30: { tone: "caution", label: "≤ 30 days" },
  t_60: { tone: "info", label: "≤ 60 days" },
  t_90: { tone: "info", label: "≤ 90 days" },
  none: NONE_ESC,
};

const OPEN_STATUSES = new Set(["upcoming", "due", "overdue"]);

/** Days from today to an ISO date-only string (negative = overdue). */
function daysUntil(dueOn: string): number {
  const due = new Date(`${dueOn}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** "3 days overdue" / "due today" / "due in 12 days" — shared with the manager surfaces. */
export function relativeDue(dueOn: string): string {
  const d = daysUntil(dueOn);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}

function humanRole(role: string | null): string | null {
  return role ? role.replace(/_/g, " ") : null;
}

export function ComplianceTab({ schemeId }: { schemeId: string }) {
  const isOfficer = useIsOfficer(schemeId);
  const [showClosed, setShowClosed] = useState(false);
  const window = showClosed ? "all" : "open";

  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["compliance", schemeId, window],
    queryFn: async () =>
      unwrap<{ obligations: Obligation[] }>(
        await api.schemes[":schemeId"].compliance.$get({
          param: { schemeId },
          query: { window },
        }),
      ),
  });

  const close = useMutation({
    mutationFn: async ({ obligationId, waived }: { obligationId: string; waived: boolean }) =>
      unwrap(
        await api.schemes[":schemeId"].compliance[":obligationId"].complete.$post({
          param: { schemeId, obligationId },
          json: { waived },
        }),
      ),
    onSuccess: (_data, { waived }) => {
      toast.success(waived ? "Obligation waived" : "Obligation marked done");
      void queryClient.invalidateQueries({ queryKey: ["compliance", schemeId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't close it"),
  });

  const obligations = data?.obligations ?? [];
  const open = obligations.filter((o) => OPEN_STATUSES.has(o.status));
  const overdue = open.filter((o) => o.escalationState === "overdue").length;
  const dueSoon = open.filter((o) => ["due", "t_30"].includes(o.escalationState)).length;

  // Group by kind, preserving the calendar order in KINDS.
  const groups = KINDS.map((k) => ({
    ...k,
    items: obligations
      .filter((o) => o.kind === k.key)
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        as="h2"
        title="Compliance calendar"
        description="Statutory deadlines — insurance, valuation, ESM, AGM, financial statements and manager registration — tracked and escalated as they approach."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowClosed((v) => !v)}
              aria-pressed={showClosed}
            >
              {showClosed ? "Hide completed" : "Show completed"}
            </Button>
            {isOfficer && (
              <AddObligationDialog
                schemeId={schemeId}
                onAdded={() =>
                  void queryClient.invalidateQueries({ queryKey: ["compliance", schemeId] })
                }
              />
            )}
          </div>
        }
      />

      {!isLoading && !isError && obligations.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? "critical" : "neutral"}
            hint="past their statutory due date"
          />
          <StatCard
            label="Due within 30 days"
            value={dueSoon}
            tone={dueSoon > 0 ? "caution" : "neutral"}
            hint="approaching — action soon"
          />
          <StatCard label="Open total" value={open.length} hint="obligations still to close" />
        </div>
      )}

      {isLoading && <Skeleton className="h-40" />}
      {isError && (
        <ErrorState
          message="Couldn't load the compliance calendar."
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !isError && groups.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing on the calendar"
          description="Compliance obligations appear here as insurance, valuations, meetings and registrations are recorded — then escalate automatically as their due dates near."
        />
      )}

      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <group.icon aria-hidden="true" className="size-4 text-muted-foreground" />
              {group.label}
              <span className="text-sm font-normal text-muted-foreground">
                ({group.items.length})
              </span>
            </h3>
            <ul className="mt-3 space-y-2.5">
              {group.items.map((o) => (
                <ObligationRow
                  key={o.id}
                  obligation={o}
                  isOfficer={isOfficer}
                  onClose={(waived) => close.mutate({ obligationId: o.id, waived })}
                  closing={
                    close.isPending && close.variables?.obligationId === o.id
                      ? close.variables.waived
                        ? "waive"
                        : "done"
                      : null
                  }
                  closeDisabled={close.isPending}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ObligationRow({
  obligation: o,
  isOfficer,
  onClose,
  closing,
  closeDisabled,
}: {
  obligation: Obligation;
  isOfficer: boolean;
  onClose: (waived: boolean) => void;
  /** Which action on THIS row is in flight, if any. */
  closing: "done" | "waive" | null;
  closeDisabled: boolean;
}) {
  // Waiving permanently closes a statutory obligation, so it is a two-step
  // action: first click arms the button, the second confirms.
  const [confirmWaive, setConfirmWaive] = useState(false);
  const isOpen = OPEN_STATUSES.has(o.status);
  const esc = ESCALATION[o.escalationState] ?? NONE_ESC;
  const role = humanRole(o.responsibleRole);
  const kindLabel = KIND_META.get(o.kind)?.label;

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{o.title}</p>
          {isOpen ? (
            <Badge tone={esc.tone}>{esc.label}</Badge>
          ) : o.status === "done" ? (
            <Badge tone="positive">
              <Check aria-hidden="true" className="size-3" /> done
            </Badge>
          ) : (
            <Badge tone="neutral">{o.status}</Badge>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {formatDate(o.dueOn)}
            {isOpen && <span className="text-foreground/70"> · {relativeDue(o.dueOn)}</span>}
            {!isOpen && o.completedAt && (
              <span> · closed {formatDate(o.completedAt.slice(0, 10))}</span>
            )}
          </span>
          {kindLabel && <span className="hidden sm:inline">· {kindLabel}</span>}
          {role && (
            <span className="inline-flex items-center gap-1">
              · <Users aria-hidden="true" className="size-3" /> {role}
            </span>
          )}
        </p>
      </div>
      {isOfficer && isOpen && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className={confirmWaive ? "text-critical hover:text-critical" : undefined}
            onClick={() => {
              if (confirmWaive) {
                setConfirmWaive(false);
                onClose(true);
              } else {
                setConfirmWaive(true);
              }
            }}
            onBlur={() => setConfirmWaive(false)}
            pending={closing === "waive"}
            disabled={closeDisabled}
            aria-label={confirmWaive ? `Confirm waiving "${o.title}"` : `Waive "${o.title}"`}
            title="Waive — close without completing (e.g. not applicable this period)"
          >
            <CircleSlash aria-hidden="true" className="size-4" />{" "}
            {confirmWaive ? "Confirm waive" : "Waive"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onClose(false)}
            pending={closing === "done"}
            disabled={closeDisabled}
            aria-label={`Mark "${o.title}" done`}
          >
            <Check aria-hidden="true" className="size-4" /> Mark done
          </Button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add an obligation by hand (officers) — deadlines the agents don't know about.
// ---------------------------------------------------------------------------

/** Kinds an officer may raise from this scheme; mirrors the route's allow-list. */
const RAISABLE_KINDS = [
  "custom",
  "agm_due",
  "insurance_renewal",
  "esm_inspection",
  "financial_statements",
  "bas",
  "valuation",
] as const;
type RaisableKind = (typeof RAISABLE_KINDS)[number];

const RESPONSIBLE_ROLES = [
  { value: "chair", label: "Chair" },
  { value: "secretary", label: "Secretary" },
  { value: "treasurer", label: "Treasurer" },
  { value: "manager_admin", label: "Manager" },
] as const;

const addSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the obligation a name.")
    .max(200, "Keep it under 200 characters."),
  kind: z.enum(RAISABLE_KINDS),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a due date."),
  responsibleRole: z.enum(["default", "chair", "secretary", "treasurer", "manager_admin"]),
});
type AddValues = z.infer<typeof addSchema>;

function AddObligationDialog({ schemeId, onAdded }: { schemeId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: async (values: AddValues) =>
      unwrap(
        await api.schemes[":schemeId"].compliance.$post({
          param: { schemeId },
          json: {
            title: values.title,
            kind: values.kind,
            dueOn: values.dueOn,
            responsibleRole:
              values.responsibleRole === "default" ? undefined : values.responsibleRole,
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      toast.success("Obligation added — it will escalate as the due date nears");
      onAdded();
    },
  });
  const form = useAppForm({
    schema: addSchema,
    defaultValues: {
      title: "",
      kind: "custom" as RaisableKind,
      dueOn: "",
      responsibleRole: "default" as AddValues["responsibleRole"],
    },
    onSubmit: (values) => create.mutateAsync(values),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden="true" className="size-4" /> Add obligation
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a compliance obligation</DialogTitle>
          <DialogDescription>
            Track a deadline that isn't raised automatically — a contract renewal, a service visit,
            a lodgement. It escalates on the calendar as the date approaches.
          </DialogDescription>
        </DialogHeader>
        <form
          id="add-obligation-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="title">
            {(field) => (
              <Field label="Title" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    placeholder="e.g. Fire panel annual service"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="kind">
              {(field) => (
                <Field label="Category" error={fieldError(field.state.meta.errors)}>
                  {(controlProps) => (
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v as RaisableKind)}
                    >
                      <SelectTrigger {...controlProps}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RAISABLE_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {k === "custom" ? "Other / custom" : KIND_META.get(k)?.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="dueOn">
              {(field) => (
                <Field label="Due date" required error={fieldError(field.state.meta.errors)}>
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      type="date"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
          </div>
          <form.Field name="responsibleRole">
            {(field) => (
              <Field
                label="Responsible"
                hint="Who is answerable for it. Defaults by category."
                error={fieldError(field.state.meta.errors)}
              >
                {(controlProps) => (
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as AddValues["responsibleRole"])}
                  >
                    <SelectTrigger {...controlProps}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default for the category</SelectItem>
                      {RESPONSIBLE_ROLES.map((r) => (
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
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="add-obligation-form">
            Add to calendar
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
