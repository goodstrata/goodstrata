export interface VideoRoom {
  url: string;
  roomName: string;
}

export interface VideoChatMessage {
  roomName: string;
  text: string;
  fromName: string;
}

export interface VideoProvider {
  readonly name: string;
  createRoom(input: { name: string; expiresMinutes: number }): Promise<VideoRoom>;
  createMeetingToken(input: {
    roomName: string;
    userName: string;
    isOwner: boolean;
  }): Promise<{ token: string }>;

  // -------------------------------------------------------------------------
  // Optional capabilities. Callers must feature-detect (`provider.x?.(...)`)
  // and everything degrades gracefully: these methods NEVER throw — failures
  // (e.g. transcription not enabled on the plan) surface as ok:false / null.
  // -------------------------------------------------------------------------

  /** Start live transcription in a room. */
  startTranscription?(roomName: string): Promise<{ ok: boolean }>;
  /** Stop live transcription in a room. */
  stopTranscription?(roomName: string): Promise<{ ok: boolean }>;
  /** Fetch the latest finished transcript, flattened to "Speaker: text" lines. */
  fetchTranscriptText?(roomName: string): Promise<string | null>;
  /** Post a chat message into the room (visible in the provider's chat UI). */
  sendChatMessage?(roomName: string, text: string, fromName: string): Promise<{ ok: boolean }>;
}

export interface ConsoleVideoProvider extends VideoProvider {
  /** Every chat message sent, in order (test observability). */
  chatMessages: VideoChatMessage[];
  /** Rooms with transcription currently running. */
  transcribingRooms: Set<string>;
  /** Fixture: what fetchTranscriptText returns for a room (null clears it). */
  setTranscript(roomName: string, text: string | null): void;
  // The console provider implements every optional capability (as fakes).
  startTranscription(roomName: string): Promise<{ ok: boolean }>;
  stopTranscription(roomName: string): Promise<{ ok: boolean }>;
  fetchTranscriptText(roomName: string): Promise<string | null>;
  sendChatMessage(roomName: string, text: string, fromName: string): Promise<{ ok: boolean }>;
}

/** Default: fake URLs/tokens so self-host works with zero video config. */
export function consoleVideoProvider(): ConsoleVideoProvider {
  const chatMessages: VideoChatMessage[] = [];
  const transcribingRooms = new Set<string>();
  const transcripts = new Map<string, string>();

  return {
    name: "console",
    chatMessages,
    transcribingRooms,
    setTranscript(roomName, text) {
      if (text === null) transcripts.delete(roomName);
      else transcripts.set(roomName, text);
    },
    async createRoom({ name }) {
      const url = `https://video.goodstrata.local/${name}`;
      console.log(`[video:console] room created: ${url}`);
      return { url, roomName: name };
    },
    async createMeetingToken({ roomName, userName }) {
      return { token: `console-token-${roomName}-${userName.replace(/\s+/g, "_")}` };
    },
    async startTranscription(roomName) {
      transcribingRooms.add(roomName);
      return { ok: true };
    },
    async stopTranscription(roomName) {
      transcribingRooms.delete(roomName);
      return { ok: true };
    },
    async fetchTranscriptText(roomName) {
      return transcripts.get(roomName) ?? null;
    },
    async sendChatMessage(roomName, text, fromName) {
      chatMessages.push({ roomName, text, fromName });
      return { ok: true };
    },
  };
}

/**
 * Flatten a WebVTT transcript to plain "Speaker: text" lines.
 * Drops the header, NOTE/STYLE/REGION blocks, cue identifiers and timestamps;
 * converts `<v Speaker Name>…</v>` voice tags to a "Speaker Name: " prefix.
 */
export function flattenVtt(vtt: string): string {
  const out: string[] = [];
  let inCueText = false;
  let skipBlock = false;

  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      inCueText = false;
      skipBlock = false;
      continue;
    }
    if (skipBlock) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(line)) {
      skipBlock = true;
      continue;
    }
    if (line.includes("-->")) {
      inCueText = true;
      continue;
    }
    if (!inCueText) continue; // cue identifier line

    const text = line
      .replace(/<v(?:\.[^\s>]*)?\s+([^>]+)>/gi, (_m, name) => `${String(name).trim()}: `)
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) out.push(text);
  }

  return out.join("\n");
}

/**
 * Daily.co: private rooms + short-lived meeting tokens via the REST API,
 * plus optional transcription (Deepgram via Daily) and Prebuilt chat messages.
 * https://docs.daily.co/reference/rest-api
 */
export function dailyVideoProvider(apiKey: string, fetchFn: typeof fetch = fetch): VideoProvider {
  const base = "https://api.daily.co/v1";
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetchFn(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`daily: POST ${path} failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async function get(path: string): Promise<Record<string, unknown>> {
    const res = await fetchFn(`${base}${path}`, { headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`daily: GET ${path} failed (${res.status}): ${detail}`);
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

    // Transcription may not be enabled on the Daily plan — never throw.
    async startTranscription(roomName) {
      try {
        await post(`/rooms/${encodeURIComponent(roomName)}/transcription/start`, {});
        return { ok: true };
      } catch (err) {
        console.warn(`[video:daily] startTranscription failed: ${(err as Error).message}`);
        return { ok: false };
      }
    },
    async stopTranscription(roomName) {
      try {
        await post(`/rooms/${encodeURIComponent(roomName)}/transcription/stop`, {});
        return { ok: true };
      } catch (err) {
        console.warn(`[video:daily] stopTranscription failed: ${(err as Error).message}`);
        return { ok: false };
      }
    },

    /**
     * The transcript list filters by room *id*, so resolve the room first,
     * pick the newest finished transcript, mint an access link, download the
     * WebVTT and flatten it. Any failure along the way → null.
     */
    async fetchTranscriptText(roomName) {
      try {
        const room = await get(`/rooms/${encodeURIComponent(roomName)}`);
        const roomId = room.id ? String(room.id) : null;
        if (!roomId) return null;

        const list = await get(`/transcript?roomId=${encodeURIComponent(roomId)}`);
        const items = (Array.isArray(list.data) ? list.data : []) as {
          transcriptId?: string;
          status?: string;
          isVttAvailable?: boolean;
          created_at?: string;
        }[];
        const finished = items
          .filter((t) => t.transcriptId && t.status === "t_finished" && t.isVttAvailable !== false)
          .sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""));
        const latest = finished[0];
        if (!latest) return null;

        const access = await get(
          `/transcript/${encodeURIComponent(latest.transcriptId!)}/access-link`,
        );
        // Schema says `link`; the documented example says `download_link`.
        const link = String(access.link ?? access.download_link ?? "");
        if (!link) return null;

        const vttRes = await fetchFn(link);
        if (!vttRes.ok) return null;
        return flattenVtt(await vttRes.text());
      } catch (err) {
        console.warn(`[video:daily] fetchTranscriptText failed: ${(err as Error).message}`);
        return null;
      }
    },

    /**
     * Broadcast via /rooms/:name/send-app-message. Daily Prebuilt's chat
     * renders app-messages shaped {event:"chat-msg", name, message} (the shape
     * daily-python's send_prebuilt_chat_message emits); the exact contract is
     * not in the REST docs, so a plain {name, message} payload is broadcast
     * too for custom clients.
     */
    async sendChatMessage(roomName, text, fromName) {
      const path = `/rooms/${encodeURIComponent(roomName)}/send-app-message`;
      try {
        await post(path, {
          data: {
            event: "chat-msg",
            room: "main-room",
            name: fromName,
            message: text,
            date: new Date().toISOString(),
          },
          recipient: "*",
        });
        await post(path, { data: { name: fromName, message: text }, recipient: "*" });
        return { ok: true };
      } catch (err) {
        console.warn(`[video:daily] sendChatMessage failed: ${(err as Error).message}`);
        return { ok: false };
      }
    },
  };
}
