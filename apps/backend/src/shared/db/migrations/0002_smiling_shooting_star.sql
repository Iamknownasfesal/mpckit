ALTER TABLE "dwallets" ADD COLUMN "network_encryption_key_id" text;--> statement-breakpoint
CREATE INDEX "dwallets_network_nek_idx" ON "dwallets" USING btree ("network","network_encryption_key_id");