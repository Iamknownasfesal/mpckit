import { listAccountsForUser } from "@/features/accounts/service";
import { requestNetwork, requireAuth } from "@/http/middleware/auth";
/**
 *   GET /v1/accounts   list this user's accounts
 *
 * Account creation is implicit in `POST /v1/dwallets`; there's no
 * standalone create endpoint.
 */
import { Elysia } from "elysia";

export const accountRoutes = new Elysia({ prefix: "/v1" }).get(
  "/accounts",
  async ({ request }) => {
    const { user } = requireAuth(request);
    const network = requestNetwork(request);
    const rows = await listAccountsForUser(user.id, network);
    return {
      network,
      accounts: rows.map((a) => ({
        id: a.id,
        suiObjectId: a.suiObjectId,
        suiTxDigest: a.suiTxDigest,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  },
  {
    detail: {
      tags: ["accounts"],
      summary: "List accounts",
      description:
        "All on-chain Ika accounts owned by the authenticated user. Account creation is implicit in `POST /v1/dwallets` — there is no standalone create endpoint.",
      security: [{ bearer: [] }],
    },
  },
);
