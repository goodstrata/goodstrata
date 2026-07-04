import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Side sheet on desktop, bottom sheet on mobile (DESIGN.md §7.2). Spread the
 * result onto SheetContent: the bottom variant carries the rounded top edge,
 * an 85dvh cap, and the safe-area inset baked into side="bottom".
 */
export function useSheetSide(desktopClassName = "w-full sm:max-w-md") {
  const isMobile = useIsMobile();
  return {
    side: isMobile ? ("bottom" as const) : ("right" as const),
    className: cn("overflow-y-auto", isMobile ? "max-h-[85dvh] rounded-t-xl" : desktopClassName),
  };
}
