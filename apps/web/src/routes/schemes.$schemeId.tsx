import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, unwrap } from "../lib/api";

export const Route = createFileRoute("/schemes/$schemeId")({
  component: SchemePage,
});

const TABS = ["overview", "lots", "people", "committee", "documents", "activity"] as const;
type Tab = (typeof TABS)[number];

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
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{data?.scheme.name ?? "…"}</h1>
          <p className="text-sm text-gray-500">
            {data?.scheme.planOfSubdivision} · Tier {data?.scheme.tier} · your roles:{" "}
            {data?.roles.join(", ")}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            data?.scheme.status === "active"
              ? "bg-green-100 text-green-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {data?.scheme.status}
        </span>
      </div>

      <nav className="mt-4 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t-md px-3 py-2 text-sm capitalize ${
              tab === t
                ? "border border-b-0 border-gray-200 bg-white font-medium text-brand-700"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="pt-4">
        {tab === "overview" && <OverviewTab schemeId={schemeId} />}
        {tab === "lots" && <LotsTab schemeId={schemeId} />}
        {tab === "people" && <PeopleTab schemeId={schemeId} />}
        {tab === "committee" && <CommitteeTab schemeId={schemeId} />}
        {tab === "documents" && <DocumentsTab schemeId={schemeId} />}
        {tab === "activity" && <ActivityTab schemeId={schemeId} />}
      </div>
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
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
    },
  });

  if (!data) return <p className="text-gray-500">Loading…</p>;

  const item = (done: boolean, label: string) => (
    <li className="flex items-center gap-2">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs text-white ${done ? "bg-green-600" : "bg-gray-300"}`}
      >
        {done ? "✓" : ""}
      </span>
      <span className={done ? "text-gray-800" : "text-gray-500"}>{label}</span>
    </li>
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium">Onboarding checklist</h2>
      <ul className="mt-3 space-y-2 text-sm" data-testid="onboarding-checklist">
        {item(true, "Scheme registered")}
        {item(data.hasLots, "Lots imported from plan of subdivision")}
        {item(data.hasInsurance, "Insurance certificate of currency uploaded")}
      </ul>
      {data.status !== "active" && (
        <button
          type="button"
          disabled={!data.ready || activate.isPending}
          onClick={() => activate.mutate()}
          className="mt-4 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
        >
          Activate scheme
        </button>
      )}
      {activate.error && <p className="mt-2 text-sm text-red-600">{activate.error.message}</p>}
      {data.status === "active" && (
        <p className="mt-4 text-sm text-green-700">
          This owners corporation is active. Agents are watching the event bus.
        </p>
      )}
    </div>
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
      void queryClient.invalidateQueries({ queryKey: ["lots", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
    },
  });

  return (
    <div className="space-y-4">
      {data && data.lots.length > 0 ? (
        <table className="w-full rounded-lg border border-gray-200 bg-white text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-3 py-2">Lot</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Entitlement</th>
              <th className="px-3 py-2">Liability</th>
              <th className="px-3 py-2">Owner</th>
            </tr>
          </thead>
          <tbody>
            {data.lots.map((lot) => (
              <tr key={lot.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 font-medium">{lot.lotNumber}</td>
                <td className="px-3 py-2">{lot.lotType}</td>
                <td className="px-3 py-2">{lot.entitlement}</td>
                <td className="px-3 py-2">{lot.liability}</td>
                <td className="px-3 py-2 text-gray-600">
                  {lot.owners
                    .map((o) => `${o.givenName ?? ""} ${o.familyName ?? ""}`.trim() || o.email)
                    .join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-gray-500">No lots yet — import the plan of subdivision.</p>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium">Import lots (CSV)</h3>
        <p className="mt-1 text-xs text-gray-500">
          Columns: lot_number, entitlement, liability[, lot_type, unit_number, owner_name,
          owner_email]
        </p>
        <textarea
          data-testid="csv-input"
          className="mt-2 h-36 w-full rounded-md border border-gray-300 p-2 font-mono text-xs"
          placeholder={SAMPLE_CSV}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        {importMutation.error && (
          <p className="text-sm text-red-600">{importMutation.error.message}</p>
        )}
        <button
          type="button"
          disabled={!csv || importMutation.isPending}
          onClick={() => importMutation.mutate()}
          className="mt-2 rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {importMutation.isPending ? "Importing…" : "Import lots"}
        </button>
      </div>
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["people", schemeId] }),
  });

  return (
    <div className="space-y-2">
      {data?.people.length === 0 && (
        <p className="text-sm text-gray-500">
          No people yet — owners appear here when you import lots.
        </p>
      )}
      {data?.people.map((p) => (
        <div
          key={p.id}
          data-testid={`person-${p.email ?? p.id}`}
          className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium">
              {`${p.givenName ?? ""} ${p.familyName ?? ""}`.trim() || p.email || "Unnamed"}
            </p>
            <p className="text-xs text-gray-500">{p.email ?? "no email"}</p>
          </div>
          {p.userId ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
              joined
            </span>
          ) : p.pendingInvite ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              invited
            </span>
          ) : (
            <button
              type="button"
              disabled={!p.email || invite.isPending}
              onClick={() => invite.mutate(p.id)}
              className="rounded-md border border-brand-600 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
            >
              Invite
            </button>
          )}
        </div>
      ))}
      {invite.error && <p className="text-sm text-red-600">{invite.error.message}</p>}
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["committee", schemeId] }),
  });

  const nameFor = (id: string) => members?.members.find((m) => m.userId === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium">Current committee</h3>
        <ul className="mt-2 space-y-1 text-sm" data-testid="committee-list">
          {committee?.committee
            .filter((m) => m.role !== "owner" && m.role !== "tenant")
            .map((m) => (
              <li key={`${m.userId}-${m.role}`} className="flex justify-between">
                <span>{nameFor(m.userId)}</span>
                <span className="text-gray-500">{m.role.replace("_", " ")}</span>
              </li>
            ))}
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium">Assign role</h3>
        <div className="mt-2 flex gap-2">
          <select
            className="flex-1 rounded-md border border-gray-300 px-2 py-2 text-sm"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Select member…</option>
            {members?.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-gray-300 px-2 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="chair">Chair</option>
            <option value="secretary">Secretary</option>
            <option value="treasurer">Treasurer</option>
            <option value="committee_member">Committee member</option>
          </select>
          <button
            type="button"
            disabled={!userId || assign.isPending}
            onClick={() => assign.mutate()}
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
          >
            Assign
          </button>
        </div>
        {assign.error && <p className="mt-2 text-sm text-red-600">{assign.error.message}</p>}
      </div>
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
      void queryClient.invalidateQueries({ queryKey: ["documents", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium">Upload document</h3>
        <div className="mt-2 flex items-center gap-2">
          <input ref={fileRef} type="file" data-testid="doc-file" className="text-sm" />
          <select
            className="rounded-md border border-gray-300 px-2 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="insurance">Insurance</option>
            <option value="plan_of_subdivision">Plan of subdivision</option>
            <option value="rules">Rules</option>
            <option value="financial">Financial</option>
            <option value="minutes">Minutes</option>
            <option value="other">Other</option>
          </select>
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => upload.mutate()}
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
          >
            Upload
          </button>
        </div>
        {upload.error && <p className="mt-2 text-sm text-red-600">{upload.error.message}</p>}
      </div>

      <ul className="space-y-1">
        {data?.documents.map((d) => (
          <li
            key={d.id}
            className="flex justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <span>{d.title}</span>
            <span className="text-gray-500">{d.category}</span>
          </li>
        ))}
      </ul>
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

function ActivityTab({ schemeId }: { schemeId: string }) {
  const events = useEventStream(schemeId);
  return (
    <ul className="space-y-1.5" data-testid="event-feed">
      {events.length === 0 && <li className="text-sm text-gray-400">Waiting for events…</li>}
      {events.map((evt) => (
        <li
          key={evt.id}
          className="flex items-baseline gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <span className="shrink-0 font-mono text-xs text-gray-400">#{evt.seq}</span>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
              evt.actor.kind === "agent"
                ? "bg-purple-100 text-purple-700"
                : evt.actor.kind === "user"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-600"
            }`}
          >
            {evt.actor.kind === "agent" ? `🤖 ${evt.actor.id}` : evt.actor.kind}
          </span>
          <span className="font-medium">{evt.type}</span>
          <span className="ml-auto shrink-0 text-xs text-gray-400">
            {new Date(evt.occurredAt).toLocaleTimeString()}
          </span>
        </li>
      ))}
    </ul>
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
