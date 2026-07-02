import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Check, CircleCheck, FileText, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AgentsTab } from "@/components/AgentsTab";
import { DecisionsTab } from "@/components/DecisionsTab";
import { FinanceTab } from "@/components/FinanceTab";
import { MaintenanceTab } from "@/components/MaintenanceTab";
import { MeetingsTab } from "@/components/MeetingsTab";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/schemes/$schemeId")({
  component: SchemePage,
});

const TABS = [
  "overview",
  "finance",
  "maintenance",
  "meetings",
  "decisions",
  "agents",
  "lots",
  "people",
  "committee",
  "documents",
  "activity",
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  finance: "Finance",
  maintenance: "Maintenance",
  meetings: "Meetings",
  decisions: "Decisions",
  agents: "Agents",
  lots: "Lots",
  people: "People",
  committee: "Committee",
  documents: "Documents",
  activity: "Activity",
};

function SchemePage() {
  const { schemeId } = Route.useParams();
  const [tab, setTab] = useState<Tab>("overview");
  const { data } = useQuery({
    queryKey: ["scheme", schemeId],
    queryFn: async () =>
      unwrap<{
        scheme: { name: string; planOfSubdivision: string; status: string; tier: number };
        roles: string[];
      }>(await api.schemes[":schemeId"].$get({ param: { schemeId } })),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {data ? (
            <h1 className="text-2xl font-semibold tracking-tight">{data.scheme.name}</h1>
          ) : (
            <Skeleton className="h-8 w-72" />
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {data
              ? `${data.scheme.planOfSubdivision} · Tier ${data.scheme.tier} · your roles: ${data.roles
                  .map((r) => r.replace(/_/g, " "))
                  .join(", ")}`
              : " "}
          </p>
        </div>
        {data && <StatusBadge status={data.scheme.status} className="mt-1.5" />}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
          <TabsList className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="pt-4">
          {tab === "overview" && <OverviewTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="finance" className="pt-4">
          {tab === "finance" && <FinanceTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="maintenance" className="pt-4">
          {tab === "maintenance" && <MaintenanceTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="meetings" className="pt-4">
          {tab === "meetings" && <MeetingsTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="decisions" className="pt-4">
          {tab === "decisions" && <DecisionsTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="agents" className="pt-4">
          {tab === "agents" && <AgentsTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="lots" className="pt-4">
          {tab === "lots" && <LotsTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="people" className="pt-4">
          {tab === "people" && <PeopleTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="committee" className="pt-4">
          {tab === "committee" && <CommitteeTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="documents" className="pt-4">
          {tab === "documents" && <DocumentsTab schemeId={schemeId} />}
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          {tab === "activity" && <ActivityTab schemeId={schemeId} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OverviewTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["onboarding", schemeId],
    queryFn: async () =>
      unwrap<{ hasLots: boolean; hasInsurance: boolean; ready: boolean; status: string }>(
        await api.schemes[":schemeId"].onboarding.$get({ param: { schemeId } }),
      ),
  });
  const activate = useMutation({
    mutationFn: async () =>
      unwrap(await api.schemes[":schemeId"].activate.$post({ param: { schemeId } })),
    onSuccess: () => {
      toast.success("Scheme activated — agents are watching the event bus");
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!data) return <Skeleton className="h-48 max-w-xl" />;

  const item = (done: boolean, label: string) => (
    <li className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded-full",
          done ? "bg-green-600 text-white" : "border border-border bg-muted",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </li>
  );

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Onboarding checklist</CardTitle>
        <CardDescription>
          Everything a compliant owners corporation needs before going live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3 text-sm" data-testid="onboarding-checklist">
          {item(true, "Scheme registered")}
          {item(data.hasLots, "Lots imported from plan of subdivision")}
          {item(data.hasInsurance, "Insurance certificate of currency uploaded")}
        </ul>
        {data.status !== "active" && (
          <Button
            className="mt-6"
            disabled={!data.ready || activate.isPending}
            onClick={() => activate.mutate()}
          >
            Activate scheme
          </Button>
        )}
        {activate.error && (
          <p className="mt-2 text-sm text-destructive">{activate.error.message}</p>
        )}
        {data.status === "active" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-green-700">
            <CircleCheck className="size-4" />
            This owners corporation is active. Agents are watching the event bus.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

interface LotRow {
  id: string;
  lotNumber: string;
  unitNumber: string | null;
  lotType: string;
  entitlement: number;
  liability: number;
  owners: {
    personId: string;
    givenName: string | null;
    familyName: string | null;
    email: string | null;
  }[];
}

const SAMPLE_CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,commercial,Sam Shopkeeper,sam@example.com
2,10,10,residential,Alex Owner,alex@example.com`;

function LotsTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["lots", schemeId],
    queryFn: async () =>
      unwrap<{ lots: LotRow[] }>(await api.schemes[":schemeId"].lots.$get({ param: { schemeId } })),
  });
  const [csv, setCsv] = useState("");
  const importMutation = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].lots.import.$post({ param: { schemeId }, json: { csv } }),
      ),
    onSuccess: () => {
      setCsv("");
      toast.success("Lots imported");
      void queryClient.invalidateQueries({ queryKey: ["lots", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {!data && <Skeleton className="h-40" />}
      {data && data.lots.length > 0 ? (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Entitlement</TableHead>
                  <TableHead className="text-right">Liability</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.lots]
                  .sort((a, b) =>
                    a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true }),
                  )
                  .map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell className="font-medium">{lot.lotNumber}</TableCell>
                      <TableCell className="capitalize">{lot.lotType}</TableCell>
                      <TableCell className="text-right tabular-nums">{lot.entitlement}</TableCell>
                      <TableCell className="text-right tabular-nums">{lot.liability}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {lot.owners
                          .map(
                            (o) => `${o.givenName ?? ""} ${o.familyName ?? ""}`.trim() || o.email,
                          )
                          .join(", ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : (
        data && (
          <p className="text-sm text-muted-foreground">
            No lots yet — import the plan of subdivision.
          </p>
        )
      )}

      <Card>
        <CardHeader>
          <CardTitle>Import lots (CSV)</CardTitle>
          <CardDescription>
            Columns: lot_number, entitlement, liability[, lot_type, unit_number, owner_name,
            owner_email]
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            data-testid="csv-input"
            className="h-36 font-mono text-xs"
            placeholder={SAMPLE_CSV}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          {importMutation.error && (
            <p className="mt-2 text-sm text-destructive">{importMutation.error.message}</p>
          )}
          <Button
            className="mt-4"
            disabled={!csv || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? "Importing…" : "Import lots"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PersonRow {
  id: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  userId: string | null;
  pendingInvite: boolean;
}

function PeopleTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["people", schemeId],
    queryFn: async () =>
      unwrap<{ people: PersonRow[] }>(
        await api.schemes[":schemeId"].people.$get({ param: { schemeId } }),
      ),
  });
  const invite = useMutation({
    mutationFn: async (personId: string) =>
      unwrap(
        await api.schemes[":schemeId"].people[":personId"].invite.$post({
          param: { schemeId, personId },
          json: { role: "owner" },
        }),
      ),
    onSuccess: () => {
      toast.success("Invite sent");
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!data) return <Skeleton className="h-40 max-w-2xl" />;

  return (
    <div className="max-w-2xl space-y-2">
      {data.people.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No people yet — owners appear here when you import lots.
        </p>
      )}
      {data.people.map((p) => (
        <Card key={p.id} data-testid={`person-${p.email ?? p.id}`} className="py-3">
          <CardContent className="flex items-center justify-between gap-3 px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {`${p.givenName ?? ""} ${p.familyName ?? ""}`.trim() || p.email || "Unnamed"}
              </p>
              <p className="truncate text-xs text-muted-foreground">{p.email ?? "no email"}</p>
            </div>
            {p.userId ? (
              <StatusBadge status="joined" />
            ) : p.pendingInvite ? (
              <StatusBadge status="invited" />
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!p.email || invite.isPending}
                onClick={() => invite.mutate(p.id)}
              >
                Invite
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
      {invite.error && <p className="text-sm text-destructive">{invite.error.message}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CommitteeTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data: committee } = useQuery({
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
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"chair" | "secretary" | "treasurer" | "committee_member">(
    "chair",
  );
  const assign = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].committee.$post({
          param: { schemeId },
          json: { userId, role },
        }),
      ),
    onSuccess: () => {
      toast.success("Committee role assigned");
      void queryClient.invalidateQueries({ queryKey: ["committee", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const nameFor = (id: string) => members?.members.find((m) => m.userId === id)?.name ?? id;
  const officers =
    committee?.committee.filter((m) => m.role !== "owner" && m.role !== "tenant") ?? [];

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current committee</CardTitle>
          <CardDescription>Office holders for this owners corporation.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5 text-sm" data-testid="committee-list">
            {officers.length === 0 && (
              <li className="text-muted-foreground">No committee roles assigned yet.</li>
            )}
            {officers.map((m) => (
              <li key={`${m.userId}-${m.role}`} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <User className="size-4 text-muted-foreground" />
                  {nameFor(m.userId)}
                </span>
                <Badge variant="secondary" className="bg-brand-50 text-brand-800">
                  {m.role.replace("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign role</CardTitle>
          <CardDescription>Appoint a member as an office holder.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Member</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="w-full" data-testid="committee-member">
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger className="w-full sm:w-48" data-testid="committee-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chair">Chair</SelectItem>
                  <SelectItem value="secretary">Secretary</SelectItem>
                  <SelectItem value="treasurer">Treasurer</SelectItem>
                  <SelectItem value="committee_member">Committee member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!userId || assign.isPending} onClick={() => assign.mutate()}>
              Assign
            </Button>
          </div>
          {assign.error && <p className="mt-2 text-sm text-destructive">{assign.error.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DocumentsTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["documents", schemeId],
    queryFn: async () =>
      unwrap<{ documents: { id: string; title: string; category: string; createdAt: string }[] }>(
        await api.schemes[":schemeId"].documents.$get({ param: { schemeId }, query: {} }),
      ),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("insurance");
  const upload = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("Choose a file first");
      const form = new FormData();
      form.set("file", file);
      form.set("category", category);
      const res = await fetch(`/api/schemes/${schemeId}/documents`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      return unwrap(res);
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Document uploaded");
      void queryClient.invalidateQueries({ queryKey: ["documents", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload document</CardTitle>
          <CardDescription>
            Insurance certificates, plans, rules and minutes live here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input ref={fileRef} type="file" data-testid="doc-file" className="sm:flex-1" />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-52" data-testid="doc-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="plan_of_subdivision">Plan of subdivision</SelectItem>
                <SelectItem value="rules">Rules</SelectItem>
                <SelectItem value="financial">Financial</SelectItem>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Button disabled={upload.isPending} onClick={() => upload.mutate()}>
              Upload
            </Button>
          </div>
          {upload.error && <p className="mt-2 text-sm text-destructive">{upload.error.message}</p>}
        </CardContent>
      </Card>

      {!data && <Skeleton className="h-24" />}
      {data && data.documents.length > 0 && (
        <div className="space-y-2">
          {data.documents.map((d) => (
            <Card key={d.id} className="py-3">
              <CardContent className="flex items-center justify-between gap-3 px-4">
                <span className="flex min-w-0 items-center gap-2.5 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{d.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge variant="secondary">{d.category.replace(/_/g, " ")}</Badge>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {formatDate(d.createdAt)}
                  </span>
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {data && data.documents.length === 0 && (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DomainEvent {
  id: string;
  seq: number;
  type: string;
  stream: string;
  payload: unknown;
  actor: { kind: string; id: string };
  occurredAt: string;
}

function ActorBadge({ actor }: { actor: DomainEvent["actor"] }) {
  if (actor.kind === "agent") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 gap-1 border-purple-200 bg-purple-50 text-purple-700"
      >
        <Bot className="size-3" /> {actor.id}
      </Badge>
    );
  }
  if (actor.kind === "user") {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 border-blue-200 bg-blue-50 text-blue-700">
        <User className="size-3" /> user
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-muted-foreground">
      {actor.kind}
    </Badge>
  );
}

function ActivityTab({ schemeId }: { schemeId: string }) {
  const events = useEventStream(schemeId);
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Live event feed — every domain event on this scheme's bus, as it happens.
      </p>
      <ol className="relative mt-4 space-y-0 border-l border-border pl-6" data-testid="event-feed">
        {events.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">Waiting for events…</li>
        )}
        {events.map((evt) => (
          <li key={evt.id} className="relative pb-5 last:pb-0">
            <span
              className={cn(
                "absolute top-1.5 -left-[30px] size-2.5 rounded-full ring-4 ring-background",
                evt.actor.kind === "agent" ? "bg-purple-400" : "bg-brand-600",
              )}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-sm font-medium">{evt.type}</span>
              <ActorBadge actor={evt.actor} />
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                #{evt.seq} · {formatTime(evt.occurredAt)}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Live event feed over SSE with automatic resume (Last-Event-ID = seq). */
function useEventStream(schemeId: string): DomainEvent[] {
  const [events, setEvents] = useState<DomainEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    const source = new EventSource(`/api/schemes/${schemeId}/stream`);
    source.addEventListener("domain-event", (e) => {
      const evt = JSON.parse((e as MessageEvent).data) as DomainEvent;
      setEvents((prev) =>
        prev.some((p) => p.id === evt.id) ? prev : [evt, ...prev].slice(0, 100),
      );
    });
    return () => source.close();
  }, [schemeId]);

  return events;
}
