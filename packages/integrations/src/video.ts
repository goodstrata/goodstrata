export interface VideoRoom {
  url: string;
  roomName: string;
}

export interface VideoProvider {
  readonly name: string;
  createRoom(input: { name: string; expiresMinutes: number }): Promise<VideoRoom>;
  createMeetingToken(input: {
    roomName: string;
    userName: string;
    isOwner: boolean;
  }): Promise<{ token: string }>;
}

/** Default: fake URLs/tokens so self-host works with zero video config. */
export function consoleVideoProvider(): VideoProvider {
  return {
    name: "console",
    async createRoom({ name }) {
      const url = `https://video.goodstrata.local/${name}`;
      console.log(`[video:console] room created: ${url}`);
      return { url, roomName: name };
    },
    async createMeetingToken({ roomName, userName }) {
      return { token: `console-token-${roomName}-${userName.replace(/\s+/g, "_")}` };
    },
  };
}

/**
 * Daily.co: private rooms + short-lived meeting tokens via the REST API.
 * https://docs.daily.co/reference/rest-api
 */
export function dailyVideoProvider(apiKey: string, fetchFn: typeof fetch = fetch): VideoProvider {
  const base = "https://api.daily.co/v1";

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetchFn(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`daily: POST ${path} failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    name: "daily",
    async createRoom({ name, expiresMinutes }) {
      const exp = Math.floor(Date.now() / 1000) + expiresMinutes * 60;
      const room = await post("/rooms", {
        name,
        privacy: "private",
        properties: { exp },
      });
      return { url: String(room.url), roomName: String(room.name) };
    },
    async createMeetingToken({ roomName, userName, isOwner }) {
      const exp = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
      const out = await post("/meeting-tokens", {
        properties: { room_name: roomName, user_name: userName, is_owner: isOwner, exp },
      });
      return { token: String(out.token) };
    },
  };
}
