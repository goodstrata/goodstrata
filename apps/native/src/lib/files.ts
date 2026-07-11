import { File, Paths } from "expo-file-system";
import { Share } from "react-native";
import { authClient } from "./auth";
import { API_ORIGIN } from "./config";

export function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._ -]+/g, "-").trim() || "document";
}

/** Authenticated binary download into cache, then the native preview/share sheet. */
export async function downloadAndShare(
  path: string,
  filename: string,
  title = filename,
): Promise<void> {
  const file = await File.downloadFileAsync(
    `${API_ORIGIN}${path}`,
    new File(Paths.cache, safeFilename(filename)),
    { headers: { Cookie: authClient.getCookie() }, idempotent: true },
  );
  await Share.share({ url: file.uri, title });
}
