/**
 * P0-1 — Per-OC statutory trust / bank accounts (OC Act s 122).
 *
 * A registered OC manager must hold each owners corporation's money in its OWN
 * segregated account. This service provisions and manages the per-OC accounts
 * backed by the `bank_accounts` table (UNIQUE per scheme + kind).
 *
 * Every mutation publishes a domain event in the same transaction (append-only
 * event_log).
 */
import { bankAccounts } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import type { SchemeAccount } from "@goodstrata/integrations";
import { BANK_ACCOUNT_KINDS, type BankAccountKind } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { notFound } from "../errors.js";

export type BankAccount = typeof bankAccounts.$inferSelect;

/** The kind of account that receives an OC's inbound levy money (its trust account). */
const TRUST_ACCOUNT_KIND: BankAccountKind = "virtual_collection";

export const provisionTrustAccountInput = z.object({
  kind: z.enum(BANK_ACCOUNT_KINDS),
  provider: z.string().default("mock"),
});
export type ProvisionTrustAccountInput = z.infer<typeof provisionTrustAccountInput>;

export const activateBankAccountInput = z.object({
  providerAccountId: z.string().optional(),
  bsb: z.string().optional(),
  accountNumber: z.string().optional(),
  payidRoot: z.string().optional(),
});
export type ActivateBankAccountInput = z.infer<typeof activateBankAccountInput>;

/**
 * Provision the per-OC segregated account for `kind`. Idempotent per
 * (schemeId, kind) — the UNIQUE index is the guard. Calls the payments provider
 * to create the scheme's OWN account (never a shared pool) and records it.
 *
 * GRACEFUL DEGRADATION: a provider outage (e.g. Monoova account provisioning
 * blocked upstream) must not stall the money loop. On provider failure the
 * account is recorded as `pending` with no details — levies still issue with
 * manual payment instructions — and every later `ensure…` call retries the
 * provider, so the account heals itself the moment the provider unblocks.
 */
export async function provisionTrustAccount(
  ctx: ServiceContext,
  schemeId: string,
  input: ProvisionTrustAccountInput,
): Promise<BankAccount> {
  // Fast path: already provisioned (retrying provider details if pending).
  const existing = await getBankAccount(ctx, schemeId, input.kind);
  if (existing) {
    if (existing.status === "pending" && !existing.providerAccountId) {
      return await retryDeferredProvisioning(ctx, schemeId, existing);
    }
    return existing;
  }

  // Ask the provider for THIS scheme's own account before opening the tx.
  let account: SchemeAccount | null = null;
  try {
    account = await ctx.integrations.payments.createSchemeAccount({ schemeId });
  } catch (err) {
    console.error(
      `[trust] provider account provisioning failed for scheme ${schemeId} — recording a PENDING account (manual payment rail applies until the provider unblocks)`,
      err,
    );
  }

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(bankAccounts)
      .values({
        schemeId,
        kind: input.kind,
        provider: input.provider,
        providerAccountId: account?.providerAccountId ?? null,
        bsb: account?.bsb ?? null,
        accountNumber: account?.accountNumber ?? null,
        payidRoot: account?.payidRoot ?? null,
        status: account ? "active" : "pending",
      })
      // The UNIQUE (schemeId, kind) index serialises concurrent provisioners.
      .onConflictDoNothing({ target: [bankAccounts.schemeId, bankAccounts.kind] })
      .returning();

    const created = rows[0];
    if (!created) {
      // Lost the race — another provisioner won; return theirs, no event.
      const other = await tx.query.bankAccounts.findFirst({
        where: and(eq(bankAccounts.schemeId, schemeId), eq(bankAccounts.kind, input.kind)),
      });
      if (!other) throw new Error("trust account provisioning: conflict but no row found");
      return other;
    }

    await publishEvent(tx, {
      schemeId,
      stream: `bank_account:${created.id}`,
      type: account ? "trust_account.provisioned" : "trust_account.provision_deferred",
      payload: {
        bankAccountId: created.id,
        kind: created.kind,
        provider: created.provider,
        providerAccountId: created.providerAccountId,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return created;
  });
}

/**
 * A pending account from an earlier failed provider call: retry the provider
 * now and activate on success. On another failure, keep the pending row —
 * the manual rail keeps working and the next ensure retries again.
 */
async function retryDeferredProvisioning(
  ctx: ServiceContext,
  schemeId: string,
  pending: BankAccount,
): Promise<BankAccount> {
  let account: SchemeAccount;
  try {
    account = await ctx.integrations.payments.createSchemeAccount({ schemeId });
  } catch (err) {
    console.error(
      `[trust] provider account provisioning still failing for scheme ${schemeId}`,
      err,
    );
    return pending;
  }

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(bankAccounts)
      .set({
        status: "active",
        providerAccountId: account.providerAccountId,
        bsb: account.bsb,
        accountNumber: account.accountNumber,
        payidRoot: account.payidRoot ?? null,
      })
      // Only heal a row still pending — a concurrent healer may have won.
      .where(and(eq(bankAccounts.id, pending.id), eq(bankAccounts.status, "pending")))
      .returning();
    const healed = rows[0];
    if (!healed) {
      const other = await tx.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, pending.id),
      });
      return other ?? pending;
    }

    await publishEvent(tx, {
      schemeId,
      stream: `bank_account:${healed.id}`,
      type: "trust_account.provisioned",
      payload: {
        bankAccountId: healed.id,
        kind: healed.kind,
        provider: healed.provider,
        providerAccountId: healed.providerAccountId,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return healed;
  });
}

/**
 * Ensure the scheme's inbound trust account exists, provisioning it on first
 * use. This is the guard levies call before allocating PayIDs so every levy
 * reference lands under the OC's OWN account.
 */
export async function ensureSchemeTrustAccount(
  ctx: ServiceContext,
  schemeId: string,
): Promise<BankAccount> {
  return provisionTrustAccount(ctx, schemeId, {
    kind: TRUST_ACCOUNT_KIND,
    provider: ctx.integrations.payments.name,
  });
}

/** The scheme's inbound trust account, if provisioned (read-only). */
export async function getSchemeTrustAccount(
  ctx: ServiceContext,
  schemeId: string,
): Promise<BankAccount | null> {
  return getBankAccount(ctx, schemeId, TRUST_ACCOUNT_KIND);
}

/**
 * Per-OC reconciliation guard. Given the scheme a payment reference resolved to,
 * return the trust account the money must post against — provisioning it if the
 * scheme predates trust-account rollout. Guarantees an inbound payment reconciles
 * only against its OWN scheme's segregated account, never a shared pool.
 */
export async function trustAccountForInboundPayment(
  ctx: ServiceContext,
  schemeId: string,
): Promise<BankAccount> {
  return ensureSchemeTrustAccount(ctx, schemeId);
}

/** All bank accounts for a scheme. */
export async function listBankAccounts(
  ctx: ServiceContext,
  schemeId: string,
): Promise<BankAccount[]> {
  return await ctx.db.query.bankAccounts.findMany({
    where: eq(bankAccounts.schemeId, schemeId),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
}

/** The scheme's account of a given kind, if provisioned. */
export async function getBankAccount(
  ctx: ServiceContext,
  schemeId: string,
  kind: BankAccountKind,
): Promise<BankAccount | null> {
  const row = await ctx.db.query.bankAccounts.findFirst({
    where: and(eq(bankAccounts.schemeId, schemeId), eq(bankAccounts.kind, kind)),
  });
  return row ?? null;
}

/** Move a pending account to active once the provider returns its details. */
export async function activateBankAccount(
  ctx: ServiceContext,
  schemeId: string,
  bankAccountId: string,
  input: ActivateBankAccountInput,
): Promise<BankAccount> {
  const rows = await ctx.db
    .update(bankAccounts)
    .set({
      status: "active",
      ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}),
      ...(input.bsb ? { bsb: input.bsb } : {}),
      ...(input.accountNumber ? { accountNumber: input.accountNumber } : {}),
      ...(input.payidRoot ? { payidRoot: input.payidRoot } : {}),
    })
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.schemeId, schemeId)))
    .returning();
  const updated = rows[0];
  if (!updated) throw notFound("Bank account");
  return updated;
}
