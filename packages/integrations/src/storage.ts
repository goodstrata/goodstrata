import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

export interface StorageProvider {
  readonly name: string;
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

/** Generate a collision-free storage key under a scheme prefix. */
export function storageKey(schemeId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return `${schemeId}/${randomUUID()}-${safe}`;
}

/** Default: files under DATA_DIR/files. Zero external dependencies. */
export function localDiskStorageProvider(dataDir: string): StorageProvider {
  const root = join(dataDir, "files");

  function resolve(key: string): string {
    const path = normalize(join(root, key));
    if (!path.startsWith(root + sep) && path !== root) {
      throw new Error(`storage: key escapes root: ${key}`);
    }
    return path;
  }

  return {
    name: "local",
    async put(key, content) {
      const path = resolve(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    },
    async get(key) {
      return readFile(resolve(key));
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

export function memoryStorageProvider(): StorageProvider & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    name: "memory",
    files,
    async put(key, content) {
      files.set(key, content);
    },
    async get(key) {
      const f = files.get(key);
      if (!f) throw new Error(`storage: not found: ${key}`);
      return f;
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

export function contentHash(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
