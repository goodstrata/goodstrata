/**
 * MCP WRITE tools — the mutating surface of the GoodStrata MCP.
 *
 * Every tool here is gated on the `mcp:write` OAuth scope (helpers.requireScope)
 * BEFORE any scheme lookup, so a read-only token cannot mutate anything and the
 * failure names the missing scope. Scheme-scoped tools then funnel through
 * `ctx.actor(schemeId, [roles])`, which enforces membership (404 for
 * non-members, existence never leaked) and the role tier — matching the HTTP
 * routes in ../../routes exactly (member-level create vs officer-tier gates).
 *
 * These are the SAFE writes: they create records or open a human decision gate,
 * but none of them move money, issue a statutory notice, or resolve a vote.
 *
 * TODO(v1.1): the money-moving / statutory tools still need the two-phase
 *   preview→confirm pattern (a dry-run that returns what WOULD happen, then an
 *   explicit confirm token) plus the `mcp:govern` scope before they can ship:
 *     - issue_levy_run     (leviesService.issueLevyRun — charges owners)
 *     - send_meeting_notice (statutory notice with legal timing effects)
 *     - resolve_decision   (decisionsService.resolveDecision — executes follow-up)
 *     - cast_motion_vote   (decisionsService.castDecisionVote — records a vote)
 *     - close_meeting      (finalises minutes / statutory record)
 */
import {
  budgetsService,
  communityService,
  createBudgetInput,
  createCommentInput,
  createPostInput,
  createRequestInput,
  createSchemeInput,
  invitesService,
  maintenanceService,
  peopleService,
  schemesService,
} from "@goodstrata/core";
import { MEMBERSHIP_ROLES, userActor } from "@goodstrata/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolContext } from "../server.js";
import { guard, jsonResult, requireScope } from "./helpers.js";

/** Officer tier that may act on scheme finances / member admin (manager_admin bypasses in ctx.actor). */
const OFFICER_ROLES = ["chair", "secretary", "treasurer"] as const;

export function registerWriteTools(server: McpServer, ctx: McpToolContext): void {
  // ── create_scheme ─────────────────────────────────────────────────────────
  // No scheme guard (there is no scheme yet). The caller becomes the new
  // scheme's manager_admin (enforced in schemesService.createScheme).
  server.registerTool(
    "create_scheme",
    {
      title: "Create a scheme",
      description:
        "Create a new strata scheme / owners corporation in onboarding status, with its two statutory funds (administration + maintenance). The authenticated user automatically becomes the scheme's manager_admin. Returns the new schemeId to use with every other tool. Fails with SCHEME_EXISTS if the plan of subdivision is already registered.",
      inputSchema: createSchemeInput.shape,
      annotations: { title: "Create a scheme", readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      guard(async () => {
        requireScope(ctx.auth, "mcp:write");
        const svc = ctx.deps.serviceContext(userActor(ctx.auth.userId));
        const scheme = await schemesService.createScheme(svc, input);
        return jsonResult(
          `Created scheme "${scheme.name}" (${scheme.planOfSubdivision}); you are its manager_admin. schemeId: ${scheme.id}.`,
          { scheme },
        );
      }),
  );

  // ── create_maintenance_request ────────────────────────────────────────────
  // Member-level (any member may report an issue), matching the HTTP route.
  server.registerTool(
    "create_maintenance_request",
    {
      title: "Report a maintenance issue",
      description:
        "Log a maintenance request for a scheme the caller belongs to (e.g. a leaking common-property tap). Opens in 'open' status awaiting triage; it does NOT engage a contractor or spend money. Any member may report. Returns NOT_FOUND if the caller is not a member.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        ...createRequestInput.shape,
      },
      annotations: {
        title: "Report a maintenance issue",
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    ({ schemeId, ...input }) =>
      guard(async () => {
        requireScope(ctx.auth, "mcp:write");
        const { ctx: svc } = await ctx.actor(schemeId);
        const request = await maintenanceService.createMaintenanceRequest(svc, schemeId, input);
        return jsonResult(
          `Logged maintenance request "${request.title}" (status: ${request.status}). requestId: ${request.id}.`,
          { request },
        );
      }),
  );

  // ── create_community_post ─────────────────────────────────────────────────
  // Member-level. Text-only from MCP (image upload is a multipart HTTP concern).
  server.registerTool(
    "create_community_post",
    {
      title: "Post to the community feed",
      description:
        "Publish a text post to a scheme's community noticeboard. Any member may post. Image attachments are not supported over MCP (use the web app). Returns NOT_FOUND if the caller is not a member.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        ...createPostInput.shape,
      },
      annotations: {
        title: "Post to the community feed",
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    ({ schemeId, ...input }) =>
      guard(async () => {
        requireScope(ctx.auth, "mcp:write");
        const { ctx: svc } = await ctx.actor(schemeId);
        const post = await communityService.createPost(svc, schemeId, input);
        return jsonResult(`Posted to the community feed. postId: ${post.id}.`, { post });
      }),
  );

  // ── add_community_comment ─────────────────────────────────────────────────
  // Member-level. Comments on an existing visible post.
  server.registerTool(
    "add_community_comment",
    {
      title: "Comment on a community post",
      description:
        "Add a comment to an existing community post in a scheme the caller belongs to. Any member may comment. Returns NOT_FOUND if the caller is not a member or the post does not exist / was removed.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        postId: z.string().describe("Post id from get_community_feed / create_community_post"),
        ...createCommentInput.shape,
      },
      annotations: {
        title: "Comment on a community post",
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    ({ schemeId, postId, ...input }) =>
      guard(async () => {
        requireScope(ctx.auth, "mcp:write");
        const { ctx: svc } = await ctx.actor(schemeId);
        const { comment } = await communityService.addComment(svc, schemeId, postId, input);
        return jsonResult(`Added comment to post ${postId}. commentId: ${comment.id}.`, {
          comment,
        });
      }),
  );

  // ── invite_person ─────────────────────────────────────────────────────────
  // Officer/admin-tier (matches the HTTP invite route). Creates the person
  // record and emails them a one-time join link.
  server.registerTool(
    "invite_person",
    {
      title: "Invite a person to a scheme",
      description:
        "Create a person record and email them a one-time link to join the scheme's portal in the given role (default: owner). Requires an officer role (chair, secretary, or treasurer) or manager_admin. An email address is required so the invite can be delivered. The invite link expires in 14 days.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        email: z.string().email().describe("Recipient email — the invite is sent here (required)"),
        givenName: z.string().optional().describe("First name"),
        familyName: z.string().optional().describe("Surname"),
        companyName: z.string().optional().describe("Company name, for a corporate owner"),
        phone: z.string().optional(),
        role: z
          .enum(MEMBERSHIP_ROLES)
          .default("owner")
          .describe("Membership role granted on acceptance (default: owner)"),
      },
      annotations: {
        title: "Invite a person to a scheme",
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    ({ schemeId, email, givenName, familyName, companyName, phone, role }) =>
      guard(async () => {
        requireScope(ctx.auth, "mcp:write");
        const { ctx: svc } = await ctx.actor(schemeId, [...OFFICER_ROLES]);
        const person = await peopleService.createPerson(svc, schemeId, {
          givenName,
          familyName,
          companyName,
          email,
          phone,
        });
        const result = await invitesService.invitePerson(
          svc,
          schemeId,
          person.id,
          role,
          ctx.deps.env.APP_URL,
        );
        return jsonResult(
          `Invited ${email} to join as ${role.replace("_", " ")}; join link emailed (expires ${result.expiresAt.toISOString()}). personId: ${person.id}.`,
          { personId: person.id, email, role, expiresAt: result.expiresAt },
        );
      }),
  );

  // ── draft_budget ──────────────────────────────────────────────────────────
  // HIGHER-STAKES: this opens a treasurer decision gate. It moves NO money — it
  // drafts the budget and requests a human decision. On the treasurer's
  // approval the budget becomes adopted and levies can then be issued against
  // it (a separate, still-manual step). Officer/admin-tier, matching the route.
  server.registerTool(
    "draft_budget",
    {
      title: "Draft a budget (opens a decision requiring human approval)",
      description:
        "Draft an annual budget (administration + maintenance fund totals, in cents) and OPEN A TREASURER DECISION GATE to adopt it. IMPORTANT: this moves no money and does not raise any levy on its own — it creates a budget in committee_review status and a pending decision that a human treasurer must approve. Only on that approval does the budget become adopted, after which levy schedules can be issued against it as a separate step. Requires an officer role (chair, secretary, or treasurer) or manager_admin.",
      inputSchema: {
        schemeId: z.string().describe("Scheme id from list_schemes"),
        ...createBudgetInput.shape,
      },
      annotations: {
        title: "Draft a budget (opens a decision requiring human approval)",
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    ({ schemeId, ...input }) =>
      guard(async () => {
        requireScope(ctx.auth, "mcp:write");
        const { ctx: svc } = await ctx.actor(schemeId, [...OFFICER_ROLES]);
        const budget = await budgetsService.createBudget(svc, schemeId, input);
        return jsonResult(
          `Drafted budget for FY starting ${budget.fiscalYearStart} and opened a treasurer decision to adopt it (no money moved). budgetId: ${budget.id}; decisionId: ${budget.decisionId}. A human treasurer must approve the decision before the budget is adopted.`,
          { budget },
        );
      }),
  );
}
