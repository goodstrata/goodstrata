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
  Scale,
  ShieldCheck,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AgentsTab } from "@/components/AgentsTab";
import { ComplianceTab } from "@/components/ComplianceTab";
import { DecisionsTab } from "@/components/DecisionsTab";
import { FinanceTab } from "@/components/FinanceTab";
import { GrievancesTab } from "@/components/GrievancesTab";
import { MaintenanceTab } from "@/components/MaintenanceTab";
import { MeetingsTab } from "@/components/MeetingsTab";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySection } from "@/components/sections/ActivitySection";
import { CommitteeSection } from "@/components/sections/CommitteeSection";
import { CommunitySection } from "@/components/sections/CommunitySection";
import { DocumentsSection } from "@/components/sections/DocumentsSection";
import { LotsSection } from "@/components/sections/LotsSection";
import { MessagesSection } from "@/components/sections/MessagesSection";
import { OverviewSection } from "@/components/sections/OverviewSection";
import { PeopleSection } from "@/components/sections/PeopleSection";
import { RegistryPlate } from "@/components/ui/registry-plate";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { schemeQueryOptions, useIsOwnerView } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

const SECTIONS = [
  "overview",
  "finance",
  "maintenance",
  "meetings",
  "decisions",
  "grievances",
  "compliance",
  "agents",
  "lots",
  "people",
  "committee",
  "documents",
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
  "finance",
  "meetings",
  "community",
  "messages",
  "documents",
];

/** Owner-voiced labels; internal org vocabulary is reframed for the resident. */
const OWNER_LABELS: Partial<Record<Section, string>> = {
  overview: "Home",
  maintenance: "Report an issue",
  finance: "What I owe",
  community: "My building",
};

/** Owner mobile bottom-bar primaries; community + documents live behind "More". */
const OWNER_MOBILE_PRIMARY: readonly Section[] = ["overview", "maintenance", "finance", "meetings"];

/**
 * Derive the owner nav from the single-source committee groups: keep only owner
 * sections, apply owner labels, and flatten to one unheaded group (which reads
 * best for a short index). Order follows OWNER_SECTIONS, so "Report an issue"
 * sits second under Home.
 */
function ownerNavGroups(): { heading: string | null; items: SectionItem[] }[] {
  const byKey = new Map(ALL_ITEMS.map((item) => [item.key, item]));
  const items = OWNER_SECTIONS.flatMap((key) => {
    const base = byKey.get(key);
    if (!base) return [];
    return [{ ...base, label: OWNER_LABELS[key] ?? base.label }];
  });
  return [{ heading: null, items }];
}

interface NavConfig {
  groups: { heading: string | null; items: SectionItem[] }[];
  mobilePrimary: readonly Section[];
}

const COMMITTEE_NAV: NavConfig = { groups: NAV_GROUPS, mobilePrimary: MOBILE_PRIMARY };
const OWNER_NAV: NavConfig = { groups: ownerNavGroups(), mobilePrimary: OWNER_MOBILE_PRIMARY };

function SchemePage() {
  const { schemeId } = Route.useParams();
  const { section } = Route.useSearch();
  const { data } = useQuery(schemeQueryOptions(schemeId));
  const isOwnerView = useIsOwnerView(schemeId);
  // Show the register-index sidebar from md (768px) so tablets/small laptops
  // get it instead of the phone bottom bar; the shared hook stays at 1024.
  const isMobile = useIsMobile(768);

  // The sections this viewer's nav offers; null for anyone on the committee
  // (they get the whole register) and while roles are still loading.
  const visible: readonly Section[] | null = isOwnerView ? OWNER_SECTIONS : null;

  // Pick the nav set only once roles have loaded (data present) so an owner
  // never sees the committee index flash before their own resolves.
  const nav: NavConfig | null = data ? (isOwnerView ? OWNER_NAV : COMMITTEE_NAV) : null;

  return (
    <>
      <div className="md:grid md:grid-cols-[14rem_1fr] md:gap-8">
        {!isMobile && <SidebarNav schemeId={schemeId} active={section} nav={nav} />}
        <div className="min-w-0 space-y-6 pb-24 md:pb-8">
          {data ? (
            <RegistryPlate
              eyebrow={`${data.scheme.planOfSubdivision} · Tier ${data.scheme.tier}`}
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
          <SectionBody schemeId={schemeId} section={section} visible={visible} />
        </div>
      </div>
      {isMobile && nav && <BottomNav schemeId={schemeId} active={section} nav={nav} />}
    </>
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
      return <FinanceTab schemeId={schemeId} />;
    case "maintenance":
      return <MaintenanceTab schemeId={schemeId} />;
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
        "relative flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors md:min-h-0 md:py-2",
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
      {groups.map((group) => (
        <div key={group.heading ?? "overview"}>
          {group.heading && (
            <p className="mb-1 px-2.5 text-xs font-semibold text-muted-foreground">
              {group.heading}
            </p>
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

/** Tablet/desktop (≥ md) register index: sticky left sidebar. */
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
