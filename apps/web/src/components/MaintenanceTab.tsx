import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Wrench } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { dollars } from "@/lib/format";

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

export function MaintenanceTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    for (const key of ["maintenance", "work-orders", "contractors", "decisions"]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
  };

  return (
    <div className="space-y-6">
      <RequestList schemeId={schemeId} onChange={invalidate} />
      <WorkOrderList schemeId={schemeId} onChange={invalidate} />
      <ContractorSection schemeId={schemeId} onChange={invalidate} />
    </div>
  );
}

function ReportIssueDialog({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      setTitle("");
      setDescription("");
      toast.success("Request submitted — the maintenance agent will triage it");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Report issue
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a maintenance issue</DialogTitle>
          <DialogDescription>
            The maintenance agent triages every report automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          id="mr-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mr-title">Title</Label>
            <Input
              id="mr-title"
              data-testid="mr-title"
              placeholder="What's the problem? (e.g. Water stain on ceiling)"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mr-description">Description</Label>
            <Textarea
              id="mr-description"
              data-testid="mr-description"
              className="h-24"
              placeholder="Describe it — where, since when, how bad."
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="mr-form" disabled={create.isPending}>
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestList({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data } = useQuery({
    queryKey: ["maintenance", schemeId],
    queryFn: async () =>
      unwrap<{ requests: Request[] }>(
        await api.schemes[":schemeId"].maintenance.$get({ param: { schemeId } }),
      ),
    refetchInterval: 3000,
  });

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Requests</h3>
          <p className="text-sm text-muted-foreground">
            Maintenance reports from residents and owners.
          </p>
        </div>
        <ReportIssueDialog schemeId={schemeId} onChange={onChange} />
      </div>
      <div className="mt-4 space-y-2.5">
        {!data && <Skeleton className="h-24" />}
        {data?.requests.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No maintenance requests yet.
          </p>
        )}
        {data?.requests.map((r) => (
          <Card key={r.id} data-testid={`mr-${r.title}`} className="py-4">
            <CardContent className="px-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{r.title}</p>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
              {r.category && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="size-3.5 text-purple-600" />
                  triaged: <b className="text-foreground">{r.category}</b> · {r.urgency} ·{" "}
                  {r.isCommonProperty ? "common property" : "lot responsibility"}
                </p>
              )}
            </CardContent>
          </Card>
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
    onSuccess: () => {
      toast.success("Work order completed");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!data || data.workOrders.length === 0) return null;
  return (
    <section>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Wrench className="size-4 text-muted-foreground" /> Work orders
      </h3>
      <div className="mt-3 space-y-2.5">
        {data.workOrders.map((wo) => (
          <Card key={wo.id} className="py-3">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 text-sm">
              <div className="min-w-0">
                <p>{wo.scope}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {dollars(wo.approvedAmountCents)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={wo.status} />
                {["dispatched", "accepted", "scheduled", "in_progress"].includes(wo.status) && (
                  <Button variant="outline" size="sm" onClick={() => complete.mutate(wo.id)}>
                    Mark completed
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
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
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      setBusinessName("");
      setEmail("");
      setTrades("");
      toast.success("Contractor added to the pool");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Contractor pool</CardTitle>
            <CardDescription>The dispatch agent quotes jobs against these trades.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="size-4" /> New contractor
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Add a contractor</DialogTitle>
                <DialogDescription>Your regular trades, ready for dispatch.</DialogDescription>
              </DialogHeader>
              <form
                id="contractor-form"
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contractor-name">Business name</Label>
                  <Input
                    id="contractor-name"
                    data-testid="contractor-name"
                    placeholder="Business name"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contractor-email">Email</Label>
                  <Input
                    id="contractor-email"
                    data-testid="contractor-email"
                    placeholder="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contractor-trades">Trades</Label>
                  <Input
                    id="contractor-trades"
                    data-testid="contractor-trades"
                    placeholder="Trades (comma-separated)"
                    required
                    value={trades}
                    onChange={(e) => setTrades(e.target.value)}
                  />
                </div>
                {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
              </form>
              <DialogFooter>
                <Button type="submit" form="contractor-form" disabled={create.isPending}>
                  Add contractor
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!data && <Skeleton className="h-10" />}
        <ul className="space-y-2.5 text-sm">
          {data?.contractors.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{c.businessName}</span>
              <span className="text-muted-foreground">{c.tradeCategories.join(", ")}</span>
            </li>
          ))}
          {data?.contractors.length === 0 && (
            <li className="text-muted-foreground">No contractors yet — add your regulars.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
