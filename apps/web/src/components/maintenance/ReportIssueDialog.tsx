import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

const reportSchema = z.object({
  title: z.string().trim().min(1, "Give the issue a short title."),
  description: z.string().trim().min(1, "Describe the issue so the agent can triage it."),
  lotId: z.string(),
});

/**
 * Plain, owner-facing wording for a maintenance request's raw status. The
 * committee vocabulary (`triaged`, `dispatched`, work-order states, …) is not
 * for owners; this maps it to reassuring language. Intentionally does NOT touch
 * the shared `StatusBadge` — it is used only on owner-facing surfaces.
 */
export function ownerStatusLabel(status: string): string {
  switch (status) {
    case "open":
    case "reported":
    case "received":
      return "Reported";
    case "scheduled":
      return "Scheduled";
    case "completed":
      return "Done";
    case "rejected":
      return "Not proceeding";
    default:
      return "Being looked at";
  }
}

/** Tone for the owner-facing status pill (avoids alarming committee tones). */
export function ownerStatusTone(status: string): "info" | "caution" | "positive" | "neutral" {
  switch (status) {
    case "open":
    case "reported":
    case "received":
      return "info";
    case "completed":
      return "positive";
    case "rejected":
      return "neutral";
    default:
      return "caution";
  }
}

interface ReportIssueDialogProps {
  schemeId: string;
  /**
   * Extra cache invalidation to run on success (e.g. the committee tab also
   * refreshes work orders / RFQs). The dialog always invalidates
   * `["maintenance", schemeId]` on its own, so owner surfaces need no callback.
   */
  onChange?: () => void;
  /** Trigger button label. Defaults to "Report issue". */
  triggerLabel?: string;
  /** Trigger button size. Defaults to "sm"; the owner Home hero passes "lg". */
  triggerSize?: React.ComponentProps<typeof Button>["size"];
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  triggerClassName?: string;
}

/**
 * The single maintenance-request create flow — reused by the committee
 * Maintenance tab (as a header action) and the owner Home hero. It owns the
 * `maintenance.$post` mutation; do not duplicate the service call elsewhere.
 */
export function ReportIssueDialog({
  schemeId,
  onChange,
  triggerLabel = "Report issue",
  triggerSize = "sm",
  triggerVariant,
  triggerClassName,
}: ReportIssueDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const lots = useQuery({
    queryKey: ["lots", schemeId],
    queryFn: async () =>
      unwrap<{ lots: { id: string; lotNumber: string }[] }>(
        await api.schemes[":schemeId"].lots.$get({ param: { schemeId } }),
      ),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: async (values: { title: string; description: string; lotId: string }) =>
      unwrap(
        await api.schemes[":schemeId"].maintenance.$post({
          param: { schemeId },
          json: {
            title: values.title,
            description: values.description,
            lotId: values.lotId === "common" ? undefined : values.lotId,
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      toast.success("Thanks — your report's in. The maintenance agent will take it from here.");
      // Always refresh the request list so any surface (owner Home, committee
      // tab) reflects the new report without depending on the caller.
      void queryClient.invalidateQueries({ queryKey: ["maintenance", schemeId] });
      onChange?.();
    },
  });
  const form = useAppForm({
    schema: reportSchema,
    defaultValues: { title: "", description: "", lotId: "common" },
    onSubmit: (values) => create.mutateAsync(values),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={triggerSize} variant={triggerVariant} className={triggerClassName}>
          <Plus aria-hidden="true" className="size-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a maintenance issue</DialogTitle>
          <DialogDescription>
            Tell us what's wrong. The maintenance agent triages every report automatically — you
            don't need to pick a category.
          </DialogDescription>
        </DialogHeader>
        <form
          id="mr-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="title">
            {(field) => (
              <Field label="Title" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    data-testid="mr-title"
                    placeholder="What's the problem? (e.g. Water stain on ceiling)"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="description">
            {(field) => (
              <Field label="Description" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    data-testid="mr-description"
                    className="min-h-28"
                    placeholder="Describe it — where, since when, how bad."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="lotId">
            {(field) => (
              <Field
                label="Where is it?"
                hint="Pick your lot if the issue is inside it — it helps the triage."
                error={fieldError(field.state.meta.errors)}
              >
                {(controlProps) => (
                  <Select value={field.state.value} onValueChange={field.handleChange}>
                    <SelectTrigger {...controlProps} data-testid="mr-lot">
                      <SelectValue placeholder="Common property / shared areas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="common">Common property / shared areas</SelectItem>
                      {(lots.data?.lots ?? []).map((lot) => (
                        <SelectItem key={lot.id} value={lot.id}>
                          Lot {lot.lotNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
          {/*
            Photo is intentionally optional and non-blocking. The maintenance
            create endpoint does not yet accept an attachment, so the field
            ships disabled-with-note (backend follow-up); an owner can always
            submit in one tap without it.
          */}
          <Field
            label="Photo"
            hint="Optional — attaching a photo is coming soon. Submit now and we'll take it from there."
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                type="file"
                accept="image/*"
                disabled
                data-testid="mr-photo"
                className="cursor-not-allowed file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
              />
            )}
          </Field>
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="mr-form">
            Submit report
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
