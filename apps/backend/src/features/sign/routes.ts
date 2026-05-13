/**
 *   POST /v1/sign                  phase 1: prepare (returns presign bytes)
 *   POST /v1/sign/:id/submit       phase 2: finalize (sends centralized sig)
 *   GET  /v1/sign/:id              poll status
 *
 * Phase 1 reserves a presign + charges credits + returns the bytes the
 * user must sign over. Phase 2 takes the centralized signature and
 * enqueues the worker to drive the on-chain PTB. Idempotency-Key
 * header on phase 1 makes prepare retries safe; phase 2 is naturally
 * idempotent on the row's existing status.
 */
import { Elysia, t } from "elysia";
import {
  getSignRequest,
  prepareSignRequest,
  submitPreparedSign,
} from "@/features/sign/service";
import { requestNetwork, requireAuth } from "@/http/middleware/auth";
import { fromHex } from "@/shared/codec/hex";
import type { SignRequest } from "@/shared/db/schema";
import { errors } from "@/shared/errors";

const MAX_MESSAGE_HEX = 64 * 1024; // 32 KiB raw message ceiling.

function publicSign(sr: SignRequest) {
  return {
    id: sr.id,
    status: sr.status,
    txDigest: sr.txDigest,
    signSessionId: sr.signSessionId,
    signatureHex: sr.signatureHex,
    errorCode: sr.errorCode,
    errorMessage: sr.errorMessage,
    createdAt: sr.createdAt.toISOString(),
    updatedAt: sr.updatedAt.toISOString(),
    completedAt: sr.completedAt?.toISOString() ?? null,
  };
}

export const signRoutes = new Elysia({ prefix: "/v1" })
  .post(
    "/sign",
    async ({ request, body, set }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const idem = request.headers.get("idempotency-key");
      if (!idem || idem.length < 8 || idem.length > 200) {
        throw errors.validation(
          "Idempotency-Key header required (8..200 chars)",
          "MISSING_IDEMPOTENCY_KEY",
        );
      }
      if (body.messageHex.length > MAX_MESSAGE_HEX) {
        throw errors.validation("message too large", "MESSAGE_TOO_LARGE");
      }

      const result = await prepareSignRequest({
        userId: user.id,
        network,
        idempotencyKey: idem,
        dwalletId: body.dwalletId,
        signatureAlgorithm: body.signatureAlgorithm,
        hashScheme: body.hashScheme,
        message: fromHex(body.messageHex, "message"),
      });

      set.status = result.duplicate ? 200 : 201;
      return {
        signRequest: publicSign(result.signRequest),
        duplicate: result.duplicate,
        presignBytesHex: result.presignBytesHex,
        presignSuiObjectId: result.presignSuiObjectId,
      };
    },
    {
      body: t.Object({
        dwalletId: t.String({ format: "uuid" }),
        signatureAlgorithm: t.Integer({ minimum: 0, maximum: 4 }),
        hashScheme: t.Integer({ minimum: 0, maximum: 4 }),
        messageHex: t.String({ minLength: 2 }),
      }),
      detail: {
        tags: ["sign"],
        summary: "Prepare sign request",
        description:
          "Phase 1 of two-phase signing. Reserves a presign from the operator-managed pool, charges credits at the live USD rate, and returns the presign bytes the SDK signs locally to produce the centralized signature. The SDK posts that signature to `POST /v1/sign/:id/submit`. **`Idempotency-Key` header is required** (8..200 chars): the same key replays the original prepare result rather than burning a new presign. Returns 201 on first prepare, 200 on idempotent replay. Errors: 422 on `MESSAGE_TOO_LARGE` (>32 KiB), 503 if the price feed is stale, 402 on insufficient credits.",
        security: [{ bearer: [] }],
      },
    },
  )
  .post(
    "/sign/:id/submit",
    async ({ request, params, body, set }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const updated = await submitPreparedSign({
        userId: user.id,
        network,
        signRequestId: params.id,
        messageCentralizedSignature: fromHex(
          body.messageCentralizedSignatureHex,
          "messageCentralizedSignature",
        ),
        sessionIdentifierBytes: fromHex(
          body.sessionIdentifierHex,
          "sessionIdentifier",
        ),
      });
      set.status = 202;
      return { signRequest: publicSign(updated) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        messageCentralizedSignatureHex: t.String({ minLength: 2 }),
        sessionIdentifierHex: t.String({ minLength: 64, maxLength: 64 }),
      }),
      detail: {
        tags: ["sign"],
        summary: "Submit centralized signature",
        description:
          "Phase 2 of two-phase signing. Posts the SDK-produced centralized signature plus a fresh `sessionIdentifier`; the operator enqueues the worker to drive the on-chain Sui PTB and returns 202 with the (still pending) sign request. Naturally idempotent — once a sign request is past `Prepared`, repeated submits return the current row instead of re-enqueueing. Poll `GET /v1/sign/:id` for the final on-chain signature, tx digest, or error code.",
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/sign/:id",
    async ({ request, params }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const sr = await getSignRequest(user.id, network, params.id);
      if (!sr)
        throw errors.notFound("sign request not found", "SIGN_NOT_FOUND");
      return { signRequest: publicSign(sr) };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["sign"],
        summary: "Get sign request",
        description:
          "Status, tx digest, on-chain `signSessionId`, and final signature (when complete) for a sign request. Statuses: `Prepared` -> `Pending` -> `Completed` | `Failed`. SDKs poll this until the row reaches a terminal state.",
        security: [{ bearer: [] }],
      },
    },
  );
