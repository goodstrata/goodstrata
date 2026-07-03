import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  CalendarDays,
  Ellipsis,
  FolderOpen,
  Landmark,
  Layers,
  LayoutDashboard,
  MessagesSquare,
  Scale,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AgentsTab } from "@/components/AgentsTab";
import { DecisionsTab } from "@/components/DecisionsTab";
import { FinanceTab } from "@/components/FinanceTab";
import { MaintenanceTab } from "@/components/MaintenanceTab";
import { MeetingsTab } from "@/components/MeetingsTab";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySection } from "@/components/sections/ActivitySection";
import { CommitteeSection } from "@/components/sections/CommitteeSection";
import { CommunitySection } from "@/components/sections/CommunitySection";
import { DocumentsSection } from "@/components/sections/DocumentsSection";
import { LotsSection } from "@/components/sections/LotsSection";
import { OverviewSection } from "@/components/sections/OverviewSection";
import { PeopleSection } from "@/components/sections/PeopleSection";
import { Eyebrow } from "@/components/ui/eyebrow";
import { RegistryPlate } from "@/components/ui/registry-plate";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { schemeQueryOptions } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

const SECTIONS = [
  "overview",
  "finance",
  "maintenance",
  "meetings",
  "decisions",
  "agents",
  "lots",
  "people",
  "committee",
  "documents",
  "activity",
  "community",
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
    items: [{ key: "maintenance", label: "Maintenance", icon: Wrench }],
  },
  {
    heading: "Governance",
    items: [
      { key: "meetings", label: "Meetings", icon: CalendarDays },
      { key: "decisions", label: "Decisions", icon: Scale },
      { key: "committee", label: "Committee", icon: Users },
    ],
  },
  {
    heading: "Register",
    items: [
      { key: "lots", label: "Lots", icon: Layers },
      { key: "people", label: "People", icon: User },
      { key: "documents", label: "Documents", icon: FolderOpen },
      { key: "activity", label: "Activity", icon: Activity },
    ],
  },
  {
    heading: "Community",
    items: [{ key: "community", label: "Community", icon: MessagesSquare }],
  },
  {
    heading: "Automation",
    items: [{ key: "agents", label: "Agents", icon: Bot }],
  },
];

const ALL_ITEMS: SectionItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Sections pinned to the mobile bottom bar; the rest live behind "More". */
const MOBILE_PRIMARY: readonly Section[] = ["overview", "finance", "meetings", "activity"];

function SchemePage() {
  const { schemeId } = Route.useParams();
  const { section } = Route.useSearch();
  const { data } = useQuery(schemeQueryOptions(schemeId));
  const isMobile = useIsMobile();

  return (
    <>
      <div className="lg:grid lg:grid-cols-[14rem_1fr] lg:gap-8">
        {!isMobile && <SidebarNav schemeId={schemeId} active={section} />}
        <div className="min-w-0 space-y-6 pb-24 lg:pb-8">
          {data ? (
            <RegistryPlate
              eyebrow={`${data.scheme.planOfSubdivision} · TIER ${data.scheme.tier}`}
              name={data.scheme.name}
              meta={
                data.roles.length > 0
                  ? `your roles: ${data.roles.map((r) => r.replace(/_/g, " ")).join(", ")}`
                  : undefined
              }
              badge={<StatusBadge status={data.scheme.status} />}
            />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="h-8 w-72 max-w-full" />
              <Skeleton className="h-px w-full" />
            </div>
          )}
          <SectionBody schemeId={schemeId} section={section} />
        </div>
      </div>
      {isMobile && <BottomNav schemeId={schemeId} active={section} />}
    </>
  );
}

/** Only the active section mounts, so inactive sections never fetch. */
function SectionBody({ schemeId, section }: { schemeId: string; section: Section }) {
  switch (section) {
    case "overview":
      return <OverviewSection schemeId={schemeId} />;
    case "finance":
      return <FinanceTab schemeId={schemeId} />;
    case "maintenance":
      return <MaintenanceTab schemeId={schemeId} />;
    case "meetings":
      return <MeetingsTab schemeId={schemeId} />;
    case "decisions":
      return <DecisionsTab schemeId={schemeId} />;
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
    case "activity":
      return <ActivitySection schemeId={schemeId} />;
    case "community":
      return <CommunitySection schemeId={schemeId} />;
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
  onNavigate,
}: {
  schemeId: string;
  active: Section;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.heading ?? "overview"}>
          {group.heading && (
            <Eyebrow className="mb-1 block px-2.5 text-[11px]">{group.heading}</Eyebrow>
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
        </div>
      ))}
    </div>
  );
}

/** Desktop (≥ lg) register index: sticky left sidebar. */
function SidebarNav({ schemeId, active }: { schemeId: string; active: Section }) {
  return (
    <nav aria-label="Scheme sections" className="sticky top-20 self-start">
      <NavGroups schemeId={schemeId} active={active} />
    </nav>
  );
}

/** Mobile (< lg) fixed bottom bar; "More" opens a sheet with every section. */
function BottomNav({ schemeId, active }: { schemeId: string; active: Section }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = ALL_ITEMS.filter((item) => MOBILE_PRIMARY.includes(item.key));
  const moreActive = !MOBILE_PRIMARY.includes(active);

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
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon aria-hidden="true" className="size-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className={cn(
            "flex min-h-11 flex-col items-center justify-center gap-1",
            moreActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Ellipsis aria-hidden="true" className="size-5" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </div>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-xl">
          <SheetHeader className="pb-1">
            <SheetTitle>Scheme sections</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-8">
            <NavGroups schemeId={schemeId} active={active} onNavigate={() => setMoreOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
