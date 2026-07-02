ALTER TYPE "public"."agent_name" ADD VALUE 'chair';--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "chair_log" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "transcription_started" boolean DEFAULT false NOT NULL;