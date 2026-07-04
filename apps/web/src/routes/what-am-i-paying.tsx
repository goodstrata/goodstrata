import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CircleAlert,
  FileText,
  Info,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney, Money } from "@/components/ui/money";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/what-am-i-paying")({
  component: WhatAmIPayingPage,
});

const MAX_BYTES = 12 * 1024 * 1024;

interface LineItem {
  label: string;
  amountCents: number;
}

interface EstimateResult {
  isStrataFinancialDoc: boolean;
  currency: string;
  managementFeeAnnualCents: number | null;
  adminOrDisbursementCents: number | null;
  insuranceCommissionNoted: boolean;
  otherManagerChargesCents: number | null;
  totalManagerCostAnnualCents: number | null;
  perLotAnnualCents: number | null;
  lotCount: number | null;
  lineItems: LineItem[];
  confidence: "low" | "medium" | "high";
  notes: string;
  model: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; filename: string }
  | { kind: "result"; result: EstimateResult }
  | { kind: "error"; message: string };

function WhatAmIPayingPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async (file: File) => {
    if (file.size === 0) {
      setPhase({ kind: "error", message: "That file looks empty. Try another one." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhase({
        kind: "error",
        message: "That file is over 12 MB. Upload a smaller PDF or a photo of the page.",
      });
      return;
    }

    setPhase({ kind: "loading", filename: file.name });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/tools/strata-estimate", { method: "POST", body });
      const json = (await res.json()) as EstimateResult | { error?: { message?: string } };
      if (!res.ok || "error" in json) {
        const message =
          ("error" in json && json.error?.message) ||
          "We couldn't read that document. Try a clearer scan or a different page.";
        setPhase({ kind: "error", message });
        return;
      }
      setPhase({ kind: "result", result: json as EstimateResult });
    } catch {
      setPhase({
        kind: "error",
        message: "Couldn't reach the reader. Check your connection and try again.",
      });
    }
  }, []);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void submit(file);
    },
    [submit],
  );

  const busy = phase.kind === "loading";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-2 md:py-8">
      <header className="flex flex-col gap-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">What am I paying?</p>
        <h1 className="text-balance font-display text-3xl font-bold tracking-tight md:text-[2.25rem]">
          See what your strata manager actually costs you
        </h1>
        <p className="mx-auto max-w-xl text-pretty text-muted-foreground md:text-lg">
          Drop in your AGM pack, budget or financial statement. We'll read the numbers and show you,
          in plain dollars, what your owners corporation pays its manager each year.
        </p>
      </header>

      {phase.kind === "result" ? (
        <ResultView result={phase.result} onReset={() => setPhase({ kind: "idle" })} />
      ) : (
        <div className="flex flex-col gap-4">
          <Dropzone
            busy={busy}
            busyLabel={busy ? phase.filename : undefined}
            dragging={dragging}
            onPick={() => inputRef.current?.click()}
            onDragStateChange={setDragging}
            onFiles={onFiles}
          />
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {phase.kind === "error" && (
            <Alert tone="critical">
              <CircleAlert aria-hidden="true" />
              <AlertTitle>We couldn't read that</AlertTitle>
              <AlertDescription>
                <p>{phase.message}</p>
              </AlertDescription>
            </Alert>
          )}

          <p className="flex items-center justify-center gap-1.5 text-center text-13 text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
            We read the numbers in your document and don't store it.
          </p>
        </div>
      )}

      <CtaBand />
    </div>
  );
}

interface DropzoneProps {
  busy: boolean;
  busyLabel?: string;
  dragging: boolean;
  onPick: () => void;
  onDragStateChange: (dragging: boolean) => void;
  onFiles: (files: FileList | null) => void;
}

function Dropzone({
  busy,
  busyLabel,
  dragging,
  onPick,
  onDragStateChange,
  onFiles,
}: DropzoneProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a progressive enhancement; the inner button + hidden input carry keyboard/click access
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) onDragStateChange(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        onDragStateChange(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDragStateChange(false);
        if (!busy) onFiles(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed bg-card px-6 py-14 text-center transition-colors md:py-20",
        dragging ? "border-primary bg-accent/40" : "border-border",
        busy && "opacity-80",
      )}
    >
      {busy ? (
        <>
          <Spinner className="size-8 text-primary" aria-hidden="true" />
          <div className="space-y-1" aria-live="polite">
            <p className="font-display text-lg font-bold">Reading your document…</p>
            <p className="text-sm text-muted-foreground">
              {busyLabel ? (
                <span className="font-mono">{busyLabel}</span>
              ) : (
                "Finding the manager's fees"
              )}
            </p>
          </div>
        </>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground"
          >
            <UploadCloud className="size-7" />
          </div>
          <div className="space-y-1">
            <p className="text-balance font-display text-lg font-bold">
              Drop your AGM, budget or financial statement
            </p>
            <p className="text-sm text-muted-foreground">PDF or a photo — up to 12 MB</p>
          </div>
          <Button type="button" size="lg" onClick={onPick}>
            <FileText aria-hidden="true" /> Choose a file
          </Button>
        </>
      )}
    </div>
  );
}

function ResultView({ result, onReset }: { result: EstimateResult; onReset: () => void }) {
  if (!result.isStrataFinancialDoc) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="caution">
          <Info aria-hidden="true" />
          <AlertTitle>That doesn't look like a strata financial document</AlertTitle>
          <AlertDescription>
            <p>
              {result.notes ||
                "Upload an AGM pack, an annual budget, or a financial statement so we can find the manager's fees."}
            </p>
          </AlertDescription>
        </Alert>
        <TryAnother onReset={onReset} />
      </div>
    );
  }

  const total = result.totalManagerCostAnnualCents;
  const hasTotal = typeof total === "number" && total > 0;

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden py-0">
        <div className="border-b bg-accent/30 px-6 py-7 text-center md:px-8 md:py-9">
          <p className="text-sm font-medium text-accent-foreground">
            Your strata manager costs about
          </p>
          {hasTotal ? (
            <p className="mt-2 font-display text-4xl font-bold tracking-tight tabular-nums md:text-5xl">
              {formatMoney(total)}
              <span className="ml-2 align-middle text-base font-normal text-muted-foreground md:text-lg">
                a year
              </span>
            </p>
          ) : (
            <p className="mt-3 text-pretty text-muted-foreground">
              We read the document but couldn't pin an exact manager total. Here's what we could
              make out.
            </p>
          )}
          {result.perLotAnnualCents != null && result.perLotAnnualCents > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              That's <Money cents={result.perLotAnnualCents} /> per lot per year
              {result.lotCount ? ` across ${result.lotCount} lots` : ""}.
            </p>
          )}
        </div>

        <CardContent className="flex flex-col gap-5 py-6">
          {result.lineItems.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold">What's in that figure</h2>
              <ul className="mt-3 divide-y">
                {result.lineItems.map((item, i) => (
                  <li
                    key={`${item.label}-${i}`}
                    className="flex items-center justify-between gap-4 py-2.5 text-sm"
                  >
                    <span className="min-w-0 font-medium">{item.label}</span>
                    <Money cents={item.amountCents} className="shrink-0" />
                  </li>
                ))}
                {hasTotal && (
                  <li className="flex items-center justify-between gap-4 py-2.5 text-sm font-semibold">
                    <span>Total to the manager</span>
                    <Money cents={total} className="shrink-0" />
                  </li>
                )}
              </ul>
            </div>
          )}

          {result.insuranceCommissionNoted && (
            <Alert tone="info">
              <Info aria-hidden="true" />
              <AlertTitle>Insurance commission spotted</AlertTitle>
              <AlertDescription>
                <p>
                  Your manager also appears to earn a commission on the building's insurance — money
                  on top of the fees above that rarely shows up on a levy notice.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {result.notes && (
            <p className="text-pretty text-sm text-muted-foreground">{result.notes}</p>
          )}

          <ConfidenceNote confidence={result.confidence} />
        </CardContent>
      </Card>

      <TryAnother onReset={onReset} />
    </div>
  );
}

function ConfidenceNote({ confidence }: { confidence: EstimateResult["confidence"] }) {
  if (confidence === "high") {
    return (
      <p className="text-13 text-muted-foreground">
        These figures were clearly labelled in your document. Always check them against your own
        records.
      </p>
    );
  }
  const message =
    confidence === "medium"
      ? "Some of this was inferred from how the document is laid out — treat it as a close estimate, not an audited figure."
      : "This document was hard to read, so treat these numbers as a rough guess. A clearer scan or the budget page will read better.";
  return (
    <Alert tone="caution">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{confidence === "medium" ? "A close estimate" : "Low confidence"}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
      </AlertDescription>
    </Alert>
  );
}

function TryAnother({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <Button type="button" variant="outline" onClick={onReset}>
        <RotateCcw aria-hidden="true" /> Read another document
      </Button>
      <p className="flex items-center gap-1.5 text-13 text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        We didn't store your document — only the numbers you see here.
      </p>
    </div>
  );
}

function CtaBand() {
  return (
    <Card className="border-primary/20 bg-accent/40">
      <CardContent className="flex flex-col items-center gap-4 py-2 text-center">
        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2">
            <Building2 aria-hidden="true" className="size-5 text-primary" />
            <p className="font-display text-xl font-bold">GoodStrata does this for $0</p>
          </div>
          <p className="text-pretty text-sm text-muted-foreground">
            We run your owners corporation with AI — budgets, levies, meetings and maintenance — and
            every dollar is on the record. No manager markup, no insurance commissions.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg">
            <Link to="/login">
              Start your building <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Try the demo</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
