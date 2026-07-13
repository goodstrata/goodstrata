import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { attemptId, attemptPlan, schemeIdFromPage } from "./test-fixtures";

const componentSource = (relativePath: string) =>
  readFile(fileURLToPath(new URL(`../src/components/${relativePath}`, import.meta.url)), "utf8");

test("motion-sensitive primitives honour reduced-motion preferences", async () => {
  const primitivePaths = [
    "ui/dialog.tsx",
    "ui/sheet.tsx",
    "ui/dropdown-menu.tsx",
    "ui/tooltip.tsx",
    "ui/select.tsx",
    "ui/skeleton.tsx",
  ];
  const primitiveSources = await Promise.all(primitivePaths.map(componentSource));

  for (const source of primitiveSources) {
    expect(source).toContain("motion-reduce:animate-none!");
  }
  expect(primitiveSources[1]).toContain("motion-reduce:transition-none!");
});

test("certificate selection and mutation failures retain accessible announcements", async () => {
  const source = await componentSource("BuildingComplianceTab.tsx");

  expect(source).toContain("<CardDescription id={certificateDescriptionId}>");
  expect(source).toMatch(
    /<Field label="Certificate">[\s\S]*?<SelectTrigger \{\.\.\.control\} aria-describedby=\{certificateDescriptionId\}>/,
  );
  expect(source.match(/role="alert"/g) ?? []).toHaveLength(3);
});

test("dense form pairs stack before the 420px breakpoint", async () => {
  const [rfq, records] = await Promise.all([
    componentSource("RfqSection.tsx"),
    componentSource("sections/RecordsSection.tsx"),
  ]);
  const responsivePair = /grid grid-cols-1 gap-3 min-\[420px\]:grid-cols-2/g;

  expect(rfq.match(responsivePair) ?? []).toHaveLength(3);
  expect(records.match(responsivePair) ?? []).toHaveLength(2);
});

test("the draft RFQ editor stays behind a dialog-only lazy boundary", async () => {
  const source = await componentSource("RfqSection.tsx");

  expect(source).not.toContain('import { MarkdownEditor } from "@/components/ui/markdown-editor";');
  expect(source).toMatch(
    /const MarkdownEditor = lazy\(\(\) =>[\s\S]*?import\("@\/components\/ui\/markdown-editor"\)/,
  );
  expect(source).toContain("<Suspense");
  expect(source).toContain("<ScopeEditorSkeleton");
});

test("reduced-motion overlays and 320px forms work in the live scheme UI", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const id = attemptId(testInfo);

  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Ari Access");
  await page.getByPlaceholder("you@example.com").fill(`access.${id}@example.com`);
  await page.getByPlaceholder("Choose a password").fill("access-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page
    .getByPlaceholder("e.g. 48 Rose St Owners Corporation")
    .fill(`32 Narrow Lane Owners Corporation ${id}`);
  await page.getByPlaceholder("e.g. PS543210V").fill(attemptPlan("32", "A", testInfo));
  await page.getByPlaceholder("Street address").fill("32 Narrow Lane");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();

  const schemeId = schemeIdFromPage(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/schemes/${schemeId}?section=records`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
    true,
  );
  await expect(page.getByRole("heading", { name: "Owners corporation records" })).toBeVisible();

  const inspectionEntitlement = page.getByRole("combobox", { name: "Entitlement" });
  const inspectionScope = page.getByRole("combobox", { name: "Inspect" });
  const certificateLot = page.getByRole("combobox", { name: "Lot" });
  const certificateService = page.getByRole("combobox", { name: "Service" });

  for (const [first, second] of [
    [inspectionEntitlement, inspectionScope],
    [certificateLot, certificateService],
  ]) {
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "Scheme sections" });
  await expect(sheet).toBeVisible();
  expect(
    await sheet.evaluate((element) => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, transitionDuration: style.transitionDuration };
    }),
  ).toEqual({ animationName: "none", transitionDuration: "0s" });
  await page.keyboard.press("Escape");

  await page.goto(`/schemes/${schemeId}?section=insurance`);
  await page.getByRole("button", { name: "Record policy" }).click();
  const certificate = page.getByRole("combobox", { name: "Certificate" });
  const descriptionId = await certificate.getAttribute("aria-describedby");
  expect(descriptionId).toBeTruthy();
  await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText(
    "The certificate must already be in the document register.",
  );

  await page.getByRole("combobox", { name: "Cover type" }).click();
  const selectContent = page.locator('[data-slot="select-content"]');
  await expect(selectContent).toBeVisible();
  expect(await selectContent.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    "none",
  );
});
