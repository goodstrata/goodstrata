import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { api, unwrap } from "@/lib/api";
import { dollars } from "@/lib/format";

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
      <ArrearsSection schemeId={schemeId} />
      <BudgetsSection schemeId={schemeId} onChange={invalidate} />
      <SchedulesSection schemeId={schemeId} onChange={invalidate} />
      <NoticesSection schemeId={schemeId} onChange={invalidate} />
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
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      setFyStart("");
      setAdmin("");
      setMaintenance("");
      toast.success("Budget drafted — a committee decision has been opened");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Budgets</CardTitle>
            <CardDescription>
              Drafting a budget opens a treasurer decision — see the Decisions tab.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="size-4" /> New budget
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Draft a budget</DialogTitle>
                <DialogDescription>
                  Annual amounts for each fund, from the fiscal year start.
                </DialogDescription>
              </DialogHeader>
              <form
                id="budget-form"
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="budget-fy">FY start</Label>
                  <Input
                    id="budget-fy"
                    type="date"
                    required
                    data-testid="budget-fy"
                    value={fyStart}
                    onChange={(e) => setFyStart(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="budget-admin">Admin fund ($/yr)</Label>
                  <Input
                    id="budget-admin"
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    data-testid="budget-admin"
                    value={admin}
                    onChange={(e) => setAdmin(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="budget-maintenance">Maintenance fund ($/yr)</Label>
                  <Input
                    id="budget-maintenance"
                    type="number"
                    min="0"
                    step="0.01"
                    data-testid="budget-maintenance"
                    value={maintenance}
                    onChange={(e) => setMaintenance(e.target.value)}
                  />
                </div>
                {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
              </form>
              <DialogFooter>
                <Button type="submit" form="budget-form" disabled={create.isPending}>
                  Draft budget
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!data && <Skeleton className="h-10" />}
        <ul className="space-y-2.5 text-sm">
          {data?.budgets.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                FY from {b.fiscalYearStart} —{" "}
                {b.lines.map((l) => `${l.fundKind}: ${dollars(l.amountCents)}`).join(" · ")}
              </span>
              <StatusBadge status={b.status} />
            </li>
          ))}
          {data?.budgets.length === 0 && <li className="text-muted-foreground">No budgets yet.</li>}
        </ul>
      </CardContent>
    </Card>
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
  const [open, setOpen] = useState(false);
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
    onSuccess: () => {
      setOpen(false);
      toast.success("Levy schedule created");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });
  const issue = useMutation({
    mutationFn: async (scheduleId: string) =>
      unwrap(
        await api.schemes[":schemeId"]["levy-schedules"][":scheduleId"].issue.$post({
          param: { schemeId, scheduleId },
          json: { instalment },
        }),
      ),
    onSuccess: () => {
      toast.success("Levy notices issued to all lots");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Levy schedules</CardTitle>
            <CardDescription>
              Split an adopted budget into instalments and issue notices.
            </CardDescription>
          </div>
          {adopted.length > 0 && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="size-4" /> New schedule
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Create a levy schedule</DialogTitle>
                  <DialogDescription>
                    Quarterly instalments across the fiscal year.
                  </DialogDescription>
                </DialogHeader>
                <form
                  id="schedule-form"
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    create.mutate();
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    <Label>Adopted budget</Label>
                    <Select value={budgetId} onValueChange={setBudgetId}>
                      <SelectTrigger className="w-full" data-testid="schedule-budget">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {adopted.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            FY {b.fiscalYearStart}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="schedule-first-due">First due</Label>
                    <Input
                      id="schedule-first-due"
                      type="date"
                      required
                      data-testid="schedule-first-due"
                      value={firstDueOn}
                      onChange={(e) => setFirstDueOn(e.target.value)}
                    />
                  </div>
                  {create.error && (
                    <p className="text-sm text-destructive">{create.error.message}</p>
                  )}
                </form>
                <DialogFooter>
                  <Button
                    type="submit"
                    form="schedule-form"
                    disabled={create.isPending || !budgetId}
                  >
                    Create quarterly schedule
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!data && <Skeleton className="h-10" />}
        <ul className="space-y-3 text-sm">
          {data?.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {s.frequency} × {s.instalments}, first due {s.firstDueOn}
              </span>
              <span className="flex items-center gap-2">
                <Select value={String(instalment)} onValueChange={(v) => setInstalment(Number(v))}>
                  <SelectTrigger size="sm" data-testid="issue-instalment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: s.instalments }, (_, i) => (
                      <SelectItem key={`${s.id}-${i + 1}`} value={String(i + 1)}>
                        Instalment {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => issue.mutate(s.id)} disabled={issue.isPending}>
                  Issue notices
                </Button>
              </span>
            </li>
          ))}
          {data?.schedules.length === 0 && (
            <li className="text-muted-foreground">No schedules yet.</li>
          )}
        </ul>
        {issue.error && <p className="mt-2 text-sm text-destructive">{issue.error.message}</p>}
      </CardContent>
    </Card>
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
    onSuccess: () => {
      toast.success("Payment received");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!data || data.notices.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Levy notices</CardTitle>
        <CardDescription>Issued to each lot with a unique PayID.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Notice</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.notices.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="pl-6 font-mono text-xs">{n.noticeNumber}</TableCell>
                  <TableCell className="tabular-nums">{dollars(n.totalCents)}</TableCell>
                  <TableCell>{n.dueOn}</TableCell>
                  <TableCell>
                    <StatusBadge status={n.status} />
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {n.status !== "paid" && n.payid && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => simulate.mutate(n)}
                        title="Dev only: post a signed mock webhook"
                      >
                        Simulate payment
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
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
    <Card className="border-red-200 bg-red-50/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-900">
          <AlertTriangle className="size-4" /> Arrears
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-red-900">
          {data.arrears.map((a) => (
            <li key={a.lotId} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Lot {a.lotNumber} — {a.daysOverdue} days overdue (stage {a.stage})
              </span>
              <span className="font-medium tabular-nums">
                {dollars(a.outstandingCents)} + {dollars(a.interestAccruedCents)} interest
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
