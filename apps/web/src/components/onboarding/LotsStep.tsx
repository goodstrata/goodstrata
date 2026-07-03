import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Layers } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

const lotsSchema = z.object({
  lotCount: z.string().regex(/^[1-9]\d{0,3}$/, "Enter how many lots the building has, like 8."),
});

/** Equal entitlement CSV for lots 1..n — the lots endpoint's import format. */
function equalLotsCsv(count: number): string {
  let csv = "lot_number,entitlement,liability\n";
  for (let i = 1; i <= count; i += 1) csv += `${i},1,1\n`;
  return csv;
}

export function LotsStep({
  schemeId,
  addedCount,
  onDone,
  onSkip,
}: {
  schemeId: string;
  /** >0 once lots have been imported in this session (revisit guard). */
  addedCount: number;
  onDone: (count: number) => void;
  onSkip: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useAppForm({
    schema: lotsSchema,
    defaultValues: { lotCount: "" },
    onSubmit: async ({ lotCount }) => {
      const count = Number.parseInt(lotCount, 10);
      await unwrap(
        await api.schemes[":schemeId"].lots.import.$post({
          param: { schemeId },
          json: { csv: equalLotsCsv(count) },
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lots", schemeId] }),
        queryClient.invalidateQueries({ queryKey: ["people", schemeId] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] }),
        queryClient.invalidateQueries({ queryKey: ["overview", schemeId] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] }),
      ]);
      onDone(count);
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="page-title">
          Add your lots
        </h1>
        <p className="text-sm text-muted-foreground">
          A lot is each separately owned part of the building — a unit, townhouse or shop. Every lot
          carries a <span className="font-medium text-foreground">lot entitlement</span>: its share
          of the levies and its voting weight.
        </p>
      </div>

      {addedCount > 0 ? (
        <div className="space-y-6">
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-positive/25 bg-positive/8 px-4 py-3"
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" />
            <p className="text-sm">
              <span className="font-medium">{addedCount} lots added.</span> Each has an equal share
              to start — you can fine-tune entitlements any time in the Lots register.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="lg" onClick={() => onDone(addedCount)}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <form
          id="onboarding-lots-form"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3">
            <Layers aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-13 text-muted-foreground">
              We'll create lots numbered 1 upward, each with an equal share. That's the right start
              for most buildings; you can adjust individual entitlements later.
            </p>
          </div>

          <form.Field name="lotCount">
            {(field) => (
              <Field
                label="How many lots does the building have?"
                htmlFor="lots-count"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  className="max-w-32"
                  placeholder="e.g. 8"
                  inputMode="numeric"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>

          <FormError form={form} />

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onSkip}>
              I'll add these later
            </Button>
            <SubmitButton form={form} formId="onboarding-lots-form" size="lg">
              Add lots & continue
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
