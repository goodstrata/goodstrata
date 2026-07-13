import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, type SearchSchemaInput } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  CalendarDays,
  Ellipsis,
  FolderOpen,
  Gavel,
  Landmark,
  Layers,
  LayoutDashboard,
  Mail,
  MessagesSquare,
  NotebookTabs,
  Scale,
  ShieldCheck,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/StatusBadge";
import { OverviewSection } from "@/components/sections/OverviewSection";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { RegistryPlate } from "@/components/ui/registry-plate";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { schemeQueryOptions, useIsOwnerView } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

// Overview is the scheme landing surface and stays in the route bundle. Every
// deeper register is loaded only when selected, so a resident opening their
// building does not download committee, finance, messaging and editor code at
// once. Named-export adapters keep the component modules unchanged.
const FinanceTab = lazy(() =>
  import("@/components/FinanceTab").then((module) => ({ default: module.FinanceTab })),
);
const OwnerFinanceSummary = lazy(() =>
  import("@/components/overview/OwnerHome").then((module) => ({
    default: module.OwnerFinanceSummary,
  })),
);
const MaintenanceTab = lazy(() =>
  import("@/components/MaintenanceTab").then((module) => ({ default: module.MaintenanceTab })),
);
const BuildingComplianceTab = lazy(() =>
  import("@/components/BuildingComplianceTab").then((module) => ({
    default: module.BuildingComplianceTab,
  })),
);
const MeetingsTab = lazy(() =>
  import("@/components/MeetingsTab").then((module) => ({ default: module.MeetingsTab })),
);
const DecisionsTab = lazy(() =>
  import("@/components/DecisionsTab").then((module) => ({ default: module.DecisionsTab })),
);
const GrievancesTab = lazy(() =>
  import("@/components/GrievancesTab").then((module) => ({ default: module.GrievancesTab })),
);
const ComplianceTab = lazy(() =>
  import("@/components/ComplianceTab").then((module) => ({ default: module.ComplianceTab })),
);
const AgentsTab = lazy(() =>
  import("@/components/AgentsTab").then((module) => ({ default: module.AgentsTab })),
);
const ActivitySection = lazy(() =>
  import("@/components/sections/ActivitySection").then((module) => ({
    default: module.ActivitySection,
  })),
);
const CommitteeSection = lazy(() =>
  import("@/components/sections/CommitteeSection").then((module) => ({
    default: module.CommitteeSection,
  })),
);
const CommunitySection = lazy(() =>
  import("@/components/sections/CommunitySection").then((module) => ({
    default: module.CommunitySection,
  })),
);
const DocumentsSection = lazy(() =>
  import("@/components/sections/DocumentsSection").then((module) => ({
    default: module.DocumentsSection,
  })),
);
const LotsSection = lazy(() =>
  import("@/components/sections/LotsSection").then((module) => ({ default: module.LotsSection })),
);
const MessagesSection = lazy(() =>
  import("@/components/sections/MessagesSection").then((module) => ({
    default: module.MessagesSection,
  })),
);
const PeopleSection = lazy(() =>
  import("@/components/sections/PeopleSection").then((module) => ({
    default: module.PeopleSection,
  })),
);
const RecordsSection = lazy(() =>
  import("@/components/sections/RecordsSection").then((module) => ({
    default: module.RecordsSection,
  })),
);

const SECTIONS = [
  "overview",
  "finance",
  "maintenance",
  "insurance",
  "meetings",
  "decisions",
  "grievances",
  "compliance",
  "agents",
  "lots",
  "people",
  "committee",
  "documents",
  "records",
  "activity",
  "community",
  "messages",
] as const;
type Section = (typeof SECTIONS)[number];

const schemeSearchSchema = z.object({
  section: z.enum(SECTIONS).default("overview").catch("overview"),
  meeting: z.string().optional().catch(undefined),
  run: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/schemes/$schemeId")({
  validateSearch: (
    search: { section?: Section; meeting?: string; run?: string } & SearchSchemaInput,
  ) => schemeSearchSchema.parse(search),
  component: SchemePage,
});

interface SectionItem {
  key: Section;
  label: string;
  /** Short visual label for the five-column mobile bar. */
  shortLabel?: string;
  icon: LucideIcon;
}

/** The register index (DESIGN.md §6.1): eleven sections in six groups. */
const NAV_GROUPS: { heading: string | null; items: SectionItem[] }[] = [
  {
    heading: null,
    items: [{ key: "overview", label: "Overview", icon: LayoutDashboard }],
  },
  {
    heading: "Money",
    items: [{ key: "finance", label: "Finance", icon: Landmark }],
  },
  {
    heading: "Building",
    items: [
      { key: "maintenance", label: "Maintenance", icon: Wrench },
      { key: "insurance", label: "Insurance & plan", icon: ShieldCheck },
    ],
  },
  {
    heading: "Governance",
    items: [
      { key: "meetings", label: "Meetings", icon: CalendarDays },
      { key: "decisions", label: "Decisions", icon: Scale },
      { key: "grievances", label: "Grievances", icon: Gavel },
      { key: "compliance", label: "Compliance", icon: ShieldCheck },
      { key: "committee", label: "Committee", icon: Users },
    ],
  },
  {
    heading: "Register",
    items: [
      { key: "lots", label: "Lots", icon: Layers },
      { key: "people", label: "People", icon: User },
      { key: "documents", label: "Documents", icon: FolderOpen },
      { key: "records", label: "OC records", icon: NotebookTabs },
      { key: "activity", label: "Activity", icon: Activity },
    ],
  },
  {
    heading: "Community",
    items: [
      { key: "community", label: "Community", icon: MessagesSquare },
      { key: "messages", label: "Messages", icon: Mail },
    ],
  },
  {
    heading: "Automation",
    items: [{ key: "agents", label: "Agents", icon: Bot }],
  },
];

const ALL_ITEMS: SectionItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Sections pinned to the mobile bottom bar; the rest live behind "More". */
const MOBILE_PRIMARY: readonly Section[] = ["overview", "finance", "meetings", "activity"];

// ---------------------------------------------------------------------------
// Owner (plain-member) presentation — a focused subset of the committee nav.
// Committee viewers keep the full NAV_GROUPS above, byte-for-byte. This is IA
// only: the server still enforces every read via requireScope, so hiding a
// section is a UX choice, never a security boundary (see the deep-link guard
// in SectionBody).
// ---------------------------------------------------------------------------

/** The only sections an owner viewer sees, in order. */
const OWNER_SECTIONS: readonly Section[] = [
  "overview",
  "maintenance",
  "insurance",
  "finance",
  "meetings",
  "decisions",
  "grievances",
  "compliance",
  "committee",
  "lots",
  "people",
  "documents",
  "records",
  "community",
  "messages",
];

/** Owner-voiced labels; internal org vocabulary is reframed for the resident. */
const OWNER_LABELS: Partial<Record<Section, string>> = {
  overview: "Home",
  maintenance: "Report an issue",
  finance: "What I owe",
  community: "My building",
};

/** Five-column mobile labels stay legible at 360px without shrinking type. */
const OWNER_SHORT_LABELS: Partial<Record<Section, string>> = {
  overview: "Home",
  maintenance: "Report",
  finance: "Levies",
  meetings: "Meetings",
};

/** Owner mobile bottom-bar primaries; community + documents live behind "More". */
const OWNER_MOBILE_PRIMARY: readonly Section[] = ["overview", "maintenance", "finance", "meetings"];

/**
 * Derive the owner nav from the single-source committee groups, then organise
 * the long "More" index around resident tasks. Every member-readable register
 * remains available without presenting a fifteen-item undifferentiated list.
 */
function ownerNavGroups(): { heading: string | null; items: SectionItem[] }[] {
  const byKey = new Map(ALL_ITEMS.map((item) => [item.key, item]));
  const itemFor = (key: Section): SectionItem | null => {
    const base = byKey.get(key);
    if (!base) return null;
    return {
      ...base,
      label: OWNER_LABELS[key] ?? base.label,
      shortLabel: OWNER_SHORT_LABELS[key],
    };
  };
  const group = (heading: string | null, keys: Section[]) => ({
    heading,
    items: keys.map(itemFor).filter((item): item is SectionItem => item !== null),
  });

  return [
    group(null, ["overview"]),
    group("Everyday", ["maintenance", "finance", "community", "messages"]),
    group("Meetings & decisions", ["meetings", "decisions", "grievances", "committee"]),
    group("Building records", [
      "insurance",
      "compliance",
      "lots",
      "people",
      "documents",
      "records",
    ]),
  ];
}

interface NavConfig {
  groups: { heading: string | null; items: SectionItem[] }[];
  mobilePrimary: readonly Section[];
}

const COMMITTEE_NAV: NavConfig = { groups: NAV_GROUPS, mobilePrimary: MOBILE_PRIMARY };
const OWNER_NAV: NavConfig = { groups: ownerNavGroups(), mobilePrimary: OWNER_MOBILE_PRIMARY };

const ROLE_LABELS: Record<string, string> = {
  owner: "Lot owner",
  tenant: "Resident",
  committee_member: "Committee member",
  chair: "Chair",
  secretary: "Secretary",
  treasurer: "Treasurer",
  contractor: "Service provider",
  manager_admin: "Scheme manager",
};

function humaniseRole(role: string): string {
  return (
    ROLE_LABELS[role] ??
    role
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function roleSummary(roles: string[]): string {
  return [...new Set(roles.map(humaniseRole))].join(" · ");
}

function SchemePage() {
  const { schemeId } = Route.useParams();
  const { section } = Route.useSearch();
  const schemeQuery = useQuery(schemeQueryOptions(schemeId));
  const { data } = schemeQuery;
  const isOwnerView = useIsOwnerView(schemeId);
  // Keep the bottom bar through tablet widths. Dense registers and forms need
  // the full canvas until lg; a 14rem sidebar at 768px leaves too little room.
  const isMobile = useIsMobile(1024);

  // The sections this viewer's nav offers; null for anyone on the committee
  // (they get the whole register) and while roles are still loading.
  const visible: readonly Section[] | null = data && isOwnerView ? OWNER_SECTIONS : null;

  // Pick the nav set only once roles have loaded (data present) so an owner
  // never sees the committee index flash before their own resolves.
  const nav: NavConfig | null = data ? (isOwnerView ? OWNER_NAV : COMMITTEE_NAV) : null;

  if (schemeQuery.isError) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-8">
        <ErrorState
          title="We couldn't load this owners corporation"
          message="The scheme details are temporarily unavailable. Try again, or return to your schemes."
          onRetry={() => void schemeQuery.refetch()}
        />
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link to="/">Back to schemes</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="lg:grid lg:grid-cols-[14rem_1fr] lg:gap-8">
        {!isMobile && <SidebarNav schemeId={schemeId} active={section} nav={nav} />}
        <div className="min-w-0 space-y-6 pb-24 lg:pb-8">
          {data ? (
            <RegistryPlate
              eyebrow={`${data.scheme.planOfSubdivision} · Tier ${data.scheme.tier}`}
              name={data.scheme.name}
              meta={data.roles.length > 0 ? `Viewing as ${roleSummary(data.roles)}` : undefined}
              badge={<StatusBadge status={data.scheme.status} />}
            />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="h-8 w-72 max-w-full" />
              <Skeleton className="h-px w-full" />
            </div>
          )}
          {data ? (
            <Suspense fallback={<SectionSkeleton />}>
              <SectionBody schemeId={schemeId} section={section} visible={visible} />
            </Suspense>
          ) : (
            <SectionSkeleton />
          )}
        </div>
      </div>
      {isMobile && nav && <BottomNav schemeId={schemeId} active={section} nav={nav} />}
    </>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading section" role="status">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <span className="sr-only">Loading section…</span>
    </div>
  );
}

/** Only the active section mounts, so inactive sections never fetch. */
function SectionBody({
  schemeId,
  section,
  visible,
}: {
  schemeId: string;
  section: Section;
  /** Sections this viewer's nav offers; null for an officer (all of them). */
  visible: readonly Section[] | null;
}) {
  // An owner can still type ?section=grievances; send them home. Cosmetic
  // tidiness on top of the server's own rejection — never presented as
  // security. `visible` is null while roles load and for officers, so neither
  // is ever redirected.
  if (visible && !visible.includes(section)) {
    return (
      <Navigate
        to="/schemes/$schemeId"
        params={{ schemeId }}
        search={{ section: "overview" }}
        replace
      />
    );
  }
  switch (section) {
    case "overview":
      return <OverviewSection schemeId={schemeId} />;
    case "finance":
      return visible ? (
        <OwnerFinanceSummary schemeId={schemeId} />
      ) : (
        <FinanceTab schemeId={schemeId} />
      );
    case "maintenance":
      return <MaintenanceTab schemeId={schemeId} />;
    case "insurance":
      return <BuildingComplianceTab schemeId={schemeId} />;
    case "meetings":
      return <MeetingsTab schemeId={schemeId} />;
    case "decisions":
      return <DecisionsTab schemeId={schemeId} />;
    case "grievances":
      return <GrievancesTab schemeId={schemeId} />;
    case "compliance":
      return <ComplianceTab schemeId={schemeId} />;
    case "agents":
      return <AgentsTab schemeId={schemeId} />;
    case "lots":
      return <LotsSection schemeId={schemeId} />;
    case "people":
      return <PeopleSection schemeId={schemeId} />;
    case "committee":
      return <CommitteeSection schemeId={schemeId} />;
    case "documents":
      return <DocumentsSection schemeId={schemeId} />;
    case "records":
      return <RecordsSection schemeId={schemeId} />;
    case "activity":
      return <ActivitySection schemeId={schemeId} />;
    case "community":
      return <CommunitySection schemeId={schemeId} />;
    case "messages":
      return <MessagesSection schemeId={schemeId} />;
  }
}

function SectionLink({
  schemeId,
  item,
  active,
  onNavigate,
}: {
  schemeId: string;
  item: SectionItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to="/schemes/$schemeId"
      params={{ schemeId }}
      search={{ section: item.key }}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors lg:min-h-0 lg:py-2",
        active
          ? "bg-accent font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
        />
      )}
      <item.icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", !active && "text-muted-foreground")}
      />
      {item.label}
    </Link>
  );
}

function NavGroups({
  schemeId,
  active,
  groups,
  onNavigate,
}: {
  schemeId: string;
  active: Section;
  groups: { heading: string | null; items: SectionItem[] }[];
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group, index) => {
        const headingId = group.heading ? `scheme-nav-${schemeId}-${index}` : undefined;
        return (
          <section key={group.heading ?? "overview"} aria-labelledby={headingId}>
            {group.heading && (
              <h3
                id={headingId}
                className="mb-1 px-2.5 text-xs font-semibold text-muted-foreground"
              >
                {group.heading}
              </h3>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <SectionLink
                    schemeId={schemeId}
                    item={item}
                    active={active === item.key}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Desktop (≥ lg) register index: sticky left sidebar. */
function SidebarNav({
  schemeId,
  active,
  nav,
}: {
  schemeId: string;
  active: Section;
  nav: NavConfig | null;
}) {
  return (
    <nav aria-label="Scheme sections" className="sticky top-20 self-start">
      {nav ? (
        <NavGroups schemeId={schemeId} active={active} groups={nav.groups} />
      ) : (
        <div className="space-y-2">
          {["a", "b", "c", "d", "e", "f"].map((k) => (
            <Skeleton key={k} className="h-9 w-full rounded-md" />
          ))}
        </div>
      )}
    </nav>
  );
}

/** Mobile (< md) fixed bottom bar; "More" opens a sheet with every section. */
function BottomNav({
  schemeId,
  active,
  nav,
}: {
  schemeId: string;
  active: Section;
  nav: NavConfig;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const allItems = nav.groups.flatMap((g) => g.items);
  const primary = nav.mobilePrimary
    .map((key) => allItems.find((item) => item.key === key))
    .filter((item): item is SectionItem => item !== undefined);
  const moreActive = !nav.mobilePrimary.includes(active);
  const activeItem = allItems.find((item) => item.key === active);

  return (
    <nav
      aria-label="Scheme sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/90"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-5">
        {primary.map((item) => {
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              to="/schemes/$schemeId"
              params={{ schemeId }}
              search={{ section: item.key }}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.shortLabel ? item.label : undefined}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon aria-hidden="true" className="size-5" />
              <span className={cn("text-xs font-medium", isActive && "font-semibold")}>
                {item.shortLabel ?? item.label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-current={moreActive ? "page" : undefined}
          aria-label={
            moreActive && activeItem
              ? `More sections, current section: ${activeItem.label}`
              : "More sections"
          }
          className={cn(
            "flex min-h-11 flex-col items-center justify-center gap-1",
            moreActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <span className="relative">
            <Ellipsis aria-hidden="true" className="size-5" />
            {moreActive && (
              <span
                aria-hidden="true"
                data-testid="more-active-indicator"
                className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-primary"
              />
            )}
          </span>
          <span className={cn("text-xs font-medium", moreActive && "font-semibold")}>More</span>
        </button>
      </div>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-xl">
          <SheetHeader className="pb-1">
            <SheetTitle>Scheme sections</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-8">
            <NavGroups
              schemeId={schemeId}
              active={active}
              groups={nav.groups}
              onNavigate={() => setMoreOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
