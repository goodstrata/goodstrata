import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { FinishStep } from "./FinishStep";
import { InviteStep } from "./InviteStep";
import { LotsStep } from "./LotsStep";
import { type CreatedScheme, WelcomeStep } from "./WelcomeStep";

/**
 * Optional handoff from signup: if the sign-up form captured a building name it
 * can stash it here, and the wizard prefills step 1. Safe when absent.
 */
const SIGNUP_BUILDING_NAME_KEY = "goodstrata:onboarding:buildingName";

const STEP_LABELS = ["Your building", "Add lots", "Invite people"] as const;

function readBuildingName(): string {
  try {
    const value = sessionStorage.getItem(SIGNUP_BUILDING_NAME_KEY);
    if (value) sessionStorage.removeItem(SIGNUP_BUILDING_NAME_KEY);
    return value ?? "";
  } catch {
    return "";
  }
}

/**
 * First-run guided onboarding: shown on the empty dashboard (signed in, no
 * scheme yet). Each step persists through the real API, so a partially
 * completed building is still a real, resumable building — drop off after any
 * step and it simply appears in the scheme list next time.
 */
export function OnboardingWizard() {
  const [defaultName] = useState(readBuildingName);
  const [step, setStep] = useState(0);
  const [scheme, setScheme] = useState<CreatedScheme | null>(null);
  const [lotsAdded, setLotsAdded] = useState(0);

  const handleCreated = (created: CreatedScheme) => {
    setScheme(created);
    setStep(1);
  };

  return (
    <div className="mx-auto w-full max-w-2xl py-2 md:py-6">
      {step < 3 && (
        <div className="mb-8 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Step {step + 1} of {STEP_LABELS.length}
            </p>
            <p aria-hidden="true" className="text-sm font-medium text-muted-foreground">
              {STEP_LABELS[step]}
            </p>
          </div>
          <Progress
            value={((step + 1) / STEP_LABELS.length) * 100}
            aria-label={`Onboarding progress: step ${step + 1} of ${STEP_LABELS.length}`}
          />
          <ol className="flex gap-4 pt-0.5">
            {STEP_LABELS.map((label, i) => (
              <li
                key={label}
                className={cn(
                  "text-xs",
                  i === step
                    ? "font-medium text-foreground"
                    : i < step
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60",
                )}
              >
                {label}
              </li>
            ))}
          </ol>
        </div>
      )}

      {step === 0 && <WelcomeStep defaultName={defaultName} onCreated={handleCreated} />}

      {step === 1 && scheme && (
        <LotsStep
          schemeId={scheme.id}
          addedCount={lotsAdded}
          onDone={(count) => {
            setLotsAdded(count);
            setStep(2);
          }}
          onSkip={() => setStep(2)}
        />
      )}

      {step === 2 && scheme && (
        <InviteStep schemeId={scheme.id} onBack={() => setStep(1)} onFinish={() => setStep(3)} />
      )}

      {step === 3 && scheme && <FinishStep schemeId={scheme.id} schemeName={scheme.name} />}
    </div>
  );
}
