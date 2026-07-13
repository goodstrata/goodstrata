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

/** Extract the active scheme UUID from a /schemes/:id URL. */
export function schemeIdFromPage(page: Page): string {
  const match = new URL(page.url()).pathname.match(/\/schemes\/([^/]+)/);
  if (!match?.[1]) throw new Error(`Expected a scheme URL, got ${page.url()}`);
  return match[1];
}

/**
 * Fixture-only statutory insurance setup for journeys whose subject is not
 * insurance. Uses the same authenticated API and structured policy contract as
 * the visible form; it never bypasses or weakens the activation gate.
 */
export async function prepareStructuredInsurance(
  page: Page,
  schemeId: string,
  options: { publicLiability: boolean },
) {
  const upload = await page.request.post(`/api/schemes/${schemeId}/documents`, {
    multipart: {
      file: {
        name: "certificate-of-currency.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 fake insurance certificate"),
      },
      category: "insurance",
      accessLevel: "owners",
    },
  });
  expect(upload.status()).toBe(201);
  const { document } = (await upload.json()) as { document: { id: string } };
  const year = new Date().getFullYear();
  const base = {
    insurer: "E2E Insurance Ltd",
    periodStart: `${year}-01-01`,
    periodEnd: `${year + 2}-12-31`,
    certificateDocumentId: document.id,
  };
  const building = await page.request.post(`/api/schemes/${schemeId}/insurance/policies`, {
    data: {
      ...base,
      kind: "building",
      policyNumber: `BLD-${schemeId.slice(0, 8)}`,
      sumInsuredCents: 100_000_000,
      reinstatementAndReplacement: true,
    },
  });
  expect(building.status()).toBe(201);
  if (options.publicLiability) {
    const liability = await page.request.post(`/api/schemes/${schemeId}/insurance/policies`, {
      data: {
        ...base,
        kind: "public_liability",
        policyNumber: `PL-${schemeId.slice(0, 8)}`,
        sumInsuredCents: 2_000_000_000,
      },
    });
    expect(liability.status()).toBe(201);
  }
  return document;
}
