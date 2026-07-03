import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { api, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface OnboardingData {
  hasLots: boolean;
  hasInsurance: boolean;
  ready: boolean;
  status: string;
}

/**
 * The pre-activation view: what a compliant owners corporation still needs
 * before going live, plus the officer-only activate action. Unchanged in
 * behaviour from the original OverviewSection — the dashboard replaces it only
 * once the scheme is active.
 */
export function OnboardingChecklist({
  schemeId,
  onboarding,
  isOfficer,
}: {
  schemeId: string;
  onboarding: OnboardingData;
  isOfficer: boolean;
}) {
  const queryClient = useQueryClient();
  const activate = useMutation({
    mutationFn: async () =>
      unwrap(await api.schemes[":schemeId"].activate.$post({ param: { schemeId } })),
    onSuccess: () => {
      toast.success("Scheme activated — agents are watching the event bus");
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["overview", schemeId] });
    },
  });

  const steps = [
    { label: "Scheme registered", done: true },
    { label: "Lots imported from plan of subdivision", done: onboarding.hasLots },
    { label: "Insurance certificate of currency uploaded", done: onboarding.hasInsurance },
  ];
  const completed = steps.filter((s) => s.done).length;
  const isActive = onboarding.status === "active";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <Card>
        <CardHeader>
          <CardTitle>Onboarding checklist</CardTitle>
          <CardDescription>
            Everything a compliant owners corporation needs before going live.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-0" data-testid="onboarding-checklist">
            {steps.map((step, i) => {
              const last = i === steps.length - 1;
              return (
                <li key={step.label} className="relative flex gap-3 pb-6 last:pb-0">
                  {!last && (
                    <span
                      aria-hidden="true"
                      className="absolute top-6 left-[11px] h-[calc(100%-1.5rem)] w-px bg-border"
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border",
                      step.done
                        ? "border-positive/30 bg-positive/10 text-positive"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {step.done ? (
                      <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-current opacity-40"
                      />
                    )}
                    <span className="sr-only">{step.done ? "complete" : "incomplete"}</span>
                  </span>
                  <span
                    className={cn(
                      "pt-0.5 text-sm",
                      step.done ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {!isActive && isOfficer && (
            <div className="mt-6 space-y-2">
              <Button
                disabled={!onboarding.ready || activate.isPending}
                pending={activate.isPending}
                onClick={() => activate.mutate()}
              >
                Activate scheme
              </Button>
              <p className="max-w-md text-13 text-muted-foreground">
                What happens when you activate: the scheme goes live and its agents begin recording
                every levy, meeting and maintenance job on the event bus.
              </p>
              {activate.error && (
                <p className="flex items-start gap-1.5 text-13 text-critical">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{activate.error.message}</span>
                </p>
              )}
            </div>
          )}

          {!isActive && !isOfficer && (
            <p className="mt-6 text-sm text-muted-foreground">
              An office holder will activate the scheme once the checklist is complete.
            </p>
          )}

          {isActive && (
            <p className="mt-6 flex items-center gap-2 text-sm text-positive">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
              This owners corporation is active. Agents are watching the event bus.
            </p>
          )}
        </CardContent>
      </Card>

      <aside className="space-y-4">
        <StatCard
          label="Onboarding"
          value={`${completed} / ${steps.length}`}
          tone={completed === steps.length ? "positive" : "caution"}
          hint={
            isActive
              ? "Scheme is active"
              : onboarding.ready
                ? "Ready to activate"
                : "Awaiting checklist items"
          }
        />
      </aside>
    </div>
  );
}
