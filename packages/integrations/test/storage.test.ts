import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mockPaymentsProvider } from "../src/payments.js";
import { localDiskStorageProvider, storageKey } from "../src/storage.js";

let dir: string;

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("localDiskStorageProvider", () => {
  it("round-trips content and deletes", async () => {
    dir = await mkdtemp(join(tmpdir(), "gs-storage-"));
    const storage = localDiskStorageProvider(dir);
    const key = storageKey("scheme-1", "levy notice #4.pdf");
    expect(key).toMatch(/^scheme-1\//);
    expect(key).not.toContain("#");

    await storage.put(key, new TextEncoder().encode("hello"), "text/plain");
    expect(new TextDecoder().decode(await storage.get(key))).toBe("hello");

    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow();
  });

  it("blocks path traversal", async () => {
    dir = dir ?? (await mkdtemp(join(tmpdir(), "gs-storage-")));
    const storage = localDiskStorageProvider(dir);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(/escapes root/);
  });
});

describe("mockPaymentsProvider", () => {
  it("verifies its own HMAC signatures and rejects tampering", () => {
    const payments = mockPaymentsProvider("secret");
    const body = payments.buildWebhookBody({
      payid: "mockpay-ln-0001",
      amountCents: 123_45,
      paidAt: "2026-07-01T00:00:00Z",
      payerName: "Test Owner",
    });
    const sig = payments.sign(body);
    expect(payments.verifyWebhook(body, sig)).toBe(true);
    expect(payments.verifyWebhook(`${body} `, sig)).toBe(false);
    expect(payments.verifyWebhook(body, undefined)).toBe(false);

    const parsed = payments.parseWebhook(body);
    expect(parsed.amountCents).toBe(12345);
    expect(parsed.payid).toBe("mockpay-ln-0001");
  });
});
