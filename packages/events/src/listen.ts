import pg from "pg";

export interface EventNotification {
  seq: number;
  id: string;
  schemeId: string | null;
  type: string;
}

/**
 * LISTEN gs_events on a dedicated connection with auto-reconnect.
 * NOTIFY is only a wake-up hint — consumers must re-read event_log by seq.
 */
export function listenForEvents(
  connectionString: string,
  onNotify: (n: EventNotification) => void,
  onError: (err: Error) => void = console.error,
): { stop: () => Promise<void> } {
  let client: pg.Client | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  async function connect() {
    if (stopped) return;
    client = new pg.Client({ connectionString });
    client.on("error", (err) => {
      onError(err);
      scheduleReconnect();
    });
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        onNotify(JSON.parse(msg.payload) as EventNotification);
      } catch (err) {
        onError(err as Error);
      }
    });
    try {
      await client.connect();
      await client.query("LISTEN gs_events");
    } catch (err) {
      onError(err as Error);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    client?.end().catch(() => {});
    client = null;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, 2000);
  }

  void connect();

  return {
    stop: async () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      await client?.end().catch(() => {});
    },
  };
}
