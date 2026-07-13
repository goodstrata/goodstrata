import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ShieldCheck, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { unwrap } from "@/lib/api";
import { dollars, formatDate } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";

interface Policy {
  id: string;
  kind: string;
  insurer: string;
  policyNumber: string;
  sumInsuredCents: number | null;
  periodStart: string;
  periodEnd: string;
  status: string;
}
interface Claim {
  id: string;
  description: string;
  status: string;
  claimNumber: string | null;
}
interface Valuation {
  id: string;
  valuedOn: string;
  nextDueOn: string;
  replacementValueCents: number;
}
interface InsurancePayload {
  policies: Policy[];
  claims: Claim[];
  valuations: Valuation[];
  readiness: {
    ready: boolean;
    buildingRequired: boolean;
    publicLiabilityRequired: boolean;
    reasons: string[];
  };
}
interface PlanItem {
  id: string;
  name: string;
  scheduledOn: string;
  estimatedCostCents: number;
  presentCondition: string;
}
interface Plan {
  id: string;
  title: string;
  status: string;
  coverageStartOn: string;
  coverageEndOn: string;
  nextReviewOn: string | null;
  forecastTotalCents: number;
  completedCents: number;
  items: PlanItem[];
}
interface PlansPayload {
  required: boolean;
  fund: { id: string; balanceCents: number };
  plans: Plan[];
}
interface DocumentRow {
  id: string;
  title: string;
  category: string;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: "include",
  headers: body ? { "content-type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

export function BuildingComplianceTab({ schemeId }: { schemeId: string }) {
  const isOfficer = useIsOfficer(schemeId);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const insurance = useQuery({
    queryKey: ["insurance", schemeId],
    queryFn: async () =>
      unwrap<InsurancePayload>(
        await fetch(`/api/schemes/${schemeId}/insurance`, { credentials: "include" }),
      ),
  });
  const plans = useQuery({
    queryKey: ["maintenance-plans", schemeId],
    queryFn: async () =>
      unwrap<PlansPayload>(
        await fetch(`/api/schemes/${schemeId}/maintenance-plans`, { credentials: "include" }),
      ),
  });

  if (insurance.isPending || plans.isPending) return <Skeleton className="h-96 w-full" />;
  if (insurance.isError || plans.isError || !insurance.data || !plans.data) {
    return (
      <ErrorState
        message="Couldn't load insurance and maintenance-plan records."
        onRetry={() => {
          void insurance.refetch();
          void plans.refetch();
        }}
      />
    );
  }

  const currentPlan = plans.data.plans.find((p) => p.status === "approved") ?? plans.data.plans[0];
  return (
    <div className="max-w-4xl space-y-6">
      {isOfficer && (
        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link to="/schemes/$schemeId/manager" params={{ schemeId }}>
              Manager appointment & registration
            </Link>
          </Button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5" /> Insurance readiness
            </CardTitle>
            <CardDescription>Structured cover checks used by scheme activation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge variant={insurance.data.readiness.ready ? "default" : "destructive"}>
              {insurance.data.readiness.ready ? "Required cover current" : "Action required"}
            </Badge>
            {insurance.data.readiness.reasons.map((reason) => (
              <p key={reason} className="text-sm text-critical">
                {reason}
              </p>
            ))}
            <p className="text-sm text-muted-foreground">
              Building cover{" "}
              {insurance.data.readiness.buildingRequired ? "required" : "not required"}; public
              liability{" "}
              {insurance.data.readiness.publicLiabilityRequired ? "required" : "not required"}.
            </p>
            {isOfficer && (
              <Button variant="outline" onClick={() => setShowPolicy((v) => !v)}>
                {showPolicy ? "Close" : "Record policy"}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-5" /> Ten-year maintenance plan
            </CardTitle>
            <CardDescription>
              {plans.data.required
                ? "Mandatory for this Tier 1 or 2 scheme."
                : "Optional for this scheme tier."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">
              {dollars(currentPlan?.forecastTotalCents ?? 0)}
            </p>
            <p className="text-sm text-muted-foreground">
              Forecast works · fund balance {dollars(plans.data.fund.balanceCents)}
            </p>
            {currentPlan ? (
              <Badge variant="outline">{currentPlan.status.replaceAll("_", " ")}</Badge>
            ) : (
              <p className="text-sm text-critical">No plan recorded</p>
            )}
            {isOfficer && (
              <Button variant="outline" onClick={() => setShowPlan((v) => !v)}>
                {showPlan ? "Close" : "Create plan"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {showPolicy && <PolicyForm schemeId={schemeId} />}
      {showPlan && <PlanForm schemeId={schemeId} />}
      {isOfficer && currentPlan?.status === "draft" && (
        <PlanActions schemeId={schemeId} plan={currentPlan} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Policies and valuations</CardTitle>
          <CardDescription>
            Renewal and five-year valuation dates feed the compliance calendar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {insurance.data.policies.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No structured policies"
              description="Upload the evidence document, then record the policy details."
            />
          ) : (
            insurance.data.policies.map((policy) => (
              <div
                key={policy.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">
                    {policy.kind.replaceAll("_", " ")} · {policy.insurer}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {policy.policyNumber} · {formatDate(policy.periodStart)}–
                    {formatDate(policy.periodEnd)}
                  </p>
                </div>
                <Badge variant="outline">{policy.status}</Badge>
              </div>
            ))
          )}
          {insurance.data.valuations.map((valuation) => (
            <p key={valuation.id} className="text-sm">
              Valued {formatDate(valuation.valuedOn)} at {dollars(valuation.replacementValueCents)}{" "}
              · next due {formatDate(valuation.nextDueOn)}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capital item forecast</CardTitle>
          <CardDescription>
            Present condition, timing, cost and expected life are retained in the approved plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!currentPlan ? (
            <EmptyState
              icon={Wrench}
              title="No maintenance plan"
              description="Create a draft using the approved form, add capital items, then approve it by resolution."
            />
          ) : currentPlan.items.length === 0 ? (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>Draft is empty</AlertTitle>
              <AlertDescription>
                Add capital items through the maintenance-plan API before approval.
              </AlertDescription>
            </Alert>
          ) : (
            currentPlan.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.presentCondition} · {formatDate(item.scheduledOn)}
                  </p>
                </div>
                <span className="font-medium">{dollars(item.estimatedCostCents)}</span>
              </div>
            ))
          )}
          {currentPlan?.status === "approved" && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>AGM reporting ready</AlertTitle>
              <AlertDescription>
                Implementation totals and the maintenance-fund gap are available from the AGM report
                endpoint.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function useInsuranceDocuments(schemeId: string) {
  return useQuery({
    queryKey: ["documents", schemeId, "insurance"],
    queryFn: async () =>
      unwrap<{ documents: DocumentRow[] }>(
        await fetch(`/api/schemes/${schemeId}/documents?category=insurance`, {
          credentials: "include",
        }),
      ),
  });
}

function PolicyForm({ schemeId }: { schemeId: string }) {
  const qc = useQueryClient();
  const docs = useInsuranceDocuments(schemeId);
  const [kind, setKind] = useState("building");
  const [insurer, setInsurer] = useState("");
  const [number, setNumber] = useState("");
  const [cover, setCover] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [documentId, setDocumentId] = useState("");
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await fetch(
          `/api/schemes/${schemeId}/insurance/policies`,
          json("POST", {
            kind,
            insurer,
            policyNumber: number,
            sumInsuredCents: Math.round(Number(cover) * 100),
            periodStart: start,
            periodEnd: end,
            reinstatementAndReplacement: kind === "building",
            certificateDocumentId: documentId,
          }),
        ),
      ),
    onSuccess: () => {
      toast.success("Policy recorded");
      void qc.invalidateQueries({ queryKey: ["insurance", schemeId] });
      // Activation readiness is composed into the overview response. Refresh it
      // alongside the insurance register so returning to Overview immediately
      // reflects the newly recorded cover.
      void qc.invalidateQueries({ queryKey: ["overview", schemeId] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record policy</CardTitle>
        <CardDescription>The certificate must already be in the document register.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Cover type">
          {(p) => (
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger {...p}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="building">Building reinstatement</SelectItem>
                <SelectItem value="public_liability">Public liability</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Certificate">
          <Select value={documentId} onValueChange={setDocumentId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose document" />
            </SelectTrigger>
            <SelectContent>
              {docs.data?.documents.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Insurer">
          <Input value={insurer} onChange={(e) => setInsurer(e.target.value)} />
        </Field>
        <Field label="Policy number">
          <Input value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Sum insured (dollars)">
          <Input inputMode="decimal" value={cover} onChange={(e) => setCover(e.target.value)} />
        </Field>
        <div />
        <Field label="Starts">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Ends">
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Button disabled={save.isPending || !documentId} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Record policy"}
          </Button>
          {save.error && <p className="mt-2 text-sm text-critical">{save.error.message}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanForm({ schemeId }: { schemeId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("Ten-year maintenance plan");
  const [preparedOn, setPreparedOn] = useState("");
  const [coverageStartOn, setCoverageStartOn] = useState("");
  const [version, setVersion] = useState("CAV approved form — current at preparation");
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await fetch(
          `/api/schemes/${schemeId}/maintenance-plans`,
          json("POST", { title, preparedOn, coverageStartOn, approvedFormVersion: version }),
        ),
      ),
    onSuccess: () => {
      toast.success("Draft maintenance plan created");
      void qc.invalidateQueries({ queryKey: ["maintenance-plans", schemeId] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create statutory plan</CardTitle>
        <CardDescription>
          Creates a ten-year draft linked to this scheme's maintenance fund.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Approved form version">
          <Input value={version} onChange={(e) => setVersion(e.target.value)} />
        </Field>
        <Field label="Prepared on">
          <Input type="date" value={preparedOn} onChange={(e) => setPreparedOn(e.target.value)} />
        </Field>
        <Field label="Coverage starts">
          <Input
            type="date"
            value={coverageStartOn}
            onChange={(e) => setCoverageStartOn(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Creating…" : "Create draft"}
          </Button>
          {save.error && <p className="mt-2 text-sm text-critical">{save.error.message}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanActions({ schemeId, plan }: { schemeId: string; plan: Plan }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("unknown");
  const [action, setAction] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [cost, setCost] = useState("");
  const [life, setLife] = useState("");
  const [approvedOn, setApprovedOn] = useState("");
  const [resolutionId, setResolutionId] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const addItem = useMutation({
    mutationFn: async () =>
      unwrap(
        await fetch(
          `/api/schemes/${schemeId}/maintenance-plans/${plan.id}/items`,
          json("POST", {
            name,
            presentCondition: condition,
            plannedAction: action,
            scheduledOn,
            estimatedCostCents: Math.round(Number(cost) * 100),
            expectedLifeAfterWorksYears: Number(life),
          }),
        ),
      ),
    onSuccess: () => {
      toast.success("Capital item added");
      setName("");
      void qc.invalidateQueries({ queryKey: ["maintenance-plans", schemeId] });
    },
  });
  const approve = useMutation({
    mutationFn: async () =>
      unwrap(
        await fetch(
          `/api/schemes/${schemeId}/maintenance-plans/${plan.id}/approve`,
          json("POST", {
            approvedOn,
            approvalResolutionId: resolutionId,
            approvedAtMeetingId: meetingId,
          }),
        ),
      ),
    onSuccess: () => {
      toast.success("Maintenance plan approved");
      void qc.invalidateQueries({ queryKey: ["maintenance-plans", schemeId] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Complete and approve draft</CardTitle>
        <CardDescription>
          Add each major capital item, then link the ordinary resolution and meeting that approved
          the plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Capital item">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Present condition">
            {(p) => (
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger {...p}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["unknown", "good", "fair", "poor", "critical"].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Planned repair or replacement" className="sm:col-span-2">
            <Input value={action} onChange={(e) => setAction(e.target.value)} />
          </Field>
          <Field label="Scheduled on">
            <Input
              type="date"
              value={scheduledOn}
              onChange={(e) => setScheduledOn(e.target.value)}
            />
          </Field>
          <Field label="Estimated cost (dollars)">
            <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label="Expected life after works (years)">
            <Input inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} />
          </Field>
          <div className="self-end">
            <Button disabled={addItem.isPending} onClick={() => addItem.mutate()}>
              {addItem.isPending ? "Adding…" : "Add capital item"}
            </Button>
          </div>
        </div>
        <div className="grid gap-4 border-t pt-6 sm:grid-cols-2">
          <Field label="Approved on">
            <Input type="date" value={approvedOn} onChange={(e) => setApprovedOn(e.target.value)} />
          </Field>
          <div />
          <Field label="Ordinary resolution ID">
            <Input value={resolutionId} onChange={(e) => setResolutionId(e.target.value)} />
          </Field>
          <Field label="Meeting ID">
            <Input value={meetingId} onChange={(e) => setMeetingId(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Button
              disabled={approve.isPending || plan.items.length === 0}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? "Approving…" : "Approve plan"}
            </Button>
          </div>
        </div>
        {(addItem.error || approve.error) && (
          <p className="text-sm text-critical">{(addItem.error ?? approve.error)?.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
