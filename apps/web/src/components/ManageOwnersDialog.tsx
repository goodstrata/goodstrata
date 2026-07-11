import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Users } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

export interface LotOwner {
  ownershipId: string;
  personId: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  kind: string;
  shareNumerator: number;
  shareDenominator: number;
  isLevyRecipient: boolean;
  startedOn: string;
}

interface RollPerson {
  id: string;
  givenName: string | null;
  familyName: string | null;
  companyName: string | null;
  email: string | null;
}

const OWNERSHIP_KINDS = ["sole", "joint", "company_nominee"] as const;
type KindValue = (typeof OWNERSHIP_KINDS)[number];
const KIND_LABELS: Record<KindValue, string> = {
  sole: "Sole owner",
  joint: "Joint owner",
  company_nominee: "Company nominee",
};

const addOwnerSchema = z.object({
  personId: z.string().min(1, "Select a person from the roll."),
  kind: z.enum(OWNERSHIP_KINDS),
});
type AddOwnerValues = z.infer<typeof addOwnerSchema>;

function ownerName(o: {
  givenName: string | null;
  familyName: string | null;
  email?: string | null;
}) {
  return `${o.givenName ?? ""} ${o.familyName ?? ""}`.trim() || o.email || "Unnamed";
}

function rollPersonLabel(p: RollPerson) {
  const name = `${p.givenName ?? ""} ${p.familyName ?? ""}`.trim() || p.companyName;
  if (name && p.email) return `${name} (${p.email})`;
  return name || p.email || "Unnamed";
}

function AddOwnerForm({
  schemeId,
  lotId,
  owners,
  onDone,
}: {
  schemeId: string;
  lotId: string;
  owners: LotOwner[];
  onDone: () => void;
}) {
  const { data: people } = useQuery({
    queryKey: ["people", schemeId],
    queryFn: async () =>
      unwrap<{ people: RollPerson[] }>(
        await api.schemes[":schemeId"].people.$get({ param: { schemeId } }),
      ),
  });
  const currentOwnerIds = new Set(owners.map((o) => o.personId));
  const candidates = (people?.people ?? []).filter((p) => !currentOwnerIds.has(p.id));

  const formRef = useRef<{ reset: () => void } | null>(null);
  const form = useAppForm<AddOwnerValues>({
    schema: addOwnerSchema,
    defaultValues: { personId: "", kind: owners.length > 0 ? "joint" : "sole" },
    onSubmit: async ({ personId, kind }) => {
      await unwrap(
        await api.schemes[":schemeId"].lots[":lotId"].owners.$post({
          param: { schemeId, lotId },
          json: { personId, kind },
        }),
      );
      toast.success("Owner added");
      formRef.current?.reset();
      onDone();
    },
  });
  formRef.current = form;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <form.Field name="personId">
          {(field) => (
            // min-w-0: a flex item defaults to min-width:auto, so the long
            // "Name (email)" option label would otherwise refuse to shrink and
            // push the dialog into a horizontal scroll.
            <Field
              className="min-w-0 flex-1"
              label="Person"
              hint={
                candidates.length === 0
                  ? "Everyone on the roll already owns this lot — add people from the People tab first."
                  : undefined
              }
              error={fieldError(field.state.meta.errors)}
            >
              {(control) => (
                <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                  <SelectTrigger
                    id={control.id}
                    aria-invalid={control["aria-invalid"]}
                    aria-describedby={control["aria-describedby"]}
                    className="w-full"
                    data-testid="add-owner-person"
                  >
                    <SelectValue placeholder="Select person…" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {rollPersonLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
        </form.Field>
        <form.Field name="kind">
          {(field) => (
            <Field className="sm:w-44" label="Held as" error={fieldError(field.state.meta.errors)}>
              {(control) => (
                <Select
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v as KindValue)}
                >
                  <SelectTrigger
                    id={control.id}
                    aria-invalid={control["aria-invalid"]}
                    aria-describedby={control["aria-describedby"]}
                    className="w-full"
                    data-testid="add-owner-kind"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OWNERSHIP_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
        </form.Field>
      </div>
      <FormError form={form} className="mt-3" />
      <div className="mt-4">
        <SubmitButton form={form} disabled={candidates.length === 0}>
          Add owner
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * The lot's ownership register, for officers: add an owner from the roll,
 * end an ownership period (a transfer keeps the history — nothing is
 * deleted), and move the levy-notice recipient.
 */
export function ManageOwnersDialog({
  schemeId,
  lotId,
  lotNumber,
  owners,
}: {
  schemeId: string;
  lotId: string;
  lotNumber: string;
  owners: LotOwner[];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["lots", schemeId] });
    void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
  };

  const endMutation = useMutation({
    mutationFn: async (ownershipId: string) =>
      unwrap(
        await api.schemes[":schemeId"].lots[":lotId"].owners[":ownershipId"].end.$post({
          param: { schemeId, lotId, ownershipId },
          json: {},
        }),
      ),
    onSuccess: () => {
      toast.success("Ownership ended");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const recipientMutation = useMutation({
    mutationFn: async (ownershipId: string) =>
      unwrap(
        await api.schemes[":schemeId"].lots[":lotId"].owners[":ownershipId"][
          "levy-recipient"
        ].$post({ param: { schemeId, lotId, ownershipId } }),
      ),
    onSuccess: () => {
      toast.success("Levy recipient updated");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const busy = endMutation.isPending || recipientMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`manage-owners-lot-${lotNumber}`}>
          <Users className="size-4" /> Owners
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lot {lotNumber} owners</DialogTitle>
          <DialogDescription>
            Add an owner from the roll, end an ownership, or move the levy recipient. Ended
            ownerships stay on the register as history.
          </DialogDescription>
        </DialogHeader>
        {owners.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No current owners"
            description="Add an owner from the roll below."
          />
        ) : (
          <ul className="space-y-2">
            {owners.map((o) => (
              <li
                key={o.ownershipId}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`owner-${o.email ?? o.personId}`}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{ownerName(o)}</span>
                    {o.isLevyRecipient && <Badge tone="info">Levy recipient</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {o.email && <span>{o.email} · </span>}
                    <span className="capitalize">{o.kind.replace("_", " ")}</span>
                    {o.shareNumerator < o.shareDenominator && (
                      <span className="font-mono tabular-nums">
                        {" "}
                        · {o.shareNumerator}/{o.shareDenominator}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {!o.isLevyRecipient && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      pending={
                        recipientMutation.isPending && recipientMutation.variables === o.ownershipId
                      }
                      onClick={() => recipientMutation.mutate(o.ownershipId)}
                    >
                      Set levy recipient
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-critical"
                    disabled={busy}
                    pending={endMutation.isPending && endMutation.variables === o.ownershipId}
                    onClick={() => endMutation.mutate(o.ownershipId)}
                  >
                    End ownership
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t pt-4">
          <AddOwnerForm schemeId={schemeId} lotId={lotId} owners={owners} onDone={invalidate} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
