import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // mirror the API route's per-image cap

/** Image types the API accepts (mirrors ALLOWED_IMAGE_TYPES in routes/maintenance.ts). */
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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
 * report mutation; do not duplicate the service call elsewhere. Reports go up
 * as multipart/form-data when photos are attached, plain JSON otherwise.
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);

  // Track live preview URLs in a ref so unmount cleanup revokes the current set
  // without re-subscribing the effect on every change.
  const urlsRef = useRef<string[]>([]);
  urlsRef.current = images.map((img) => img.url);
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const clearImages = useCallback(() => {
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.url);
      return [];
    });
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file
    if (picked.length === 0) return;

    // Validate up front so a bad file rejects here with a clear reason, not as
    // a whole-report failure at submit time (iPhone HEIC is the common case).
    const usable: File[] = [];
    for (const file of picked) {
      const type = (file.type || "").split(";")[0]!.trim().toLowerCase();
      if (!ACCEPTED_IMAGE_TYPES.has(type)) {
        toast.error(`${file.name} isn't a supported format — use PNG, JPEG, WebP or GIF.`);
      } else if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} is too large — photos can be up to 10 MB.`);
      } else {
        usable.push(file);
      }
    }
    if (usable.length === 0) return;

    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        toast.error(`You can attach up to ${MAX_IMAGES} photos per report.`);
        return prev;
      }
      const added = usable.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
      if (usable.length > room) toast.error(`Only the first ${MAX_IMAGES} photos were attached.`);
      return [...prev, ...added];
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const lots = useQuery({
    queryKey: ["lots", schemeId],
    queryFn: async () =>
      unwrap<{ lots: { id: string; lotNumber: string }[] }>(
        await api.schemes[":schemeId"].lots.$get({ param: { schemeId } }),
      ),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: async (values: { title: string; description: string; lotId: string }) => {
      const lotId = values.lotId === "common" ? undefined : values.lotId;
      let res: Response;
      if (images.length > 0) {
        const payload = new FormData();
        payload.set("title", values.title);
        payload.set("description", values.description);
        if (lotId) payload.set("lotId", lotId);
        for (const img of images) payload.append("images", img.file);
        res = await fetch(`/api/schemes/${schemeId}/maintenance`, {
          method: "POST",
          body: payload,
          credentials: "include",
        });
      } else {
        res = await fetch(`/api/schemes/${schemeId}/maintenance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: values.title, description: values.description, lotId }),
          credentials: "include",
        });
      }
      return unwrap(res);
    },
    onSuccess: () => {
      setOpen(false);
      form.reset();
      clearImages();
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
          <Field
            label="Photos"
            hint="Optional — a photo of the problem helps the triage and any tradesperson quoting."
          >
            {(controlProps) => (
              <div>
                {images.length > 0 && (
                  <ul className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {images.map((img, i) => (
                      <li key={img.url} className="relative">
                        <img
                          src={img.url}
                          alt={`Selected attachment ${i + 1}`}
                          className="aspect-square w-full rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          aria-label={`Remove photo ${i + 1}`}
                          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition-colors after:absolute after:-inset-2.5 hover:text-foreground"
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                  data-testid="mr-photo"
                  onChange={onPick}
                />
                <Button
                  {...controlProps}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={images.length >= MAX_IMAGES}
                >
                  <ImagePlus aria-hidden="true" className="size-4" />
                  {images.length > 0 ? "Add more photos" : "Add photos"}
                </Button>
              </div>
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
