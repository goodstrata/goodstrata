import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "../lib/api";

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

interface Request {
  id: string;
  title: string;
  description: string;
  category: string | null;
  urgency: string | null;
  isCommonProperty: boolean | null;
  status: string;
  createdAt: string;
}
interface WorkOrder {
  id: string;
  scope: string;
  approvedAmountCents: number;
  status: string;
  contractorId: string;
}
interface Contractor {
  id: string;
  businessName: string;
  tradeCategories: string[];
  email: string | null;
}

const STATUS_COLOURS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800",
  triaged: "bg-indigo-100 text-indigo-800",
  quoting: "bg-amber-100 text-amber-800",
  approved: "bg-teal-100 text-teal-800",
  completed: "bg-green-100 text-green-800",
  rejected: "bg-gray-200 text-gray-600",
  dispatched: "bg-teal-100 text-teal-800",
  draft: "bg-amber-100 text-amber-800",
};

export function MaintenanceTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    for (const key of ["maintenance", "work-orders", "contractors", "decisions"]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
  };

  return (
    <div className="space-y-6">
      <RequestForm schemeId={schemeId} onChange={invalidate} />
      <RequestList schemeId={schemeId} />
      <WorkOrderList schemeId={schemeId} onChange={invalidate} />
      <ContractorSection schemeId={schemeId} onChange={invalidate} />
    </div>
  );
}

function RequestForm({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].maintenance.$post({
          param: { schemeId },
          json: { title, description },
        }),
      ),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      onChange();
    },
  });

  return (
    <form
      className="rounded-lg border border-gray-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h3 className="text-sm font-medium">Report a maintenance issue</h3>
      <input
        data-testid="mr-title"
        className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        placeholder="What's the problem? (e.g. Water stain on ceiling)"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        data-testid="mr-description"
        className="mt-2 h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        placeholder="Describe it — where, since when, how bad. The maintenance agent triages this automatically."
        required
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
      <button
        type="submit"
        disabled={create.isPending}
        className="mt-2 rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
      >
        Submit request
      </button>
    </form>
  );
}

function RequestList({ schemeId }: { schemeId: string }) {
  const { data } = useQuery({
    queryKey: ["maintenance", schemeId],
    queryFn: async () =>
      unwrap<{ requests: Request[] }>(
        await api.schemes[":schemeId"].maintenance.$get({ param: { schemeId } }),
      ),
    refetchInterval: 3000,
  });
  if (!data || data.requests.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Requests</h3>
      <div className="mt-2 space-y-2">
        {data.requests.map((r) => (
          <div
            key={r.id}
            data-testid={`mr-${r.title}`}
            className="rounded-lg border border-gray-200 bg-white px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{r.title}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLOURS[r.status] ?? "bg-gray-100 text-gray-700"}`}
              >
                {r.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">{r.description}</p>
            {r.category && (
              <p className="mt-1.5 text-xs text-gray-600">
                🤖 triaged: <b>{r.category}</b> · {r.urgency} ·{" "}
                {r.isCommonProperty ? "common property" : "lot responsibility"}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkOrderList({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data } = useQuery({
    queryKey: ["work-orders", schemeId],
    queryFn: async () =>
      unwrap<{ workOrders: WorkOrder[] }>(
        await api.schemes[":schemeId"]["work-orders"].$get({ param: { schemeId } }),
      ),
    refetchInterval: 3000,
  });
  const complete = useMutation({
    mutationFn: async (workOrderId: string) =>
      unwrap(
        await api.schemes[":schemeId"]["work-orders"][":workOrderId"].complete.$post({
          param: { schemeId, workOrderId },
        }),
      ),
    onSuccess: onChange,
  });

  if (!data || data.workOrders.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Work orders</h3>
      <div className="mt-2 space-y-2">
        {data.workOrders.map((wo) => (
          <div
            key={wo.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm"
          >
            <div>
              <p>{wo.scope}</p>
              <p className="text-xs text-gray-500">{dollars(wo.approvedAmountCents)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLOURS[wo.status] ?? "bg-gray-100 text-gray-700"}`}
              >
                {wo.status}
              </span>
              {["dispatched", "accepted", "scheduled", "in_progress"].includes(wo.status) && (
                <button
                  type="button"
                  onClick={() => complete.mutate(wo.id)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                >
                  Mark completed
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContractorSection({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data } = useQuery({
    queryKey: ["contractors", schemeId],
    queryFn: async () =>
      unwrap<{ contractors: Contractor[] }>(
        await api.schemes[":schemeId"].contractors.$get({ param: { schemeId } }),
      ),
  });
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [trades, setTrades] = useState("");
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].contractors.$post({
          param: { schemeId },
          json: {
            businessName,
            email: email || undefined,
            tradeCategories: trades
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          },
        }),
      ),
    onSuccess: () => {
      setBusinessName("");
      setEmail("");
      setTrades("");
      onChange();
    },
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-medium">Contractor pool</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {data?.contractors.map((c) => (
          <li key={c.id} className="flex justify-between">
            <span>{c.businessName}</span>
            <span className="text-gray-500">{c.tradeCategories.join(", ")}</span>
          </li>
        ))}
        {data?.contractors.length === 0 && (
          <li className="text-gray-500">No contractors yet — add your regulars below.</li>
        )}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input
          data-testid="contractor-name"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          placeholder="Business name"
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <input
          data-testid="contractor-email"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          data-testid="contractor-trades"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          placeholder="Trades (comma-separated)"
          required
          value={trades}
          onChange={(e) => setTrades(e.target.value)}
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
        >
          Add contractor
        </button>
      </form>
      {create.error && <p className="mt-1 text-sm text-red-600">{create.error.message}</p>}
    </section>
  );
}
