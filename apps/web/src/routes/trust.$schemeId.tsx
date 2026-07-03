import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { TrustAccountView } from "@/components/TrustAccountView";
import { RegistryPlate } from "@/components/ui/registry-plate";
import { Skeleton } from "@/components/ui/skeleton";
import { schemeQueryOptions } from "@/lib/roles";

export const Route = createFileRoute("/trust/$schemeId")({
  component: TrustPage,
});

/** Standalone per-OC trust-account reconciliation & audit view (OC Act s 122). */
function TrustPage() {
  const { schemeId } = Route.useParams();
  const { data } = useQuery(schemeQueryOptions(schemeId));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to="/schemes/$schemeId"
        params={{ schemeId }}
        search={{ section: "finance" }}
        className="inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to finance
      </Link>

      {data ? (
        <RegistryPlate
          eyebrow="Trust account · OC Act s 122"
          name={data.scheme.name}
          meta="reconciliation & auditor export"
        />
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-3.5 w-44" />
          <Skeleton className="h-8 w-72 max-w-full" />
        </div>
      )}

      <TrustAccountView schemeId={schemeId} />
    </div>
  );
}
