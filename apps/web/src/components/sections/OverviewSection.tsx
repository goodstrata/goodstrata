import { useQuery } from "@tanstack/react-query";
import { OnboardingChecklist } from "@/components/overview/OnboardingChecklist";
import { OverviewDashboard, type OverviewData } from "@/components/overview/OverviewDashboard";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { useIsOfficer } from "@/lib/roles";

/**
 * The scheme landing screen. Before activation it is the onboarding checklist;
 * once the owners corporation is active it becomes a useful building dashboard.
 * Both states are driven by one composed `GET /:schemeId/overview` read.
 */
export function OverviewSection({ schemeId }: { schemeId: string }) {
  const isOfficer = useIsOfficer(schemeId);
  const { data, isError, error, refetch } = useQuery({
    queryKey: ["overview", schemeId],
    queryFn: async () =>
      unwrap<OverviewData>(await api.schemes[":schemeId"].overview.$get({ param: { schemeId } })),
  });

  if (isError) {
    return (
      <div className="max-w-xl">
        <ErrorState
          message={error instanceof Error ? error.message : "Couldn't load the overview."}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {["admin", "maintenance", "levied", "arrears"].map((key) => (
            <Skeleton key={key} className="h-[4.75rem] rounded-lg" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  if (data.scheme.status !== "active") {
    return (
      <OnboardingChecklist schemeId={schemeId} onboarding={data.onboarding} isOfficer={isOfficer} />
    );
  }

  return <OverviewDashboard schemeId={schemeId} data={data} />;
}
