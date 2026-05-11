CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"user_id" uuid,
	"api_key_id" uuid,
	"request_id" text,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "encryption_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"curve" integer NOT NULL,
	"sui_object_id" text NOT NULL,
	"sui_address" text NOT NULL,
	"sui_tx_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"sui_object_id" text NOT NULL,
	"sui_tx_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dwallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"sui_dwallet_id" text NOT NULL,
	"curve" integer NOT NULL,
	"encryption_key_id" text NOT NULL,
	"kind" text DEFAULT 'zero_trust' NOT NULL,
	"status" text DEFAULT 'awaiting_user_share' NOT NULL,
	"dkg_tx_digest" text NOT NULL,
	"accept_tx_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "presigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"sui_object_id" text NOT NULL,
	"curve" integer NOT NULL,
	"signature_algorithm" integer NOT NULL,
	"network_encryption_key_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_tx_digest" text NOT NULL,
	"sign_request_id" uuid,
	"allocated_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sign_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"idempotency_key" text NOT NULL,
	"sui_dwallet_id" text NOT NULL,
	"presign_id" uuid,
	"curve" integer NOT NULL,
	"signature_algorithm" integer NOT NULL,
	"hash_scheme" integer NOT NULL,
	"message_hex" text NOT NULL,
	"message_centralized_signature_hex" text,
	"session_identifier_hex" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"tx_digest" text,
	"sign_session_id" text,
	"signature_hex" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text NOT NULL,
	"credits_micro" bigint DEFAULT 0 NOT NULL,
	"deposit_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"tx_digest" text NOT NULL,
	"sender_address" text NOT NULL,
	"coin_type" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"credits_credited" bigint NOT NULL,
	"rate_micro_per_atomic" text NOT NULL,
	"sweep_status" text DEFAULT 'pending' NOT NULL,
	"sweep_tx_digest" text,
	"swept_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network" text DEFAULT 'testnet' NOT NULL,
	"op_type" text NOT NULL,
	"op_id" text NOT NULL,
	"kind" text NOT NULL,
	"credits_micro" bigint NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_passkeys" ADD CONSTRAINT "auth_passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "encryption_keys" ADD CONSTRAINT "encryption_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dwallets" ADD CONSTRAINT "dwallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dwallets" ADD CONSTRAINT "dwallets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sign_requests" ADD CONSTRAINT "sign_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_deposits" ADD CONSTRAINT "billing_deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_provider_account_unique" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_passkeys_credential_id_unique" ON "auth_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_passkeys_user_idx" ON "auth_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_unique" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_event_idx" ON "audit_log" USING btree ("event");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "encryption_keys_user_idx" ON "encryption_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "encryption_keys_user_network_idx" ON "encryption_keys" USING btree ("user_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "encryption_keys_object_unique" ON "encryption_keys" USING btree ("sui_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "encryption_keys_user_curve_address_network_unique" ON "encryption_keys" USING btree ("user_id","curve","sui_address","network");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_user_network_idx" ON "accounts" USING btree ("user_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_object_unique" ON "accounts" USING btree ("sui_object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dwallets_user_idx" ON "dwallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dwallets_user_network_idx" ON "dwallets" USING btree ("user_id","network");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dwallets_account_idx" ON "dwallets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dwallets_sui_dwallet_unique" ON "dwallets" USING btree ("sui_dwallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "presigns_object_unique" ON "presigns" USING btree ("sui_object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presigns_bucket_status_idx" ON "presigns" USING btree ("network","curve","signature_algorithm","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sign_requests_user_idx" ON "sign_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sign_requests_user_network_idx" ON "sign_requests" USING btree ("user_id","network");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sign_requests_idem_unique" ON "sign_requests" USING btree ("user_id","network","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sign_requests_status_idx" ON "sign_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_accounts_user_network_unique" ON "billing_accounts" USING btree ("user_id","network");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_accounts_user_idx" ON "billing_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_deposits_digest_unique" ON "billing_deposits" USING btree ("tx_digest");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_deposits_user_idx" ON "billing_deposits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_deposits_user_network_idx" ON "billing_deposits" USING btree ("user_id","network","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_charges_user_idx" ON "billing_charges" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_charges_user_network_idx" ON "billing_charges" USING btree ("user_id","network","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_charges_op_unique" ON "billing_charges" USING btree ("network","op_type","op_id","kind");