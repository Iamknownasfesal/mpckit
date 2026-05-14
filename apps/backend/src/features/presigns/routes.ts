/**
 * Admin-only presign visibility + manual refill trigger. The pool
 * primarily refills itself via the sign worker (1:1 replenish per
 * consumed cap) + the sweep job, but operators occasionally need a
 * manual top-up before traffic spikes.
 *
 *   GET   /v1/admin/presigns/health         per-bucket counts
 *   POST  /v1/admin/presigns/refill         enqueue a refill job
 *   POST  /v1/admin/presigns/discover       reconcile chain-owned caps
 *                                           into the DB; runs inline so
 *                                           the response carries the
 *                                           per-network result map
 */
import { Elysia, t } from "elysia";
import type { IkaNetwork } from "@/config/env";
import {
  bucketHealth,
  type DiscoverResult,
  discover,
} from "@/features/presigns/service";
import { requestNetwork, requireAdmin } from "@/http/middleware/auth";
import { listNetworks } from "@/shared/networks/registry";
import { enqueue } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";

export const presignAdminRoutes = new Elysia({ prefix: "/v1/admin" })
  .get(
    "/presigns/health",
    async ({ request, query }) => {
      requireAdmin(request);
      const network = requestNetwork(request);
      const curve = Number.parseInt(query.curve, 10);
      const sigAlgo = Number.parseInt(query.signatureAlgorithm, 10);
      const h = await bucketHealth(network, curve, sigAlgo);
      return { bucket: h };
    },
    {
      query: t.Object({
        curve: t.String({ minLength: 1 }),
        signatureAlgorithm: t.String({ minLength: 1 }),
      }),
      detail: {
        tags: ["admin"],
        summary: "Presign bucket health",
        description:
          "Counts per state (`ready`, `allocated`, `consumed_pending`, `pending`, `used`, `failed`) for the (curve, signatureAlgorithm) bucket, plus a `perNek` breakdown keyed by `network_encryption_key_id`. Sign-time allocation is NEK-scoped, so the per-NEK numbers are the load-bearing ones when the operator has rotated keys. Admin only.",
        security: [{ bearer: [] }],
      },
    },
  )
  .post(
    "/presigns/refill",
    async ({ request, body }) => {
      requireAdmin(request);
      const network = requestNetwork(request);
      const jobId = await enqueue(JOBS.presignRefill, {
        network,
        curve: body.curve,
        signatureAlgorithm: body.signatureAlgorithm,
        count: body.count,
      });
      return { enqueued: true, jobId };
    },
    {
      body: t.Object({
        curve: t.Integer({ minimum: 0, maximum: 3 }),
        signatureAlgorithm: t.Integer({ minimum: 0, maximum: 3 }),
        count: t.Integer({ minimum: 1, maximum: 50 }),
      }),
      detail: {
        tags: ["admin"],
        summary: "Trigger presign refill",
        description:
          "Enqueues a `presignRefill` job to top up the (curve, signatureAlgorithm) bucket by `count`. The pool normally refills itself 1:1 in the sign worker; operators use this before anticipated spikes. Admin only.",
        security: [{ bearer: [] }],
      },
    },
  )
  .post(
    "/presigns/discover",
    async ({ request, body }) => {
      requireAdmin(request);
      // Scope to a specific network when supplied, otherwise reconcile
      // every enabled network in sequence so a single operator call
      // catches the full drift across testnet + mainnet.
      const targets: IkaNetwork[] = body.network
        ? [body.network]
        : listNetworks();
      const results: Record<string, DiscoverResult> = {};
      for (const net of targets) {
        results[net] = await discover(net);
      }
      return { results };
    },
    {
      body: t.Object({
        network: t.Optional(
          t.Union([t.Literal("testnet"), t.Literal("mainnet")]),
        ),
      }),
      detail: {
        tags: ["admin"],
        summary: "Reconcile chain-owned presigns into the DB",
        description:
          "Scans the operator wallet for `UnverifiedPresignCap` objects and back-fills any missing rows in the `presigns` table. Useful when caps were minted out-of-band (older deployments, ad-hoc scripts) or the DB has fallen behind the chain. Per-network result map. Admin only.",
        security: [{ bearer: [] }],
      },
    },
  );
