import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { AppointmentSection } from "@/components/manager/AppointmentSection";
import { RegistrationSection } from "@/components/manager/RegistrationSection";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchemeRoles } from "@/lib/roles";

export const Route = createFileRoute("/schemes/$schemeId/manager")({
  component: ManagerSettingsPage,
});

function ManagerSettingsPage() {
  const { schemeId } = Route.useParams();
  const roles = useSchemeRoles(schemeId);
  const loading = roles.length === 0;
  const isAdmin = roles.includes("manager_admin");
  const canManage = roles.some((role) =>
    ["chair", "secretary", "treasurer", "manager_admin"].includes(role),
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link
          to="/schemes/$schemeId"
          params={{ schemeId }}
          search={{ section: "overview" }}
          className="mb-3 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to scheme
        </Link>
        <PageHeader
          title="Registration & insurance"
          description="The registered manager's Business Licensing Authority registration and professional-indemnity cover — the software half of the registered-manager path (OC Act s119(5) / reg 10)."
        />
      </div>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      ) : canManage ? (
        <div className="space-y-6">
          <AppointmentSection schemeId={schemeId} />
          {isAdmin ? <RegistrationSection schemeId={schemeId} /> : null}
        </div>
      ) : (
        <EmptyState
          icon={ShieldAlert}
          title="Manager access only"
          description="Registration and insurance are managed by the strata manager's administrators."
        />
      )}
    </div>
  );
}
