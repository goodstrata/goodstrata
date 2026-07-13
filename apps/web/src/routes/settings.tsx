import { createFileRoute, type SearchSchemaInput, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Bell, KeyRound, SlidersHorizontal, UserRound } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth";
import { useIsMobile } from "@/lib/use-mobile";

// Account panels carry very different dependencies (session/device parsing,
// avatar upload, notification matrices). Load only the selected panel so a
// profile visit does not also download security and notification code.
const ProfileSection = lazy(() =>
  import("@/components/settings/ProfileSection").then((module) => ({
    default: module.ProfileSection,
  })),
);
const SecuritySection = lazy(() =>
  import("@/components/settings/SecuritySection").then((module) => ({
    default: module.SecuritySection,
  })),
);
const NotificationsSection = lazy(() =>
  import("@/components/settings/NotificationsSection").then((module) => ({
    default: module.NotificationsSection,
  })),
);
const PreferencesSection = lazy(() =>
  import("@/components/settings/PreferencesSection").then((module) => ({
    default: module.PreferencesSection,
  })),
);

const SECTIONS = ["profile", "security", "notifications", "preferences"] as const;
type SettingsSection = (typeof SECTIONS)[number];

const searchSchema = z.object({
  section: z.enum(SECTIONS).default("profile").catch("profile"),
});

export const Route = createFileRoute("/settings")({
  validateSearch: (search: { section?: SettingsSection } & SearchSchemaInput) =>
    searchSchema.parse(search),
  component: SettingsPage,
});

const TABS: { key: SettingsSection; label: string; icon: LucideIcon }[] = [
  { key: "profile", label: "Profile", icon: UserRound },
  { key: "security", label: "Security", icon: KeyRound },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "preferences", label: "Preferences", icon: SlidersHorizontal },
];

function SettingsPage() {
  const { section } = Route.useSearch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!isPending && !session?.user) {
      void navigate({ to: "/login" });
    }
  }, [isPending, session?.user, navigate]);

  const setSection = (next: string) => {
    void navigate({
      to: "/settings",
      search: { section: next as SettingsSection },
      replace: true,
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        title="Account settings"
        description="Manage your profile, security and preferences."
      />

      {isPending || !session?.user ? (
        <SettingsSkeleton />
      ) : (
        <Tabs
          value={section}
          onValueChange={setSection}
          orientation={isMobile ? "horizontal" : "vertical"}
          className="lg:gap-8"
        >
          <TabsList className="lg:w-48 lg:shrink-0 lg:pt-1">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">
                <t.icon className="size-4" aria-hidden="true" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="min-w-0 flex-1">
            <TabsContent value="profile">
              <Suspense fallback={<SettingsPanelSkeleton />}>
                <ProfileSection
                  user={{
                    id: session.user.id,
                    name: session.user.name,
                    email: session.user.email,
                    image: session.user.image,
                    emailVerified: session.user.emailVerified,
                  }}
                />
              </Suspense>
            </TabsContent>
            <TabsContent value="security">
              <Suspense fallback={<SettingsPanelSkeleton />}>
                <SecuritySection
                  user={{
                    id: session.user.id,
                    name: session.user.name,
                    email: session.user.email,
                  }}
                />
              </Suspense>
            </TabsContent>
            <TabsContent value="notifications">
              <Suspense fallback={<SettingsPanelSkeleton />}>
                <NotificationsSection />
              </Suspense>
            </TabsContent>
            <TabsContent value="preferences">
              <Suspense fallback={<SettingsPanelSkeleton />}>
                <PreferencesSection />
              </Suspense>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}

function SettingsPanelSkeleton() {
  return (
    <div className="space-y-4 rounded-xl border p-6" role="status" aria-label="Loading settings">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full max-w-64" />
      <Skeleton className="h-11 w-full max-w-sm" />
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <div className="flex gap-2 lg:w-48 lg:flex-col">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-24 lg:w-full" />
        ))}
      </div>
      <div className="flex-1 space-y-6">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-4 rounded-xl border p-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-9 w-full max-w-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
