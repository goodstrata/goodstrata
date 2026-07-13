import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, FileBadge, Library, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";

interface RegisterView {
  preparedAt: string;
  scheme: { name: string; planOfSubdivision: string; address: string };
  manager: { name: string; registrationNumber: string | null; contactEmail: string | null } | null;
  lots: {
    id: string;
    lotNumber: string;
    liability: number;
    entitlement: number;
    owners: { personId: string; name: string; address: unknown }[];
  }[];
  rulesAmendments: { id: string; title: string; details: string; effectiveOn: string }[];
  contracts: {
    id: string;
    kind: string;
    title: string;
    details: string;
    counterparty: string | null;
    effectiveOn: string;
    expiresOn: string | null;
  }[];
  insurancePolicies: {
    id: string;
    kind: string;
    insurer: string;
    policyNumber: string;
    periodEnd: string;
  }[];
  liabilityBasis: string | null;
  entitlementBasis: string | null;
}

interface InspectionRequest {
  id: string;
  requesterName: string;
  requesterType: string;
  scope: string;
  status: string;
  commercialPurpose: boolean;
  createdAt: string;
}

interface CertificateRequest {
  id: string;
  lotId: string;
  applicantName: string;
  urgency: string;
  status: string;
  quotedFeeCents: number;
  dueAt: string | null;
  certificateDocumentId: string | null;
  createdAt: string;
}

async function jsonRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method,
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

const urgencyFees = {
  standard_6_10_days: Math.round(9.64 * 1727),
  priority_3_5_days: Math.round(14.46 * 1727),
  urgent_2_days: Math.round(17.35 * 1727),
} as const;

export function RecordsSection({ schemeId }: { schemeId: string }) {
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const register = useQuery({
    queryKey: ["oc-register", schemeId],
    queryFn: () =>
      jsonRequest<{ register: RegisterView }>(`/api/schemes/${schemeId}/records/register`, "GET"),
  });
  const inspections = useQuery({
    queryKey: ["record-inspections", schemeId],
    queryFn: () =>
      jsonRequest<{ requests: InspectionRequest[] }>(
        `/api/schemes/${schemeId}/records/inspections`,
        "GET",
      ),
    enabled: isOfficer,
  });
  const certificates = useQuery({
    queryKey: ["certificate-requests", schemeId],
    queryFn: () =>
      jsonRequest<{ requests: CertificateRequest[] }>(
        `/api/schemes/${schemeId}/records/certificates`,
        "GET",
      ),
    enabled: isOfficer,
  });
  const refreshQueues = () => {
    void queryClient.invalidateQueries({ queryKey: ["record-inspections", schemeId] });
    void queryClient.invalidateQueries({ queryKey: ["certificate-requests", schemeId] });
    void queryClient.invalidateQueries({ queryKey: ["documents", schemeId] });
  };

  if (register.isError)
    return (
      <ErrorState
        message="Couldn't load the owners corporation register."
        onRetry={() => void register.refetch()}
      />
    );
  if (!register.data) return <Skeleton className="h-72 max-w-4xl" />;
  const view = register.data.register;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Owners corporation records</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The statutory register, inspection requests and section 151 certificates.
        </p>
      </div>

      <RegisterCard
        view={view}
        schemeId={schemeId}
        isOfficer={isOfficer}
        onUpdated={() =>
          void queryClient.invalidateQueries({ queryKey: ["oc-register", schemeId] })
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <InspectionRequestForm schemeId={schemeId} onCreated={refreshQueues} />
        <CertificateRequestForm schemeId={schemeId} lots={view.lots} onCreated={refreshQueues} />
      </div>

      {isOfficer && (
        <>
          <InspectionQueue
            schemeId={schemeId}
            requests={inspections.data?.requests ?? []}
            loading={inspections.isPending}
            onChanged={refreshQueues}
          />
          <CertificateQueue
            schemeId={schemeId}
            requests={certificates.data?.requests ?? []}
            lots={view.lots}
            loading={certificates.isPending}
            onChanged={refreshQueues}
          />
        </>
      )}
    </div>
  );
}

function RegisterCard({
  view,
  schemeId,
  isOfficer,
  onUpdated,
}: {
  view: RegisterView;
  schemeId: string;
  isOfficer: boolean;
  onUpdated: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Library className="size-4" /> Statutory register
        </CardTitle>
        <CardDescription>
          {view.scheme.planOfSubdivision} · {view.scheme.address} · prepared{" "}
          {formatDate(view.preparedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Manager</p>
            <p className="text-sm font-medium">{view.manager?.name ?? "Self-managed"}</p>
            {view.manager?.registrationNumber && (
              <p className="font-mono text-xs">{view.manager.registrationNumber}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lots</p>
            <p className="text-sm font-medium">{view.lots.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Current policies</p>
            <p className="text-sm font-medium">{view.insurancePolicies.length}</p>
          </div>
        </div>
        {(!view.liabilityBasis || !view.entitlementBasis) && !isOfficer && (
          <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
            The plan's basis for lot liability and entitlement has not been captured yet.
          </p>
        )}
        {isOfficer && <RegisterBasisForm schemeId={schemeId} view={view} onUpdated={onUpdated} />}
        <div>
          <h3 className="text-sm font-medium">Membership and lot allocation</h3>
          <div className="mt-2 divide-y rounded-md border">
            {view.lots.map((lot) => (
              <div
                key={lot.id}
                className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
              >
                <span>
                  <strong>Lot {lot.lotNumber}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {lot.owners
                      .map((owner) => owner.name)
                      .filter(Boolean)
                      .join(", ") || "No current owner recorded"}
                  </span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  LE {lot.entitlement} · LL {lot.liability}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <RegisterList
            title="Rules amendments"
            rows={view.rulesAmendments.map((item) => `${item.effectiveOn} · ${item.title}`)}
          />
          <RegisterList
            title="Contracts, leases & licences"
            rows={view.contracts.map((item) => `${item.kind.replace(/_/g, " ")} · ${item.title}`)}
          />
          <RegisterList
            title="Insurance"
            rows={view.insurancePolicies.map(
              (policy) =>
                `${policy.kind.replace(/_/g, " ")} · ${policy.insurer} · to ${policy.periodEnd}`,
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function RegisterBasisForm({
  schemeId,
  view,
  onUpdated,
}: {
  schemeId: string;
  view: RegisterView;
  onUpdated: () => void;
}) {
  const [liability, setLiability] = useState(view.liabilityBasis ?? "");
  const [entitlement, setEntitlement] = useState(view.entitlementBasis ?? "");
  const save = useMutation({
    mutationFn: () =>
      jsonRequest(`/api/schemes/${schemeId}/records/register/basis`, "PATCH", {
        lotLiabilityBasis: liability,
        lotEntitlementBasis: entitlement,
      }),
    onSuccess: () => {
      toast.success("Plan allocation basis recorded");
      onUpdated();
    },
  });
  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
      <Field label="Lot liability basis">
        <Input value={liability} onChange={(event) => setLiability(event.target.value)} />
      </Field>
      <Field label="Lot entitlement basis">
        <Input value={entitlement} onChange={(event) => setEntitlement(event.target.value)} />
      </Field>
      <Button
        className="sm:col-span-2 sm:w-fit"
        size="sm"
        variant="outline"
        pending={save.isPending}
        disabled={!liability.trim() || !entitlement.trim()}
        onClick={() => save.mutate()}
      >
        Save plan basis
      </Button>
    </div>
  );
}

function RegisterList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length ? (
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">None recorded</p>
      )}
    </div>
  );
}

function InspectionRequestForm({
  schemeId,
  onCreated,
}: {
  schemeId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("lot_owner");
  const [scope, setScope] = useState("both");
  const create = useMutation({
    mutationFn: () =>
      jsonRequest(`/api/schemes/${schemeId}/records/inspections`, "POST", {
        requesterType: type,
        requesterName: name,
        scope,
        requestedDocumentIds: [],
        wantsCopies: false,
        commercialPurpose: false,
        quotedCopyFeeCents: 0,
      }),
    onSuccess: () => {
      setName("");
      toast.success("Inspection request lodged");
      onCreated();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="size-4" /> Request an inspection
        </CardTitle>
        <CardDescription>
          Inspection is free. Copy fees are assessed separately and capped.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Requester name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entitlement">
            {(control) => (
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id={control.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lot_owner">Lot owner</SelectItem>
                  <SelectItem value="mortgagee">Mortgagee</SelectItem>
                  <SelectItem value="buyer">Buyer</SelectItem>
                  <SelectItem value="representative">Representative</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Inspect">
            {(control) => (
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger id={control.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="register">Register</SelectItem>
                  <SelectItem value="records">Records</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
        {create.error && <p className="text-sm text-critical">{create.error.message}</p>}
        <Button pending={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
          Lodge written request
        </Button>
      </CardContent>
    </Card>
  );
}

function CertificateRequestForm({
  schemeId,
  lots,
  onCreated,
}: {
  schemeId: string;
  lots: RegisterView["lots"];
  onCreated: () => void;
}) {
  const [lotId, setLotId] = useState(lots[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [urgency, setUrgency] = useState<keyof typeof urgencyFees>("standard_6_10_days");
  const create = useMutation({
    mutationFn: () =>
      jsonRequest(`/api/schemes/${schemeId}/records/certificates`, "POST", {
        lotId,
        applicantName: name,
        applicantEmail: email || undefined,
        urgency,
        additionalCertificate: false,
        quotedFeeCents: urgencyFees[urgency],
      }),
    onSuccess: () => {
      setName("");
      setEmail("");
      toast.success("Certificate request lodged");
      onCreated();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileBadge className="size-4" /> Request a certificate
        </CardTitle>
        <CardDescription>
          Starts the 10-business-day clock when the written request and fee are received.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lot">
            {(control) => (
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger id={control.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lots.map((lot) => (
                    <SelectItem key={lot.id} value={lot.id}>
                      Lot {lot.lotNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Service">
            {(control) => (
              <Select
                value={urgency}
                onValueChange={(value) => setUrgency(value as keyof typeof urgencyFees)}
              >
                <SelectTrigger id={control.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard_6_10_days">6–10 business days</SelectItem>
                  <SelectItem value="priority_3_5_days">3–5 business days</SelectItem>
                  <SelectItem value="urgent_2_days">Within 2 business days</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Applicant name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Applicant email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">
          Maximum fee for this service: ${(urgencyFees[urgency] / 100).toFixed(2)} ex GST (2026–27).
        </p>
        {create.error && <p className="text-sm text-critical">{create.error.message}</p>}
        <Button
          pending={create.isPending}
          disabled={!lotId || !name.trim()}
          onClick={() => create.mutate()}
        >
          Lodge request
        </Button>
      </CardContent>
    </Card>
  );
}

function InspectionQueue({
  schemeId,
  requests,
  loading,
  onChanged,
}: {
  schemeId: string;
  requests: InspectionRequest[];
  loading: boolean;
  onChanged: () => void;
}) {
  const action = useMutation({
    mutationFn: ({ id, step, body }: { id: string; step: string; body: unknown }) =>
      jsonRequest(`/api/schemes/${schemeId}/records/inspections/${id}/${step}`, "POST", body),
    onSuccess: onChanged,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inspection queue</CardTitle>
        <CardDescription>
          Verify entitlement before providing supervised access. A commercial representative needs
          prior OC consent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-20" />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No inspection requests"
            description="Written requests will appear here."
          />
        ) : (
          <div className="divide-y rounded-md border">
            {requests.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <span className="text-sm">
                  <strong>{request.requesterName}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {request.requesterType.replace(/_/g, " ")} · {request.scope} ·{" "}
                    {formatDate(request.createdAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{request.status.replace(/_/g, " ")}</Badge>
                  {request.status === "submitted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        action.mutate({
                          id: request.id,
                          step: "verify",
                          body: {
                            eligible: true,
                            ...(request.commercialPurpose
                              ? { commercialConsentAt: new Date().toISOString() }
                              : {}),
                          },
                        })
                      }
                    >
                      Verify
                    </Button>
                  )}
                  {request.status === "eligibility_verified" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        action.mutate({
                          id: request.id,
                          step: "schedule",
                          body: { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
                        })
                      }
                    >
                      Schedule
                    </Button>
                  )}
                  {request.status === "scheduled" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        action.mutate({
                          id: request.id,
                          step: "complete",
                          body: { printedPages: 0 },
                        })
                      }
                    >
                      Complete
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CertificateQueue({
  schemeId,
  requests,
  lots,
  loading,
  onChanged,
}: {
  schemeId: string;
  requests: CertificateRequest[];
  lots: RegisterView["lots"];
  loading: boolean;
  onChanged: () => void;
}) {
  const paid = useMutation({
    mutationFn: (id: string) =>
      jsonRequest(`/api/schemes/${schemeId}/records/certificates/${id}/payment`, "POST", {
        paidAt: new Date().toISOString(),
      }),
    onSuccess: onChanged,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Certificate queue</CardTitle>
        <CardDescription>
          Paid requests show their statutory service deadline. Issue requires the three prescribed
          accompanying documents.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-20" />
        ) : requests.length === 0 ? (
          <EmptyState
            icon={FileBadge}
            title="No certificate requests"
            description="Section 151 requests will appear here."
          />
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <div key={request.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm">
                    <strong>{request.applicantName}</strong>
                    <span className="block text-xs text-muted-foreground">
                      Lot {lots.find((lot) => lot.id === request.lotId)?.lotNumber ?? request.lotId}{" "}
                      · ${(request.quotedFeeCents / 100).toFixed(2)}
                      {request.dueAt ? ` · due ${formatDate(request.dueAt)}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={request.status === "issued" ? "positive" : "neutral"}>
                      {request.status.replace(/_/g, " ")}
                    </Badge>
                    {request.status === "awaiting_payment" && (
                      <Button
                        size="sm"
                        variant="outline"
                        pending={paid.isPending}
                        onClick={() => paid.mutate(request.id)}
                      >
                        Record paid
                      </Button>
                    )}
                    {request.status === "issued" && request.certificateDocumentId && (
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={`/api/schemes/${schemeId}/documents/${request.certificateDocumentId}/content`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Certificate
                        </a>
                      </Button>
                    )}
                  </span>
                </div>
                {request.status === "preparing" && (
                  <IssueCertificateForm
                    schemeId={schemeId}
                    requestId={request.id}
                    onIssued={onChanged}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IssueCertificateForm({
  schemeId,
  requestId,
  onIssued,
}: {
  schemeId: string;
  requestId: string;
  onIssued: () => void;
}) {
  const docs = useQuery({
    queryKey: ["documents-for-certificate", schemeId],
    queryFn: () =>
      jsonRequest<{ documents: { id: string; title: string; category: string }[] }>(
        `/api/schemes/${schemeId}/documents`,
        "GET",
      ),
  });
  const [rules, setRules] = useState("");
  const [advice, setAdvice] = useState("");
  const [resolutions, setResolutions] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [works, setWorks] = useState(
    "No repairs, maintenance or other work expected to incur charges beyond amounts already budgeted or approved.",
  );
  const issue = useMutation({
    mutationFn: () =>
      jsonRequest(`/api/schemes/${schemeId}/records/certificates/${requestId}/issue`, "POST", {
        attachments: { rules, statementOfAdvice: advice, lastAgmResolutions: resolutions },
        authorisedByName: name,
        authorisedByTitle: title,
        sealAppliedAt: new Date().toISOString(),
        additionalFeeWorkDetails: works,
      }),
    onSuccess: () => {
      toast.success("Certificate issued and retained");
      onIssued();
    },
  });
  const options = docs.data?.documents ?? [];
  const picker = (label: string, value: string, set: (value: string) => void) => (
    <Field label={label}>
      {(control) => (
        <Select value={value} onValueChange={set}>
          <SelectTrigger id={control.id}>
            <SelectValue placeholder="Select filed document" />
          </SelectTrigger>
          <SelectContent>
            {options.map((doc) => (
              <SelectItem key={doc.id} value={doc.id}>
                {doc.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
  return (
    <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
      {picker("Registered rules", rules, setRules)}
      {picker("Statement of advice", advice, setAdvice)}
      {picker("Last AGM resolutions", resolutions, setResolutions)}
      <Field label="Authorised by">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Role/title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field className="sm:col-span-2" label="Additional work disclosure">
        <Textarea value={works} onChange={(e) => setWorks(e.target.value)} />
      </Field>
      {issue.error && <p className="text-sm text-critical sm:col-span-2">{issue.error.message}</p>}
      <Button
        className="sm:col-span-2 sm:w-fit"
        pending={issue.isPending}
        disabled={!rules || !advice || !resolutions || !name || !title || !works}
        onClick={() => issue.mutate()}
      >
        Apply seal record and issue
      </Button>
    </div>
  );
}
