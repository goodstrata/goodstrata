import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "../lib/api";

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

interface Budget {
  id: string;
  fiscalYearStart: string;
  status: string;
  lines: { fundKind: string; amountCents: number }[];
}
interface Schedule {
  id: string;
  frequency: string;
  instalments: number;
  firstDueOn: string;
  budgetId: string;
}
interface Notice {
  id: string;
  noticeNumber: string;
  lotId: string;
  instalment: number;
  totalCents: number;
  dueOn: string;
  status: string;
  payid: string | null;
}
interface ArrearsRow {
  lotId: string;
  lotNumber: string;
  outstandingCents: number;
  daysOverdue: number;
  stage: number;
  interestAccruedCents: number;
}

export function FinanceTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    for (const key of ["budgets", "schedules", "notices", "arrears", "decisions"]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
  };

  return (
    <div className="space-y-6">
      <BudgetsSection schemeId={schemeId} onChange={invalidate} />
      <SchedulesSection schemeId={schemeId} onChange={invalidate} />
      <NoticesSection schemeId={schemeId} onChange={invalidate} />
      <ArrearsSection schemeId={schemeId} />
    </div>
  );
}

function BudgetsSection({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data } = useQuery({
    queryKey: ["budgets", schemeId],
    queryFn: async () =>
      unwrap<{ budgets: Budget[] }>(
        await api.schemes[":schemeId"].budgets.$get({ param: { schemeId } }),
      ),
  });
  const [fyStart, setFyStart] = useState("");
  const [admin, setAdmin] = useState("");
  const [maintenance, setMaintenance] = useState("");
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].budgets.$post({
          param: { schemeId },
          json: {
            fiscalYearStart: fyStart,
            adminCents: Math.round(Number.parseFloat(admin) * 100),
            maintenanceCents: Math.round(Number.parseFloat(maintenance || "0") * 100),
          },
        }),
      ),
    onSuccess: () => {
      setFyStart("");
      setAdmin("");
      setMaintenance("");
      onChange();
    },
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-medium">Budgets</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {data?.budgets.map((b) => (
          <li key={b.id} className="flex items-center justify-between">
            <span>
              FY from {b.fiscalYearStart} —{" "}
              {b.lines.map((l) => `${l.fundKind}: ${dollars(l.amountCents)}`).join(" · ")}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                b.status === "adopted"
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {b.status.replace("_", " ")}
            </span>
          </li>
        ))}
        {data?.budgets.length === 0 && <li className="text-gray-500">No budgets yet.</li>}
      </ul>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="text-xs text-gray-500">
          FY start
          <input
            type="date"
            required
            data-testid="budget-fy"
            className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={fyStart}
            onChange={(e) => setFyStart(e.target.value)}
          />
        </label>
        <label className="text-xs text-gray-500">
          Admin fund ($/yr)
          <input
            type="number"
            min="1"
            step="0.01"
            required
            data-testid="budget-admin"
            className="mt-1 block w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
          />
        </label>
        <label className="text-xs text-gray-500">
          Maintenance fund ($/yr)
          <input
            type="number"
            min="0"
            step="0.01"
            data-testid="budget-maintenance"
            className="mt-1 block w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={maintenance}
            onChange={(e) => setMaintenance(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
        >
          Draft budget
        </button>
      </form>
      <p className="mt-1 text-xs text-gray-400">
        Drafting a budget opens a treasurer decision — see the Decisions tab.
      </p>
      {create.error && <p className="mt-1 text-sm text-red-600">{create.error.message}</p>}
    </section>
  );
}

function SchedulesSection({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data: budgets } = useQuery({
    queryKey: ["budgets", schemeId],
    queryFn: async () =>
      unwrap<{ budgets: Budget[] }>(
        await api.schemes[":schemeId"].budgets.$get({ param: { schemeId } }),
      ),
  });
  const { data } = useQuery({
    queryKey: ["schedules", schemeId],
    queryFn: async () =>
      unwrap<{ schedules: Schedule[] }>(
        await api.schemes[":schemeId"]["levy-schedules"].$get({ param: { schemeId } }),
      ),
  });
  const adopted = budgets?.budgets.filter((b) => b.status === "adopted") ?? [];
  const [budgetId, setBudgetId] = useState("");
  const [firstDueOn, setFirstDueOn] = useState("");
  const [instalment, setInstalment] = useState(1);

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"]["levy-schedules"].$post({
          param: { schemeId },
          json: { budgetId, frequency: "quarterly", firstDueOn },
        }),
      ),
    onSuccess: onChange,
  });
  const issue = useMutation({
    mutationFn: async (scheduleId: string) =>
      unwrap(
        await api.schemes[":schemeId"]["levy-schedules"][":scheduleId"].issue.$post({
          param: { schemeId, scheduleId },
          json: { instalment },
        }),
      ),
    onSuccess: onChange,
  });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-medium">Levy schedules</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {data?.schedules.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span>
              {s.frequency} × {s.instalments}, first due {s.firstDueOn}
            </span>
            <span className="flex items-center gap-2">
              <select
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={instalment}
                data-testid="issue-instalment"
                onChange={(e) => setInstalment(Number(e.target.value))}
              >
                {Array.from({ length: s.instalments }, (_, i) => (
                  <option key={`${s.id}-${i + 1}`} value={i + 1}>
                    Instalment {i + 1}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => issue.mutate(s.id)}
                disabled={issue.isPending}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-40"
              >
                Issue notices
              </button>
            </span>
          </li>
        ))}
        {data?.schedules.length === 0 && <li className="text-gray-500">No schedules yet.</li>}
      </ul>
      {issue.error && <p className="mt-1 text-sm text-red-600">{issue.error.message}</p>}

      {adopted.length > 0 && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="text-xs text-gray-500">
            Adopted budget
            <select
              required
              data-testid="schedule-budget"
              className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              value={budgetId}
              onChange={(e) => setBudgetId(e.target.value)}
            >
              <option value="">Select…</option>
              {adopted.map((b) => (
                <option key={b.id} value={b.id}>
                  FY {b.fiscalYearStart}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            First due
            <input
              type="date"
              required
              data-testid="schedule-first-due"
              className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              value={firstDueOn}
              onChange={(e) => setFirstDueOn(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending || !budgetId}
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
          >
            Create quarterly schedule
          </button>
        </form>
      )}
      {create.error && <p className="mt-1 text-sm text-red-600">{create.error.message}</p>}
    </section>
  );
}

function NoticesSection({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data } = useQuery({
    queryKey: ["notices", schemeId],
    queryFn: async () =>
      unwrap<{ notices: Notice[] }>(
        await api.schemes[":schemeId"]["levy-notices"].$get({ param: { schemeId } }),
      ),
  });
  const simulate = useMutation({
    mutationFn: async (notice: Notice) => {
      const res = await fetch("/dev/simulate-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payid: notice.payid, amountCents: notice.totalCents }),
      });
      if (!res.ok) throw new Error("Simulation failed (dev server only)");
      return res.json();
    },
    onSuccess: onChange,
  });

  if (!data || data.notices.length === 0) return null;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-medium">Levy notices</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1 pr-3">Notice</th>
            <th className="py-1 pr-3">Amount</th>
            <th className="py-1 pr-3">Due</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {data.notices.map((n) => (
            <tr key={n.id} className="border-t border-gray-100">
              <td className="py-1.5 pr-3 font-mono text-xs">{n.noticeNumber}</td>
              <td className="py-1.5 pr-3">{dollars(n.totalCents)}</td>
              <td className="py-1.5 pr-3">{n.dueOn}</td>
              <td className="py-1.5 pr-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    n.status === "paid"
                      ? "bg-green-100 text-green-800"
                      : n.status === "overdue"
                        ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {n.status.replace("_", " ")}
                </span>
              </td>
              <td className="py-1.5 text-right">
                {n.status !== "paid" && n.payid && (
                  <button
                    type="button"
                    onClick={() => simulate.mutate(n)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    title="Dev only: post a signed mock webhook"
                  >
                    Simulate payment
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ArrearsSection({ schemeId }: { schemeId: string }) {
  const { data } = useQuery({
    queryKey: ["arrears", schemeId],
    queryFn: async () =>
      unwrap<{ arrears: ArrearsRow[] }>(
        await api.schemes[":schemeId"].arrears.$get({ param: { schemeId } }),
      ),
  });
  if (!data || data.arrears.length === 0) return null;
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4">
      <h3 className="text-sm font-medium text-red-900">Arrears</h3>
      <ul className="mt-2 space-y-1 text-sm text-red-900">
        {data.arrears.map((a) => (
          <li key={a.lotId} className="flex justify-between">
            <span>
              Lot {a.lotNumber} — {a.daysOverdue} days overdue (stage {a.stage})
            </span>
            <span>
              {dollars(a.outstandingCents)} + {dollars(a.interestAccruedCents)} interest
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
