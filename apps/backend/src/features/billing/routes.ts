import { env } from "@/config/env";
import {
  OP_PRICES,
  getBalance,
  getOrCreateDepositAddress,
  listCharges,
  listDeposits,
  recordDeposit,
} from "@/features/billing/service";
import {
  assertPricesFresh,
  formatUsd,
  getPriceFeed,
} from "@/features/pricing/price-feed";
import { requestNetwork, requireAuth } from "@/http/middleware/auth";
import type { BillingCharge, BillingDeposit } from "@/shared/db/schema";
/**
 *   GET  /v1/billing/address     get this user's deposit Sui address
 *   GET  /v1/billing/balance     credit balance (microUSD + USD string)
 *   GET  /v1/billing/pricing     op prices in microUSD + USD-rendered
 *   POST /v1/billing/deposit     declare a tx digest for credit
 *   GET  /v1/billing/history     recent deposits + charges
 *
 * Internal accounting unit is microUSD: 1 microUSD = $0.000001. Every
 * monetary value below renders both the integer field (`*Micro`) and
 * a human-readable USD string (`*Usd`).
 *
 * `pricing` is unauthenticated so SDKs can quote before the user signs
 * up. Everything else requires an api key.
 */
import { Elysia, t } from "elysia";

const SUI_DIGEST = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

function publicDeposit(d: BillingDeposit) {
  return {
    id: d.id,
    txDigest: d.txDigest,
    senderAddress: d.senderAddress,
    coinType: d.coinType,
    amountAtomic: d.amountAtomic,
    creditsMicro: d.creditsCredited.toString(),
    creditsUsd: formatUsd(d.creditsCredited),
    sweepStatus: d.sweepStatus,
    sweepTxDigest: d.sweepTxDigest,
    createdAt: d.createdAt.toISOString(),
    sweptAt: d.sweptAt?.toISOString() ?? null,
  };
}

function publicCharge(c: BillingCharge) {
  return {
    id: c.id,
    opType: c.opType,
    opId: c.opId,
    kind: c.kind,
    creditsMicro: c.creditsMicro.toString(),
    creditsUsd: formatUsd(c.creditsMicro),
    reason: c.reason,
    createdAt: c.createdAt.toISOString(),
  };
}

export const billingRoutes = new Elysia({ prefix: "/v1/billing" })
  .get(
    "/pricing",
    () => {
      const feed = getPriceFeed();
      const opsUsd: Record<string, string> = {};
      for (const [op, micro] of Object.entries(OP_PRICES)) {
        opsUsd[op] = formatUsd(BigInt(micro));
      }
      const pricesUsd: Record<string, string> = {};
      for (const [coinType, micro] of feed.pricesMicroUsd) {
        pricesUsd[coinType] = formatUsd(micro);
      }
      let stale = false;
      try {
        assertPricesFresh();
      } catch {
        stale = true;
      }
      return {
        unit: "microUSD",
        microPerUsd: 1_000_000,
        ops: OP_PRICES,
        opsUsd,
        acceptedCoinTypes: env.BILLING_ACCEPTED_COIN_TYPES,
        minDepositMicro: env.BILLING_MIN_DEPOSIT_MICRO,
        minDepositUsd: formatUsd(BigInt(env.BILLING_MIN_DEPOSIT_MICRO)),
        coinPricesUsd: pricesUsd,
        priceFeed: {
          source: feed.source,
          loadedAt: feed.loadedAt,
          lastFeedSuccessAt: feed.lastFeedSuccessAt,
          stale,
        },
      };
    },
    {
      detail: {
        tags: ["billing"],
        summary: "Pricing snapshot",
        description:
          "Op prices in microUSD (1 microUSD = $0.000001), accepted coin types, and the live USD-per-coin map. `priceFeed.stale` reflects whether the last successful CoinGecko poll is past the operator's max-age budget; paid endpoints reject when stale, this read endpoint surfaces the flag for SDKs to display. Public — no auth.",
      },
    },
  )
  .get(
    "/address",
    async ({ request }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const address = await getOrCreateDepositAddress(user.id, network);
      return { address, network };
    },
    {
      detail: {
        tags: ["billing"],
        summary: "Deposit address",
        description:
          "Returns the user's HKDF-derived clearinghouse Sui address. Send any accepted coin type here; the backend will sweep into the operator's billing treasury once verified. The address is stable per user; safe to cache.",
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/balance",
    async ({ request }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const balance = await getBalance(user.id, network);
      return {
        network,
        creditsMicro: balance.toString(),
        creditsUsd: formatUsd(balance),
      };
    },
    {
      detail: {
        tags: ["billing"],
        summary: "Credit balance",
        description:
          "User's current microUSD balance plus a USD-rendered string. Updated atomically with each charge/refund.",
        security: [{ bearer: [] }],
      },
    },
  )
  .post(
    "/deposit",
    async ({ request, body, set }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const result = await recordDeposit(user.id, network, body.txDigest);
      set.status = result.duplicate ? 200 : 201;
      return {
        network,
        deposit: publicDeposit(result.deposit),
        duplicate: result.duplicate,
        creditsMicro: result.newBalanceMicro.toString(),
        creditsUsd: formatUsd(result.newBalanceMicro),
      };
    },
    {
      body: t.Object({
        txDigest: t.String({
          minLength: 32,
          maxLength: 80,
          pattern: SUI_DIGEST.source,
        }),
      }),
      detail: {
        tags: ["billing"],
        summary: "Declare deposit",
        description:
          "After sending coins to the deposit address, declare the resulting Sui tx digest. The backend verifies the on-chain balance change, credits microUSD at the live USD rate, and enqueues a sweep into the operator's treasury. Idempotent on `txDigest`: the same digest declared twice returns the original credit (200 on duplicate, 201 on first credit). Returns 422 on dust below the configured minimum, or 503 if the price feed is past its max-age.",
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/history",
    async ({ request }) => {
      const { user } = requireAuth(request);
      const network = requestNetwork(request);
      const [deposits, charges] = await Promise.all([
        listDeposits(user.id, network, 50),
        listCharges(user.id, network, 100),
      ]);
      return {
        network,
        deposits: deposits.map(publicDeposit),
        charges: charges.map(publicCharge),
      };
    },
    {
      detail: {
        tags: ["billing"],
        summary: "Deposit + charge history",
        description:
          "Recent ledger activity for the authenticated user. Up to 50 deposits and 100 charges/refunds in reverse-chronological order.",
        security: [{ bearer: [] }],
      },
    },
  );
