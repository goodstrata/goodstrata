import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface Appointment {
  id: string;
  status: "draft" | "active" | "expired" | "terminated";
  startsOn: string;
  endsOn: string;
  approvedFormName: string;
  approvedFormVersion: string;
  delegatedPowers: string[];
  changeNotifiedAt: string | null;
}
interface DocumentRow {
  id: string;
  title: string;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  credentials: "include",
  headers: body ? { "content-type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

export function AppointmentSection({ schemeId }: { schemeId: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const appointments = useQuery({
    queryKey: ["manager-appointments", schemeId],
    queryFn: async () =>
      unwrap<{ appointments: Appointment[] }>(
        await fetch(`/api/schemes/${schemeId}/manager/appointments`, { credentials: "include" }),
      ),
  });
  const action = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "activate" | "notify" }) =>
      unwrap(await fetch(`/api/schemes/${schemeId}/manager/appointments/${id}/${action}`, post())),
    onSuccess: () => {
      toast.success("Appointment updated");
      void qc.invalidateQueries({ queryKey: ["manager-appointments", schemeId] });
    },
  });
  const list = appointments.data?.appointments ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appointment and delegation</CardTitle>
        <CardDescription>
          Approved-form appointment, ordinary-resolution authority, delegated powers and the
          statutory term limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title="No appointment instrument"
            description="Record the appointment and delegation before enabling registered-manager mode."
          />
        ) : (
          list.map((item) => (
            <div key={item.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{item.approvedFormName}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(item.startsOn)}–{formatDate(item.endsOn)} ·{" "}
                    {item.approvedFormVersion}
                  </p>
                </div>
                <Badge variant={item.status === "active" ? "default" : "outline"}>
                  {item.status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {item.delegatedPowers.length} delegated powers · owner change notice{" "}
                {item.changeNotifiedAt ? "sent" : "not sent"}
              </p>
              <div className="flex gap-2">
                {item.status === "draft" && (
                  <Button
                    size="sm"
                    onClick={() => action.mutate({ id: item.id, action: "activate" })}
                  >
                    Activate after eligibility check
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => action.mutate({ id: item.id, action: "notify" })}
                >
                  Notify owners
                </Button>
              </div>
            </div>
          ))
        )}
        <Button variant="outline" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close" : "Record appointment"}
        </Button>
        {showForm && <AppointmentForm schemeId={schemeId} />}
      </CardContent>
    </Card>
  );
}

function AppointmentForm({ schemeId }: { schemeId: string }) {
  const qc = useQueryClient();
  const documents = useQuery({
    queryKey: ["documents", schemeId, "appointment-picker"],
    queryFn: async () =>
      unwrap<{ documents: DocumentRow[] }>(
        await fetch(`/api/schemes/${schemeId}/documents`, { credentials: "include" }),
      ),
  });
  const [appointedOn, setAppointedOn] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [appointmentDocumentId, setAppointmentDocumentId] = useState("");
  const [delegationDocumentId, setDelegationDocumentId] = useState("");
  const [appointmentResolutionId, setAppointmentResolutionId] = useState("");
  const [delegationResolutionId, setDelegationResolutionId] = useState("");
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await fetch(
          `/api/schemes/${schemeId}/manager/appointments`,
          post({
            appointedOn,
            startsOn,
            endsOn,
            approvedFormName: "Contract of appointment — owners corporation manager",
            approvedFormVersion: "CAV approved form — current at execution",
            appointmentDocumentId,
            appointmentResolutionId,
            delegationDocumentId,
            delegationResolutionId,
            delegatedPowers: [
              "maintenance_and_repairs",
              "collect_fees",
              "keep_financial_records",
              "prepare_notices_agendas_minutes",
              "keep_register_and_records",
            ],
          }),
        ),
      ),
    onSuccess: () => {
      toast.success("Draft appointment recorded");
      void qc.invalidateQueries({ queryKey: ["manager-appointments", schemeId] });
    },
  });
  const docs = documents.data?.documents ?? [];
  return (
    <div className="grid gap-4 rounded-lg bg-muted/40 p-4 sm:grid-cols-2">
      <Field label="Appointed on">
        <Input type="date" value={appointedOn} onChange={(e) => setAppointedOn(e.target.value)} />
      </Field>
      <Field label="Term starts">
        <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
      </Field>
      <Field label="Term ends" hint="Maximum 3 years, or 5 for a recorded retirement-village OC.">
        <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
      </Field>
      <div />
      <Field label="Appointment instrument">
        {(p) => (
          <Select value={appointmentDocumentId} onValueChange={setAppointmentDocumentId}>
            <SelectTrigger {...p}>
              <SelectValue placeholder="Choose document" />
            </SelectTrigger>
            <SelectContent>
              {docs.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Delegation instrument">
        {(p) => (
          <Select value={delegationDocumentId} onValueChange={setDelegationDocumentId}>
            <SelectTrigger {...p}>
              <SelectValue placeholder="Choose document" />
            </SelectTrigger>
            <SelectContent>
              {docs.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Appointment resolution ID">
        <Input
          value={appointmentResolutionId}
          onChange={(e) => setAppointmentResolutionId(e.target.value)}
        />
      </Field>
      <Field label="Delegation resolution ID">
        <Input
          value={delegationResolutionId}
          onChange={(e) => setDelegationResolutionId(e.target.value)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Button
          disabled={save.isPending || !appointmentDocumentId || !delegationDocumentId}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Record draft"}
        </Button>
        {save.error && <p className="mt-2 text-sm text-critical">{save.error.message}</p>}
      </div>
    </div>
  );
}
