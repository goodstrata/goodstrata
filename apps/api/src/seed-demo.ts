/**
 * Seed "48 Rose St, Fitzroy" — a 12-lot walk-up mid-story:
 *  - active scheme, adopted budget, Q1 levies issued
 *  - every lot paid except lot 7, now 47 days in arrears (stage 3, 13 days
 *    from the day-60 committee gate)
 *  - one untriaged maintenance request, 4 contractors, insurance on file,
 *    last AGM 11 months ago
 *
 * Events are appended with historical clocks; when the API boots, the
 * dispatcher catches up and the agents react — the demo starts alive.
 *
 * Run: pnpm seed:demo   (DATABASE_URL required; safe to run once per db)
 */
import {
  arrearsService,
  budgetsService,
  decisionsService,
  documentsService,
  leviesService,
  maintenanceService,
  meetingsService,
  paymentsService,
  type ServiceContext,
} from "@goodstrata/core";
import {
  createDb,
  funds,
  lots,
  memberships,
  ownerships,
  people,
  runMigrations,
  schemes,
} from "@goodstrata/db";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, toDateOnly, userActor } from "@goodstrata/shared";
import { createAuth } from "./auth.js";
import { loadEnv } from "./env.js";

const DEMO_EMAIL = "demo@goodstrata.local";
const DEMO_PASSWORD = "goodstrata-demo";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const LOT_SPECS: { lotNumber: string; liability: number; name: string; email: string }[] = [
  { lotNumber: "1", liability: 20, name: "Sam Shopkeeper", email: "sam@demo.goodstrata.local" },
  { lotNumber: "2", liability: 10, name: "Alex Chen", email: "alex@demo.goodstrata.local" },
  { lotNumber: "3", liability: 10, name: "Kim Nguyen", email: "kim@demo.goodstrata.local" },
  { lotNumber: "4", liability: 10, name: "Priya Sharma", email: "priya@demo.goodstrata.local" },
  { lotNumber: "5", liability: 10, name: "Jo Walker", email: "jo@demo.goodstrata.local" },
  { lotNumber: "6", liability: 10, name: "Marco Rossi", email: "marco@demo.goodstrata.local" },
  { lotNumber: "7", liability: 10, name: "Pat Latimer", email: "pat@demo.goodstrata.local" },
  { lotNumber: "8", liability: 10, name: "Dana Okafor", email: "dana@demo.goodstrata.local" },
  { lotNumber: "9", liability: 10, name: "Lee Tran", email: "lee@demo.goodstrata.local" },
  { lotNumber: "10", liability: 10, name: "Ruth Cohen", email: "ruth@demo.goodstrata.local" },
  { lotNumber: "11", liability: 10, name: "Omar Haddad", email: "omar@demo.goodstrata.local" },
  { lotNumber: "12", liability: 10, name: "Grace Park", email: "grace@demo.goodstrata.local" },
];

async function main() {
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);
  const { db, pool } = createDb(env.DATABASE_URL);
  const integrations = {
    ...integrationsFromEnv(env),
    payments: mockPaymentsProvider(env.MOCK_PAYMENTS_SECRET),
  };

  const ctxAt = (at: Date, actor: Actor): ServiceContext => ({
    db,
    clock: fixedClock(at),
    integrations,
    actor,
  });

  const existing = await db.query.schemes.findFirst();
  if (existing) {
    console.log(`Demo already seeded (${existing.name}). Drop the database to reseed.`);
    await pool.end();
    return;
  }

  // --- Demo login ---
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    appUrl: env.APP_URL,
    email: integrations.email,
  });
  const signup = await auth.api.signUpEmail({
    body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo Manager" },
  });
  const userId = signup.user.id;
  const manager = (at: Date) => ctxAt(at, userActor(userId));
  const system = (at: Date) => ctxAt(at, systemActor("seed"));

  // --- Scheme, 11 months ago ---
  const t330 = daysAgo(330);
  const schemeRows = await db
    .insert(schemes)
    .values({
      name: "48 Rose St Owners Corporation",
      planOfSubdivision: "PS543210V",
      addressLine1: "48 Rose Street",
      suburb: "Fitzroy",
      state: "VIC",
      postcode: "3065",
      tier: 3,
      status: "active",
    })
    .returning();
  const schemeId = schemeRows[0]!.id;
  await db.insert(funds).values([
    { schemeId, kind: "admin", name: "Administration fund" },
    { schemeId, kind: "maintenance", name: "Maintenance fund" },
  ]);
  await db.insert(memberships).values([
    { schemeId, userId, role: "manager_admin", startedOn: toDateOnly(t330) },
    { schemeId, userId, role: "treasurer", startedOn: toDateOnly(t330) },
    { schemeId, userId, role: "chair", startedOn: toDateOnly(t330) },
  ]);

  const lotIds = new Map<string, string>();
  for (const spec of LOT_SPECS) {
    const lotRows = await db
      .insert(lots)
      .values({
        schemeId,
        lotNumber: spec.lotNumber,
        lotType: spec.lotNumber === "1" ? "commercial" : "residential",
        entitlement: spec.liability,
        liability: spec.liability,
      })
      .returning();
    lotIds.set(spec.lotNumber, lotRows[0]!.id);
    const [givenName, ...rest] = spec.name.split(" ");
    const personRows = await db
      .insert(people)
      .values({ schemeId, givenName, familyName: rest.join(" "), email: spec.email })
      .returning();
    await db.insert(ownerships).values({
      schemeId,
      lotId: lotRows[0]!.id,
      personId: personRows[0]!.id,
      startedOn: toDateOnly(t330),
    });
  }
  console.log(`✓ scheme + ${LOT_SPECS.length} lots + owners`);

  // --- Second demo login: Alex Chen, owner of lot 2 ---
  const ownerSignup = await auth.api.signUpEmail({
    body: { email: "alex@demo.goodstrata.local", password: DEMO_PASSWORD, name: "Alex Chen" },
  });
  const { eq: eqOp } = await import("drizzle-orm");
  await db
    .update(people)
    .set({ userId: ownerSignup.user.id })
    .where(eqOp(people.email, "alex@demo.goodstrata.local"));
  await db.insert(memberships).values({
    schemeId,
    userId: ownerSignup.user.id,
    role: "owner",
    startedOn: toDateOnly(t330),
  });
  console.log("✓ owner login (alex@demo.goodstrata.local)");

  // --- Insurance certificate on file ---
  await documentsService.uploadDocument(manager(t330), schemeId, {
    filename: "certificate-of-currency-2026.pdf",
    contentType: "application/pdf",
    content: new TextEncoder().encode("%PDF-1.4 demo certificate of currency"),
    category: "insurance",
    title: "Insurance certificate of currency",
  });

  // --- Last AGM, 11 months ago (compliance turns amber soon) ---
  const t335 = daysAgo(335);
  const agm = await meetingsService.createMeeting(manager(t335), schemeId, {
    kind: "agm",
    title: "2025 Annual General Meeting",
    scheduledAt: daysAgo(320).toISOString(),
    location: "Common courtyard",
    agenda: [{ title: "Financial statements" }, { title: "Committee election" }],
  });
  await meetingsService.sendMeetingNotice(manager(t335), schemeId, agm.id);
  await meetingsService.closeMeeting(manager(daysAgo(320)), schemeId, agm.id);
  console.log("✓ historical AGM");

  // --- Budget, adopted 100 days ago ---
  const t100 = daysAgo(100);
  const budget = await budgetsService.createBudget(manager(t100), schemeId, {
    fiscalYearStart: toDateOnly(daysAgo(90)),
    adminCents: 4_800_000,
    maintenanceCents: 1_200_000,
  });
  const pending = await decisionsService.listDecisions(manager(t100), schemeId, "pending");
  const budgetDecision = pending.find((d) => (d.subject as { id?: string })?.id === budget.id)!;
  await decisionsService.resolveDecision(manager(t100), schemeId, budgetDecision.id, "approve", [
    "treasurer",
  ]);
  await decisionsService.executeDecisionFollowUp(system(t100), budgetDecision.id);
  console.log("✓ budget adopted ($48k admin / $12k maintenance)");

  // --- Q1 levies: issued 77 days ago, due 47 days ago ---
  const schedule = await leviesService.createLevySchedule(manager(daysAgo(77)), schemeId, {
    budgetId: budget.id,
    frequency: "quarterly",
    firstDueOn: toDateOnly(daysAgo(47)),
  });
  await leviesService.issueLevyRun(manager(daysAgo(77)), schemeId, schedule.id, 1);

  // --- Everyone pays except lot 7 ---
  const notices = await leviesService.listNotices(system(daysAgo(40)), schemeId);
  const provider = integrations.payments;
  let paid = 0;
  for (const notice of notices) {
    if (notice.lotId === lotIds.get("7")) continue;
    const body = provider.buildWebhookBody({
      payid: notice.payid!,
      amountCents: notice.totalCents,
      paidAt: daysAgo(40).toISOString(),
      payerName: "Demo owner",
    });
    await paymentsService.recordInboundPayment(
      system(daysAgo(40)),
      "mock",
      provider.parseWebhook(body),
    );
    paid += 1;
  }
  console.log(`✓ Q1 levies issued; ${paid}/12 paid — lot 7 now 47 days overdue`);

  // --- Contractors ---
  for (const [businessName, trades] of [
    ["Fitzroy Plumbing Co", ["plumbing"]],
    ["Rapid Roofing", ["roofing"]],
    ["Brunswick Sparks", ["electrical"]],
    ["GreenThumb Gardens", ["garden", "cleaning"]],
  ] as const) {
    await maintenanceService.createContractor(manager(daysAgo(200)), schemeId, {
      businessName,
      email: `${businessName.toLowerCase().replace(/\s+/g, ".")}@demo.goodstrata.local`,
      tradeCategories: [...trades],
    });
  }

  // --- An untriaged maintenance request (the agent picks it up on boot) ---
  await maintenanceService.createMaintenanceRequest(system(daysAgo(0)), schemeId, {
    title: "Water stain on lot 9 ceiling",
    description:
      "Brown stain on the top-floor ceiling below the roofline, growing after heavy rain. Paint starting to bubble.",
  });

  // --- Arrears sweep now: lot 7 hits stage 3, the finance agent reacts on boot ---
  const scan = await arrearsService.scanArrears(system(new Date()), schemeId);
  console.log(`✓ arrears scan: ${scan.emitted.length} stage event(s) emitted`);

  console.log("");
  console.log("Demo ready. Sign in at the web app with:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log("");
  console.log("Start the API and watch the Agents + Activity tabs — the dispatcher");
  console.log("catches up on seeded events and the agents go to work.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
