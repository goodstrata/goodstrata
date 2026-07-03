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

/**
 * S3-compatible object storage — Cloudflare R2, AWS S3, MinIO, etc. Durable
 * storage for production, where the compute is ephemeral. For R2 the endpoint
 * is https://<account_id>.r2.cloudflarestorage.com and region is "auto".
 */
export function s3StorageProvider(opts: {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "r2" tags the driver name; behaviour is identical S3 API. */
  flavour?: "s3" | "r2";
}): StorageProvider {
  // Imported lazily so the default offline drivers pull in no AWS SDK.
  const clientPromise = import("@aws-sdk/client-s3").then(
    ({ S3Client }) =>
      new S3Client({
        region: opts.region ?? "auto",
        endpoint: opts.endpoint,
        credentials: {
          accessKeyId: opts.accessKeyId,
          secretAccessKey: opts.secretAccessKey,
        },
        // R2 and most S3-compatibles want path-style unless a custom domain.
        forcePathStyle: Boolean(opts.endpoint),
      }),
  );

  return {
    name: opts.flavour ?? "s3",
    async put(key, content, contentType) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await clientPromise;
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: content,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await clientPromise;
      const res = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
      if (!res.Body) throw new Error(`storage: not found: ${key}`);
      const bytes = await res.Body.transformToByteArray();
      return bytes;
    },
    async delete(key) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await clientPromise;
      await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }));
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
