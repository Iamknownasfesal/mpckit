import { bucketHealth } from "@/features/presigns/service";
import { requestNetwork, requireAdmin } from "@/http/middleware/auth";
import { enqueue } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";
/**
 * Admin-only presign visibility + manual refill trigger. The pool
 * primarily refills itself via the sign worker (1:1 replenish per
 * consumed cap) + the sweep job, but operators occasionally need a
 * manual top-up before traffic spikes.
 *
 *   GET   /v1/admin/presigns/health         per-bucket counts
 *   POST  /v1/admin/presigns/refill         enqueue a refill job
 */
import { Elysia, t } from "elysia";

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
          "Counts per state (`available`, `reserved`, `consumed`) for the (curve, signatureAlgorithm) bucket. Admin only.",
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
  );
