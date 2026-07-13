import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

const STATIC_TITLES: Record<string, string> = {
  "/": "Your schemes",
  "/login": "Sign in",
  "/signup": "Create an account",
  "/forgot-password": "Reset your password",
  "/reset-password": "Set a new password",
  "/join": "Join a building",
  "/what-am-i-paying": "What am I paying?",
};

const SETTINGS_TITLES: Record<string, string> = {
  profile: "Profile settings",
  security: "Security settings",
  notifications: "Notification settings",
  preferences: "Appearance settings",
};

const SCHEME_SECTION_TITLES: Record<string, string> = {
  overview: "Overview",
  finance: "Finance",
  maintenance: "Maintenance",
  insurance: "Insurance & plan",
  meetings: "Meetings",
  decisions: "Decisions",
  grievances: "Grievances",
  compliance: "Compliance",
  agents: "Agents",
  lots: "Lots",
  people: "People",
  committee: "Committee",
  documents: "Documents",
  records: "Records",
  activity: "Activity",
  community: "Community",
  messages: "Messages",
};

function pageTitle(pathname: string, search: string, schemeName?: string): string {
  const params = new URLSearchParams(search);

  if (pathname === "/settings") {
    return SETTINGS_TITLES[params.get("section") ?? "profile"] ?? "Account settings";
  }

  if (/^\/schemes\/[^/]+\/manager$/.test(pathname)) {
    return schemeName ? `Manager · ${schemeName}` : "Manager";
  }

  if (/^\/schemes\/[^/]+$/.test(pathname)) {
    const section = SCHEME_SECTION_TITLES[params.get("section") ?? "overview"] ?? "Overview";
    return schemeName ? `${section} · ${schemeName}` : section;
  }

  if (/^\/quote\/[^/]+$/.test(pathname)) return "Review quote";
  if (/^\/work-order\/[^/]+$/.test(pathname)) return "Work order";
  if (/^\/trust\/[^/]+$/.test(pathname)) return "Trust account";

  return STATIC_TITLES[pathname] ?? "GoodStrata";
}

/**
 * Keeps browser and assistive-technology context in step with client-side
 * navigation. The initial load retains the browser's natural focus; later
 * pathname changes focus the main landmark without scrolling the page.
 */
export function RouteAccessibility({ schemeName }: { schemeName?: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const previousPath = useRef(pathname);
  const title = pageTitle(pathname, search, schemeName);

  useEffect(() => {
    document.title = title === "GoodStrata" ? title : `${title} | GoodStrata`;
  }, [title]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById("main")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <p
      data-testid="route-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {title}
    </p>
  );
}
