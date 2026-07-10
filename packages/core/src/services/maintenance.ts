import { randomBytes } from "node:crypto";
import { contractors, lots, maintenanceRequests, schemes, workOrders } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { addDays, formatCents } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import {
  emailBrand,
  infoNote,
  keyValueTable,
  markdownBlock,
  paragraph,
  renderEmail,
} from "../email/index.js";
import { DomainError, notFound } from "../errors.js";
import { sendEmail } from "./comms.js";
import { registerDecisionAction, requestDecision } from "./decisions.js";

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const createRequestInput = z.object({
  // trim before min(3): a whitespace-only title must not pass validation.
  title: z.string().trim().min(3).max(200),
  description: z.string().min(3).max(5000),
  lotId: z.string().optional(),
  reportedByPersonId: z.string().optional(),
  /**
   * The reporter's own "this is an emergency" flag, captured at intake. This
   * is the ONLY signal that can authorise immediate work-order dispatch —
   * agent triage urgency never does (see proposeWorkOrder).
   */
  reportedEmergency: z.boolean().optional(),
});
export type CreateRequestInput = z.infer<typeof createRequestInput>;

export async function createMaintenanceRequest(
  ctx: ServiceContext,
  schemeId: string,
  input: CreateRequestInput,
) {
  if (input.lotId) {
    const lot = await ctx.db.query.lots.findFirst({
      where: and(eq(lots.id, input.lotId), eq(lots.schemeId, schemeId)),
    });
    if (!lot) throw notFound("Lot");
  }
  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(maintenanceRequests)
      .values({
        schemeId,
        lotId: input.lotId ?? null,
        reportedByPersonId: input.reportedByPersonId ?? null,
        title: input.title,
        description: input.description,
        reportedEmergency: input.reportedEmergency ?? false,
        status: "open",
      })
      .returning();
    const request = rows[0]!;

    await publishEvent(tx, {
      schemeId,
      stream: `maintenance_request:${request.id}`,
      type: "maintenance.request.created",
      payload: {
        requestId: request.id,
        title: request.title,
        description: request.description,
        lotId: request.lotId,
        reportedEmergency: request.reportedEmergency,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return request;
  });
}

export async function listRequests(ctx: ServiceContext, schemeId: string) {
  return await ctx.db.query.maintenanceRequests.findMany({
    where: eq(maintenanceRequests.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

export const triageInput = z.object({
  category: z.string().min(2).max(50),
  urgency: z.enum(["emergency", "high", "routine"]),
  isCommonProperty: z.boolean(),
  reasoning: z.string().max(2000),
});
export type TriageInput = z.infer<typeof triageInput>;

/** Persist agent triage (category/urgency/common-property assessment). */
export async function applyTriage(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
  input: TriageInput,
) {
  return await ctx.db.transaction(async (tx) => {
    const request = await tx.query.maintenanceRequests.findFirst({
      where: and(eq(maintenanceRequests.id, requestId), eq(maintenanceRequests.schemeId, schemeId)),
    });
    if (!request) throw notFound("Maintenance request");
    if (request.status !== "open") {
      throw new DomainError("ALREADY_TRIAGED", "Request has already been triaged", 409);
    }

    await tx
      .update(maintenanceRequests)
      .set({
        category: input.category,
        urgency: input.urgency,
        isCommonProperty: input.isCommonProperty,
        aiTriage: { ...input, actor: ctx.actor },
        status: "triaged",
      })
      .where(eq(maintenanceRequests.id, requestId));

    await publishEvent(tx, {
      schemeId,
      stream: `maintenance_request:${requestId}`,
      type: "maintenance.request.triaged",
      payload: {
        requestId,
        category: input.category,
        urgency: input.urgency,
        isCommonProperty: input.isCommonProperty,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return { requestId };
  });
}

/**
 * Close a request that is the lot owner's responsibility (not common
 * property): explain, email the requester, done.
 */
export async function declineAsLotResponsibility(
  ctx: ServiceContext,
  schemeId: string,
  requestId: string,
  explanation: string,
) {
  const request = await ctx.db.query.maintenanceRequests.findFirst({
    where: and(eq(maintenanceRequests.id, requestId), eq(maintenanceRequests.schemeId, schemeId)),
  });
  if (!request) throw notFound("Maintenance request");
  if (request.status !== "open" && request.status !== "triaged") {
    throw new DomainError("BAD_STATUS", `Cannot decline a ${request.status} request`, 409);
  }

  await ctx.db.transaction(async (tx) => {
    const priorTriage =
      request.aiTriage && typeof request.aiTriage === "object"
        ? (request.aiTriage as Record<string, unknown>)
        : {};
    await tx
      .update(maintenanceRequests)
      .set({
        status: "rejected",
        // Keep the explanation with the triage record so the portal can show
        // the requester why the OC won't arrange the works (email aside).
        aiTriage: { ...priorTriage, declineExplanation: explanation },
      })
      .where(eq(maintenanceRequests.id, requestId));
    await publishEvent(tx, {
      schemeId,
      stream: `maintenance_request:${requestId}`,
      type: "maintenance.request.triaged",
      payload: {
        requestId,
        category: request.category ?? "lot_responsibility",
        urgency: request.urgency ?? "routine",
        isCommonProperty: false,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  if (request.reportedByPersonId) {
    const person = await ctx.db.query.people.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.id, request.reportedByPersonId!),
    });
    const email = person[0]?.email;
    if (email) {
      const requestUrl = `${emailBrand.urls.app}/schemes/${schemeId}?section=maintenance`;
      const { html, text } = renderEmail({
        preheader: `An update on your maintenance request: ${request.title}.`,
        heading: `About your maintenance request: ${request.title}`,
        blocks: [
          paragraph(explanation),
          infoNote(
            "This request has been assessed as the lot owner's responsibility rather than common property, so the owners corporation will not arrange the works. You can view the full request and its history in the portal.",
          ),
        ],
        cta: { label: "View request", url: requestUrl },
      });
      await sendEmail(ctx, {
        schemeId,
        personId: request.reportedByPersonId,
        to: email,
        subject: `About your maintenance request: ${request.title}`,
        template: "maintenance_lot_responsibility",
        related: { type: "maintenance_request", id: requestId },
        body: text,
        html,
      });
    }
  }
  return { requestId };
}

// ---------------------------------------------------------------------------
// Contractors
// ---------------------------------------------------------------------------

export const createContractorInput = z.object({
  businessName: z.string().min(2).max(200),
  abn: z.string().optional(),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  tradeCategories: z.array(z.string()).min(1),
});
export type CreateContractorInput = z.infer<typeof createContractorInput>;

export async function createContractor(
  ctx: ServiceContext,
  schemeId: string,
  input: CreateContractorInput,
) {
  const rows = await ctx.db
    .insert(contractors)
    .values({ schemeId, ...input, status: "approved" })
    .returning();
  return rows[0]!;
}

export async function listContractors(ctx: ServiceContext, schemeId: string, category?: string) {
  const rows = await ctx.db.query.contractors.findMany({
    where: and(eq(contractors.schemeId, schemeId), eq(contractors.status, "approved")),
  });
  if (!category) return rows;
  return rows.filter((c) =>
    c.tradeCategories.some((t) => t.toLowerCase().includes(category.toLowerCase())),
  );
}

// ---------------------------------------------------------------------------
// Work orders — code routes by threshold; the LLM never decides the path.
// ---------------------------------------------------------------------------

export const proposeWorkOrderInput = z.object({
  requestId: z.string(),
  contractorId: z.string(),
  scope: z.string().min(5).max(5000),
  estimatedCents: z.number().int().positive(),
  accessNotes: z.string().max(1000).optional(),
});
export type ProposeWorkOrderInput = z.infer<typeof proposeWorkOrderInput>;

export type WorkOrderRoute =
  | { mode: "auto_dispatched"; workOrderId: string }
  | { mode: "emergency_dispatched"; workOrderId: string; reviewDecisionId: string }
  | { mode: "awaiting_approval"; workOrderId: string; decisionId: string };

/**
 * Create a work order for a triaged request and route it per SPEC §4.2, with
 * one hard safety rule: LLM-ORIGINATED VALUES NEVER GATE AUTO-DISPATCH.
 *
 *  - reporter flagged the request an emergency at intake (human origin) →
 *    dispatch now + post-hoc committee review. Triage `urgency` (LLM output)
 *    deliberately plays no part in this.
 *  - a human officer proposes ≤ the auto-approve threshold → dispatch now
 *    (the estimate is the officer's own figure).
 *  - everything else — including EVERY agent-proposed work order that isn't a
 *    reporter-flagged emergency — goes to the committee decision gate
 *    (multi-quote note above the higher bar).
 */
export async function proposeWorkOrder(
  ctx: ServiceContext,
  schemeId: string,
  input: ProposeWorkOrderInput,
): Promise<WorkOrderRoute> {
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });
  if (!scheme) throw notFound("Scheme");
  const request = await ctx.db.query.maintenanceRequests.findFirst({
    where: and(
      eq(maintenanceRequests.id, input.requestId),
      eq(maintenanceRequests.schemeId, schemeId),
    ),
  });
  if (!request) throw notFound("Maintenance request");
  if (request.status !== "triaged") {
    throw new DomainError("NOT_TRIAGED", "Request must be triaged before a work order", 409);
  }
  const contractor = await ctx.db.query.contractors.findFirst({
    where: and(eq(contractors.id, input.contractorId), eq(contractors.status, "approved")),
  });
  if (!contractor) throw notFound("Approved contractor");

  const { maintenanceAutoApproveCents, maintenanceMultiQuoteCents } = scheme.settings;
  // Human origin only: the reporter's intake flag. request.urgency is agent
  // triage (LLM output) and must never authorise an immediate dispatch.
  const isEmergency = request.reportedEmergency;
  // The auto-approve threshold applies to human officers (and trusted code)
  // whose estimate is their own figure — NEVER to an agent actor, whose
  // estimatedCents is LLM output and cannot wave its own work through.
  const withinAuto =
    ctx.actor.kind !== "agent" && input.estimatedCents <= maintenanceAutoApproveCents;

  const workOrderId = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(workOrders)
      .values({
        schemeId,
        requestId: input.requestId,
        contractorId: input.contractorId,
        scope: input.scope,
        approvedAmountCents: input.estimatedCents,
        accessNotes: input.accessNotes ?? null,
        status: "draft",
        // Self-service accept/decline credential; the dispatch email embeds it.
        acceptToken: randomBytes(24).toString("base64url"),
      })
      .returning();
    const wo = rows[0]!;

    await tx
      .update(maintenanceRequests)
      .set({ status: isEmergency || withinAuto ? "approved" : "quoting" })
      .where(eq(maintenanceRequests.id, input.requestId));

    await publishEvent(tx, {
      schemeId,
      stream: `work_order:${wo.id}`,
      type: "work_order.created",
      payload: {
        workOrderId: wo.id,
        requestId: input.requestId,
        contractorId: input.contractorId,
        amountCents: input.estimatedCents,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return wo.id;
  });

  if (isEmergency || withinAuto) {
    await dispatchWorkOrder(ctx, schemeId, workOrderId);
    if (!isEmergency) return { mode: "auto_dispatched", workOrderId };

    // Emergency post-hoc review (SPEC: auto-approve, notify committee after).
    const review = await requestDecision(ctx, {
      schemeId,
      kind: "emergency_review",
      title: `Emergency works dispatched — ${formatCents(input.estimatedCents)} (${contractor.businessName})`,
      summaryMd: [
        `Emergency maintenance was dispatched immediately because the reporter flagged the request as an emergency:`,
        "",
        `- **Request:** ${request.title}`,
        `- **Contractor:** ${contractor.businessName}`,
        `- **Approved amount:** ${formatCents(input.estimatedCents)}`,
        "",
        "This is a post-hoc review: acknowledge, or flag for discussion.",
      ].join("\n"),
      options: [
        { id: "approve", label: "Acknowledge" },
        { id: "decline", label: "Flag for discussion" },
      ],
      subject: { type: "work_order", id: workOrderId },
      deciderRole: "committee",
      dueAt: addDays(ctx.clock.now(), 7),
    });
    return { mode: "emergency_dispatched", workOrderId, reviewDecisionId: review.id };
  }

  // Over threshold → the committee decides before anything is dispatched.
  const needsMultiQuote = input.estimatedCents > maintenanceMultiQuoteCents;
  const decision = await requestDecision(ctx, {
    schemeId,
    kind: "quote_approval",
    title: `Approve works: ${request.title} — ${formatCents(input.estimatedCents)}`,
    summaryMd: [
      `- **Request:** ${request.title} (${request.category ?? "uncategorised"})`,
      `- **Contractor:** ${contractor.businessName}`,
      `- **Estimated cost:** ${formatCents(input.estimatedCents)}`,
      `- **Scope:** ${input.scope}`,
      needsMultiQuote
        ? `\n> ⚠ Above ${formatCents(maintenanceMultiQuoteCents)}: obtaining comparison quotes before approving is recommended.`
        : "",
    ].join("\n"),
    subject: { type: "work_order", id: workOrderId },
    deciderRole: "committee",
    dueAt: addDays(ctx.clock.now(), 7),
    followUp: {
      type: "action",
      action: "maintenance.dispatchWorkOrder",
      args: { workOrderId },
    },
    requestedByRunId: ctx.actor.kind === "agent" ? ctx.actor.agentRunId : undefined,
  });

  await ctx.db
    .update(workOrders)
    .set({ decisionId: decision.id })
    .where(eq(workOrders.id, workOrderId));

  return { mode: "awaiting_approval", workOrderId, decisionId: decision.id };
}

/** Dispatch: email the contractor, flip the status, record the event. */
export async function dispatchWorkOrder(
  ctx: ServiceContext,
  schemeId: string,
  workOrderId: string,
) {
  const wo = await ctx.db.query.workOrders.findFirst({
    where: and(eq(workOrders.id, workOrderId), eq(workOrders.schemeId, schemeId)),
  });
  if (!wo) throw notFound("Work order");
  if (wo.status !== "draft") return { workOrderId }; // idempotent (executor retries)

  // Absolute base for the accept link. Read off Integrations (built from
  // APP_URL) so every dispatch path — proposeWorkOrder, the award decision
  // executor — gets it without threading a param through each caller.
  const appUrl = ctx.integrations.appUrl ?? "https://my.goodstrata.com.au";

  const contractor = await ctx.db.query.contractors.findFirst({
    where: eq(contractors.id, wo.contractorId),
  });
  const scheme = await ctx.db.query.schemes.findFirst({ where: eq(schemes.id, schemeId) });

  await ctx.db.transaction(async (tx) => {
    await tx.update(workOrders).set({ status: "dispatched" }).where(eq(workOrders.id, workOrderId));
    await publishEvent(tx, {
      schemeId,
      stream: `work_order:${workOrderId}`,
      type: "work_order.dispatched",
      payload: { workOrderId, contractorId: wo.contractorId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  if (contractor?.email && scheme) {
    let location = "Common property";
    if (wo.requestId) {
      const request = await ctx.db.query.maintenanceRequests.findFirst({
        where: eq(maintenanceRequests.id, wo.requestId),
      });
      if (request?.lotId) {
        const lot = await ctx.db.query.lots.findFirst({ where: eq(lots.id, request.lotId) });
        location = `Lot ${lot?.lotNumber ?? "?"}`;
      }
    }
    const detailRows = [
      { label: "Location", value: location },
      {
        label: "Approved amount",
        value: `${formatCents(wo.approvedAmountCents)} (do not exceed without written approval)`,
      },
    ];
    if (wo.accessNotes) detailRows.push({ label: "Access", value: wo.accessNotes });

    // Self-service accept: the WO carries an unguessable accept token (minted at
    // award). The contractor confirms the engagement on the public
    // /work-order/{token} page — no login, no email reply parsing. A WO only
    // exists post-award, so linking the token here does NOT weaken the award
    // gate; the page confirms acceptance and never awards.
    const acceptUrl = wo.acceptToken ? `${appUrl}/work-order/${wo.acceptToken}` : null;
    const { html, text } = renderEmail({
      preheader: `Work order for ${scheme.name}: ${wo.scope}.`,
      heading: `Work order — ${scheme.name}`,
      intro: `Hi ${contractor.contactName ?? contractor.businessName}, you've been engaged for works at ${scheme.name}, ${scheme.addressLine1}, ${scheme.suburb}.`,
      blocks: [
        markdownBlock(wo.scope, "Scope of work"),
        keyValueTable(detailRows, "Work order details"),
        infoNote(
          acceptUrl
            ? "Open the work order to accept or decline it, and invoice the owners corporation on completion quoting this work order."
            : "Please confirm acceptance by replying to this email, and invoice the owners corporation on completion quoting this work order.",
        ),
      ],
      ...(acceptUrl ? { cta: { label: "Accept work order →", url: acceptUrl } } : {}),
    });
    await sendEmail(ctx, {
      schemeId,
      to: contractor.email,
      subject: `Work order — ${scheme.name}`,
      template: "work_order_dispatch",
      related: { type: "work_order", id: workOrderId },
      body: text,
      html,
    });
  }

  return { workOrderId };
}

export async function completeWorkOrder(
  ctx: ServiceContext,
  schemeId: string,
  workOrderId: string,
) {
  const wo = await ctx.db.query.workOrders.findFirst({
    where: and(eq(workOrders.id, workOrderId), eq(workOrders.schemeId, schemeId)),
  });
  if (!wo) throw notFound("Work order");
  if (!["dispatched", "accepted", "scheduled", "in_progress"].includes(wo.status)) {
    throw new DomainError("BAD_STATUS", `Cannot complete a ${wo.status} work order`, 409);
  }

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(workOrders)
      .set({ status: "completed", completedAt: ctx.clock.now() })
      .where(eq(workOrders.id, workOrderId));
    if (wo.requestId) {
      await tx
        .update(maintenanceRequests)
        .set({ status: "completed" })
        .where(eq(maintenanceRequests.id, wo.requestId));
    }
    await publishEvent(tx, {
      schemeId,
      stream: `work_order:${workOrderId}`,
      type: "work_order.completed",
      payload: { workOrderId },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });
  return { workOrderId };
}

export async function listWorkOrders(ctx: ServiceContext, schemeId: string) {
  const orders = await ctx.db.query.workOrders.findMany({
    where: eq(workOrders.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
  if (orders.length === 0) return [];

  // Denormalise the names a member actually reads on the list: who is doing
  // the work, and which request it answers. One query each — no N+1.
  const [contractorRows, requestRows] = await Promise.all([
    ctx.db.query.contractors.findMany({
      where: eq(contractors.schemeId, schemeId),
      columns: { id: true, businessName: true },
    }),
    ctx.db.query.maintenanceRequests.findMany({
      where: eq(maintenanceRequests.schemeId, schemeId),
      columns: { id: true, title: true },
    }),
  ]);
  const contractorNames = new Map(contractorRows.map((c) => [c.id, c.businessName]));
  const requestTitles = new Map(requestRows.map((r) => [r.id, r.title]));

  return orders.map((o) => ({
    ...o,
    contractorName: contractorNames.get(o.contractorId) ?? null,
    requestTitle: o.requestId ? (requestTitles.get(o.requestId) ?? null) : null,
  }));
}

// Executor: the committee said yes — dispatch it.
registerDecisionAction("maintenance.dispatchWorkOrder", async (ctx, args, decision) => {
  const { workOrderId } = z.object({ workOrderId: z.string() }).parse(args);
  await dispatchWorkOrder(ctx, decision.schemeId, workOrderId);
});
