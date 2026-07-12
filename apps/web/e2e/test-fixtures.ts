import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * A retry runs against the same database as its failed attempt. Use the worker
 * and retry indices anywhere a journey creates globally unique records.
 */
export const attemptId = (testInfo: TestInfo) => `w${testInfo.workerIndex}-r${testInfo.retry}`;

/** Build a valid, retry-safe Victorian plan number with a spec-specific prefix. */
export const attemptPlan = (prefix: string, checkLetter: string, testInfo: TestInfo) => {
  const worker = String(testInfo.workerIndex % 1_000).padStart(3, "0");
  return `PS${prefix}${worker}${testInfo.retry % 10}${checkLetter}`;
};

/** Named lot invites now lock the source-of-truth name from the register. */
export async function expectPrefilledInviteName(page: Page, name: string) {
  const field = page.locator("#join-name");
  await expect(field).toHaveValue(name);
  await expect(field).toBeDisabled();
}
