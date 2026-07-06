ALTER TABLE "rfq_channels" ADD COLUMN "quote_token" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "accept_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_channels_quote_token_idx" ON "rfq_channels" USING btree ("quote_token");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_accept_token_idx" ON "work_orders" USING btree ("accept_token");