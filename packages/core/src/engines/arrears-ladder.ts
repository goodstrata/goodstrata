/**
 * The arrears escalation ladder (SPEC §2.3). Notification stages are fully
 * automated; the day-60 stage is a committee decision gate, and day-90+
 * execution happens only after approval.
 */

export const ARREARS_STAGES = [
  { stage: 1, day: 1, kind: "friendly_reminder" },
  { stage: 2, day: 14, kind: "formal_reminder" },
  { stage: 3, day: 30, kind: "final_notice" },
  { stage: 4, day: 60, kind: "recovery_decision" },
] as const;

export type ArrearsStageKind = (typeof ARREARS_STAGES)[number]["kind"];

/** Highest stage reached for a given days-overdue count (0 = none). */
export function arrearsStage(daysOverdue: number): number {
  let reached = 0;
  for (const s of ARREARS_STAGES) {
    if (daysOverdue >= s.day) reached = s.stage;
  }
  return reached;
}

export function stageKind(stage: number): ArrearsStageKind | null {
  return ARREARS_STAGES.find((s) => s.stage === stage)?.kind ?? null;
}
