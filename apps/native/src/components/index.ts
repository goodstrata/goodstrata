/**
 * The Registry component kit. Builders import from "../../src/components".
 * Semantic tokens only — colours via useTheme(), spacing via space(n),
 * money as integer cents through Figure/formatMoney.
 */

export {
  formatDate,
  formatMoney,
  formatMoneyLabel,
  formatRelativeTime,
  humanise,
  MINUS,
  plate,
} from "../lib/format";
export * from "../theme/tokens";
export type { Theme } from "../theme/useTheme";
// Foundations, re-exported for one-stop imports in screens.
export { useTheme } from "../theme/useTheme";
export type { ButtonProps } from "./ui/Button";
export { Button } from "./ui/Button";
export type { CardProps } from "./ui/Card";
export { Card } from "./ui/Card";
export type { EmptyStateProps } from "./ui/EmptyState";
export { EmptyState } from "./ui/EmptyState";
export type { ErrorStateProps } from "./ui/ErrorState";
export { ErrorState } from "./ui/ErrorState";
export type { FigureProps } from "./ui/Figure";
export { Figure } from "./ui/Figure";
export { FormField } from "./ui/FormField";
export type { ListRowProps } from "./ui/ListRow";
export { ListRow } from "./ui/ListRow";
export { useListEntering } from "./ui/motion";
export type { PressableScaleProps } from "./ui/PressableScale";
export { PressableScale } from "./ui/PressableScale";
export type { ScreenProps } from "./ui/Screen";
export { Screen } from "./ui/Screen";
export type { SectionHeaderProps } from "./ui/SectionHeader";
export { SectionHeader } from "./ui/SectionHeader";
export type { SheetProps } from "./ui/Sheet";
export { Sheet } from "./ui/Sheet";
export type { SkeletonProps } from "./ui/Skeleton";
export { Skeleton } from "./ui/Skeleton";
export type { StatusPillProps, StatusToneName } from "./ui/StatusPill";
export { StatusPill, statusTone } from "./ui/StatusPill";
