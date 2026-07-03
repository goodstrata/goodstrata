import { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Bot, CheckCircle2, FileCheck2, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";

const WHAT_NEXT: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Bot,
    title: "Your agents start working",
    body: "The finance, maintenance and governance agents begin watching over the building straight away.",
  },
  {
    icon: FileCheck2,
    title: "Set up is guided",
    body: "Add a certificate of currency and confirm your lots, and the building switches from onboarding to active.",
  },
  {
    icon: Vote,
    title: "Your first decisions appear",
    body: "As agents propose levies, works and meetings, you'll see clear decisions waiting for your approval.",
  },
];

export function FinishStep({ schemeId, schemeName }: { schemeId: string; schemeName: string }) {
  const navigate = useNavigate();

  return (
    <div className="space-y-8 text-center">
      <div className="space-y-3">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-positive/10">
          <CheckCircle2 aria-hidden="true" className="size-7 text-positive" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight md:text-[1.75rem]">
          {schemeName} is set up
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Nicely done. Your owners corporation is on the record and ready to run.
        </p>
      </div>

      <ul className="space-y-3 text-left">
        {WHAT_NEXT.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex items-start gap-3 rounded-lg border bg-card p-4 shadow-xs"
          >
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent">
              <Icon aria-hidden="true" className="size-4 text-accent-foreground" />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-[13px] text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>

      <Button
        size="lg"
        className="w-full sm:w-auto"
        onClick={() => void navigate({ to: "/schemes/$schemeId", params: { schemeId } })}
      >
        Go to your building
      </Button>
    </div>
  );
}
