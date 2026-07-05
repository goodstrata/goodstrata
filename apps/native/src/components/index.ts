/**
 * The Registry component kit. Builders import from "../../src/components".
 * Semantic tokens only — colours via useTheme(), spacing via space(n),
 * money as integer cents through Figure/formatMoney.
 */
export { Button } from "./ui/Button";
export type { ButtonProps } from "./ui/Button";
export { Card } from "./ui/Card";
export type { CardProps } from "./ui/Card";
export { EmptyState } from "./ui/EmptyState";
export type { EmptyStateProps } from "./ui/EmptyState";
export { ErrorState } from "./ui/ErrorState";
export type { ErrorStateProps } from "./ui/ErrorState";
export { Figure } from "./ui/Figure";
export type { FigureProps } from "./ui/Figure";
export { ListRow } from "./ui/ListRow";
export type { ListRowProps } from "./ui/ListRow";
export { PressableScale } from "./ui/PressableScale";
export type { PressableScaleProps } from "./ui/PressableScale";
export { Screen } from "./ui/Screen";
export type { ScreenProps } from "./ui/Screen";
export { SectionHeader } from "./ui/SectionHeader";
export type { SectionHeaderProps } from "./ui/SectionHeader";
export { Sheet } from "./ui/Sheet";
export type { SheetProps } from "./ui/Sheet";
export { Skeleton } from "./ui/Skeleton";
export type { SkeletonProps } from "./ui/Skeleton";
export { StatusPill, statusTone } from "./ui/StatusPill";
export type { StatusPillProps, StatusToneName } from "./ui/StatusPill";
export { useListEntering } from "./ui/motion";

// Foundations, re-exported for one-stop imports in screens.
export { useTheme } from "../theme/useTheme";
export type { Theme } from "../theme/useTheme";
export * from "../theme/tokens";
export { formatDate, formatMoney, formatMoneyLabel, formatRelativeTime, humanise, MINUS, plate } from "../lib/format";
