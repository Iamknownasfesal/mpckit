/**
 * Better-Auth tables. We keep our existing `users` table as the
 * canonical record (UUID id + `creditsMicro` + `depositAddress` +
 * `isAdmin`) and bolt the session / OAuth / verification / passkey
 * tables on top via Better-Auth's drizzle adapter.
 *
 * All FKs point at `users.id` (uuid). The Better-Auth-managed PKs on
 * these tables are text (the library generates short opaque ids); we
 * persist them as text rather than coercing to uuid.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Opaque cookie value. */
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex("auth_sessions_token_unique").on(t.token),
    userIdx: index("auth_sessions_user_idx").on(t.userId),
  }),
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Provider name: "github", "google", "credential", etc. */
    providerId: text("provider_id").notNull(),
    /** Provider's own account id (e.g. GitHub user id). */
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    /** Only populated for credential provider; unused in our setup. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerAccountUnique: uniqueIndex(
      "auth_accounts_provider_account_unique",
    ).on(t.providerId, t.accountId),
    userIdx: index("auth_accounts_user_idx").on(t.userId),
  }),
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    /** Usually an email address (magic link / email verification). */
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    identifierIdx: index("auth_verifications_identifier_idx").on(t.identifier),
  }),
);

export const authPasskeys = pgTable(
  "auth_passkeys",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Human-readable label the user can edit later (e.g. "macbook"). */
    name: text("name"),
    /** CBOR-encoded public key bytes (base64 in storage). */
    publicKey: text("public_key").notNull(),
    /**
     * WebAuthn credential id, returned during registration. Globally
     * unique. Drizzle property name is `credentialID` (capital ID)
     * to match Better-Auth's expected schema for the passkey model.
     */
    credentialID: text("credential_id").notNull(),
    /** Anti-replay counter; bump on each assertion. */
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    /** Comma-separated transports list ("usb", "nfc", "ble", "internal"). */
    transports: text("transports"),
    /** WebAuthn authenticator AAGUID (UUID), identifies the device/model. */
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    credentialIdUnique: uniqueIndex("auth_passkeys_credential_id_unique").on(
      t.credentialID,
    ),
    userIdx: index("auth_passkeys_user_idx").on(t.userId),
  }),
);

export type AuthSession = typeof authSessions.$inferSelect;
export type AuthAccount = typeof authAccounts.$inferSelect;
export type AuthVerification = typeof authVerifications.$inferSelect;
export type AuthPasskey = typeof authPasskeys.$inferSelect;
