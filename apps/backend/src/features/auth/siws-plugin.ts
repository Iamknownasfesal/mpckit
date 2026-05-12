import { normalizeSuiAddress } from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
/**
 * Sign-In With Sui (SIWS) plugin for Better-Auth.
 *
 * Two endpoints:
 *
 *   POST /api/auth/siws/nonce
 *     body: { address: string }
 *     returns: { nonce, message }
 *     side-effect: stores `siws:{address}` in auth_verifications with a
 *     10-minute TTL.
 *
 *   POST /api/auth/siws/verify
 *     body: { address, message, signature }
 *     returns: { token, user, success: true }
 *     verifies the Sui personal-message signature against the claimed
 *     address, deletes the nonce, finds-or-creates a user keyed on the
 *     address, mints a session, sets the session cookie.
 *
 * Identity model: the user's email column is set to a synthetic
 * `<address>@sui.{host}` so the unique-email constraint stays happy.
 * The real link to Sui lives in auth_accounts with providerId="siws"
 * and accountId=address. Users can change their displayed email +
 * name later in settings; the auth_accounts row stays as the
 * authoritative wallet binding.
 */
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

const SUI_ADDRESS_RE = /^0x[a-fA-F0-9]{1,64}$/;
const NONCE_TTL_MS = 10 * 60_000; // 10 minutes

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function buildSiwsMessage(opts: {
  address: string;
  domain: string;
  nonce: string;
}): string {
  // Plain-text statement modelled on EIP-4361 / CAIP-122 but adapted
  // for Sui. Browser-visible so users can read it before signing.
  return [
    `${opts.domain} wants you to sign in with your Sui account:`,
    opts.address,
    "",
    "Sign in to MPCKit. This request does not authorise any on-chain",
    "transaction; it only proves wallet ownership.",
    "",
    `Domain: ${opts.domain}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

function originOf(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

export function suiSiwsPlugin() {
  return {
    id: "siws",
    endpoints: {
      getSiwsNonce: createAuthEndpoint(
        "/siws/nonce",
        {
          method: "POST",
          body: z.object({
            address: z.string().regex(SUI_ADDRESS_RE),
          }),
        },
        async (ctx) => {
          const address = normalizeSuiAddress(ctx.body.address);
          const nonce = crypto.randomUUID().replaceAll("-", "");
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `siws:${address}`,
            value: nonce,
            expiresAt: new Date(Date.now() + NONCE_TTL_MS),
          });
          const message = buildSiwsMessage({
            address,
            domain: originOf(ctx.context.baseURL),
            nonce,
          });
          return ctx.json({ nonce, message });
        },
      ),

      verifySiwsSignature: createAuthEndpoint(
        "/siws/verify",
        {
          method: "POST",
          body: z.object({
            address: z.string().regex(SUI_ADDRESS_RE),
            message: z.string().min(1),
            signature: z.string().min(1),
          }),
          requireRequest: true,
        },
        async (ctx) => {
          const address = normalizeSuiAddress(ctx.body.address);
          const verification =
            await ctx.context.internalAdapter.findVerificationValue(
              `siws:${address}`,
            );
          if (!verification || verification.expiresAt < new Date()) {
            throw new APIError("UNAUTHORIZED", {
              message: "expired or unknown nonce",
              code: "SIWS_NONCE_EXPIRED",
            });
          }
          if (!ctx.body.message.includes(verification.value)) {
            throw new APIError("UNAUTHORIZED", {
              message: "message does not include the issued nonce",
              code: "SIWS_NONCE_MISMATCH",
            });
          }

          // Verifies the signature AND that the signer's derived address
          // matches the claimed address. Throws on any mismatch.
          try {
            await verifyPersonalMessageSignature(
              new TextEncoder().encode(ctx.body.message),
              ctx.body.signature,
              { address },
            );
          } catch (err) {
            throw new APIError("UNAUTHORIZED", {
              message: "invalid Sui signature",
              code: "SIWS_INVALID_SIGNATURE",
              details: err instanceof Error ? err.message : String(err),
            });
          }

          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            `siws:${address}`,
          );

          // Look up the existing user by wallet binding, if any.
          const existingAccount = (await ctx.context.adapter.findOne({
            model: "account",
            where: [
              { field: "providerId", operator: "eq", value: "siws" },
              { field: "accountId", operator: "eq", value: address },
            ],
          })) as { userId: string } | null;

          let user = existingAccount
            ? await ctx.context.adapter.findOne({
                model: "user",
                where: [
                  {
                    field: "id",
                    operator: "eq",
                    value: existingAccount.userId,
                  },
                ],
              })
            : null;

          if (!user) {
            const host = originOf(ctx.context.baseURL);
            user = await ctx.context.internalAdapter.createUser({
              name: shortAddress(address),
              email: `${address}@sui.${host}`,
              emailVerified: true,
              image: "",
            });
            await ctx.context.internalAdapter.createAccount({
              userId: (user as { id: string }).id,
              providerId: "siws",
              accountId: address,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          const typedUser = user as Parameters<
            typeof setSessionCookie
          >[1]["user"];
          const session = await ctx.context.internalAdapter.createSession(
            typedUser.id,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "could not create session",
            });
          }
          await setSessionCookie(ctx, { session, user: typedUser });
          return ctx.json({
            success: true,
            token: session.token,
            user: { id: typedUser.id, address },
          });
        },
      ),
    },
  };
}
