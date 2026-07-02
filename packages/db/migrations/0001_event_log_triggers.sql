-- event_log is append-only: block UPDATE/DELETE at the database level so even
-- privileged app code (or a compromised app) cannot rewrite history.
CREATE OR REPLACE FUNCTION event_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER event_log_no_update_delete
  BEFORE UPDATE OR DELETE ON event_log
  FOR EACH ROW EXECUTE FUNCTION event_log_append_only();
--> statement-breakpoint
-- Wake up in-process listeners (SSE fan-out, dispatcher catch-up) on every
-- event. Payload is a small JSON envelope; consumers re-read from event_log
-- by seq, so NOTIFY is only ever a hint — never the source of truth.
CREATE OR REPLACE FUNCTION event_log_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'gs_events',
    json_build_object(
      'seq', NEW.seq,
      'id', NEW.id,
      'schemeId', NEW.scheme_id,
      'type', NEW.type
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER event_log_notify_insert
  AFTER INSERT ON event_log
  FOR EACH ROW EXECUTE FUNCTION event_log_notify();
