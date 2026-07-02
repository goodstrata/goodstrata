DROP INDEX "agent_runs_trigger_idx";--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_trigger_idx" ON "agent_runs" USING btree ("trigger_event_id","agent","attempt");