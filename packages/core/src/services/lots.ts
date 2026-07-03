import { lots, ownerships, people, schemes } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import { isOccupiableLot, parseCsvRecords, schemeTier, toDateOnly } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError } from "../errors.js";

const lotRowSchema = z.object({
  lot_number: z.string().min(1),
  entitlement: z.coerce.number().int().positive(),
  liability: z.coerce.number().int().positive(),
  lot_type: z.enum(["residential", "commercial", "carpark", "storage"]).catch("residential"),
  unit_number: z.string().optional(),
  owner_name: z.string().optional(),
  owner_email: z.string().optional(),
});

export interface LotImportResult {
  imported: number;
  ownersCreated: number;
  errors: { line: number; message: string }[];
}

/**
 * Bulk import lots (and optionally their owners) from CSV text with a header
 * row: lot_number, entitlement, liability[, lot_type, unit_number,
 * owner_name, owner_email]. All-or-nothing: any invalid row aborts.
 */
export async function importLotsCsv(
  ctx: ServiceContext,
  schemeId: string,
  csvText: string,
): Promise<LotImportResult> {
  const records = parseCsvRecords(csvText);
  if (records.length === 0) {
    throw new DomainError("EMPTY_IMPORT", "No data rows found in CSV");
  }

  const errors: LotImportResult["errors"] = [];
  const rows = records.map((record, idx) => {
    const parsed = lotRowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        line: idx + 2, // header is line 1
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return null;
    }
    return parsed.data;
  });
  if (errors.length > 0) {
    throw new DomainError("INVALID_IMPORT", "CSV contains invalid rows", 422, { errors });
  }
  const valid = rows.filter((r) => r !== null);

  const seen = new Set<string>();
  for (const row of valid) {
    if (seen.has(row.lot_number)) {
      throw new DomainError("DUPLICATE_LOT", `Duplicate lot_number in CSV: ${row.lot_number}`, 422);
    }
    seen.add(row.lot_number);
  }

  let ownersCreated = 0;
  const today = toDateOnly(ctx.clock.now());

  await ctx.db.transaction(async (tx) => {
    const existing = await tx.query.lots.findMany({ where: eq(lots.schemeId, schemeId) });
    const existingNumbers = new Set(existing.map((l) => l.lotNumber));

    for (const row of valid) {
      if (existingNumbers.has(row.lot_number)) {
        throw new DomainError(
          "DUPLICATE_LOT",
          `Lot ${row.lot_number} already exists in this scheme`,
          409,
        );
      }
      const inserted = await tx
        .insert(lots)
        .values({
          schemeId,
          lotNumber: row.lot_number,
          unitNumber: row.unit_number || null,
          lotType: row.lot_type,
          entitlement: row.entitlement,
          liability: row.liability,
        })
        .returning();
      const lot = inserted[0]!;

      await publishEvent(tx, {
        schemeId,
        stream: `lot:${lot.id}`,
        type: "lot.created",
        payload: {
          lotNumber: lot.lotNumber,
          entitlement: lot.entitlement,
          liability: lot.liability,
        },
        actor: ctx.actor,
        ...causationFields(ctx),
      });

      if (row.owner_email || row.owner_name) {
        const [givenName, ...rest] = (row.owner_name ?? "").split(" ");
        const personRows = await tx
          .insert(people)
          .values({
            schemeId,
            givenName: givenName || null,
            familyName: rest.join(" ") || null,
            email: row.owner_email || null,
          })
          .returning();
        const person = personRows[0]!;
        await tx.insert(ownerships).values({
          schemeId,
          lotId: lot.id,
          personId: person.id,
          startedOn: today,
        });
        ownersCreated += 1;
      }
    }

    // Tier follows the OCCUPIABLE lot count (OC Act tiers): accessory lots
    // (carpark/storage) are not occupiable and must be excluded from the tally.
    const occupiable =
      existing.filter((l) => isOccupiableLot(l.lotType)).length +
      valid.filter((r) => isOccupiableLot(r.lot_type)).length;
    await tx
      .update(schemes)
      .set({ tier: schemeTier(occupiable) })
      .where(eq(schemes.id, schemeId));

    await publishEvent(tx, {
      schemeId,
      stream: `scheme:${schemeId}`,
      type: "lots.imported",
      payload: { count: valid.length },
      actor: ctx.actor,
      ...causationFields(ctx),
    });
  });

  return { imported: valid.length, ownersCreated, errors: [] };
}

export async function listLots(ctx: ServiceContext, schemeId: string) {
  const lotRows = await ctx.db.query.lots.findMany({
    where: eq(lots.schemeId, schemeId),
    orderBy: (t, { asc }) => asc(t.lotNumber),
  });
  const owners = await ctx.db
    .select({
      lotId: ownerships.lotId,
      personId: people.id,
      givenName: people.givenName,
      familyName: people.familyName,
      email: people.email,
      userId: people.userId,
    })
    .from(ownerships)
    .innerJoin(people, eq(ownerships.personId, people.id))
    .where(and(eq(ownerships.schemeId, schemeId)));

  return lotRows.map((lot) => ({
    ...lot,
    owners: owners.filter((o) => o.lotId === lot.id),
  }));
}
