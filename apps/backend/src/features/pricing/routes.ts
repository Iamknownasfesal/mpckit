import { Elysia, t } from "elysia";
import { env } from "@/config/env";
import { formatUsd } from "@/features/pricing/price-feed";
import {
  getPricing,
  type PricingValue,
  Protocol,
  pricingKey,
  quoteSign,
  withSafetyMultiplier,
} from "@/features/pricing/service";
import { requestNetwork } from "@/http/middleware/auth";

const valueShape = (v: PricingValue) => ({
  feeIka: v.feeIka.toString(),
  gasFeeReimbursementSui: v.gasFeeReimbursementSui.toString(),
  gasFeeReimbursementSuiForSystemCalls:
    v.gasFeeReimbursementSuiForSystemCalls.toString(),
});

export const pricingRoutes = new Elysia({ prefix: "/v1" })
  .get(
    "/pricing",
    async ({ request }) => {
      const snap = await getPricing(requestNetwork(request));
      return {
        loadedAt: snap.loadedAt,
        entries: snap.entries.map((e) => ({
          key: e.key,
          keyString: pricingKey(
            e.key.curve,
            e.key.signatureAlgorithm,
            e.key.protocol,
          ),
          value: valueShape(e.value),
        })),
      };
    },
    {
      detail: {
        tags: ["pricing"],
        summary: "Coordinator pricing snapshot",
        description:
          "On-chain Ika coordinator pricing per (curve, signatureAlgorithm, protocol) tuple, in raw IKA + SUI atomic units. This is the operator-facing view; SDKs that just need a sign quote should call `/v1/pricing/quote/sign` instead. Public — no auth.",
      },
    },
  )
  .get(
    "/pricing/quote/sign",
    async ({ query, request }) => {
      const curve = Number(query.curve);
      const signatureAlgorithm = Number(query.sigAlgo);
      const q = await quoteSign(
        requestNetwork(request),
        curve,
        signatureAlgorithm,
      );
      const quotedMicroUsd = withSafetyMultiplier(q.feeMicroUsd);
      return {
        curve,
        signatureAlgorithm,
        raw: {
          feeIka: q.feeIka.toString(),
          feeSui: q.feeSui.toString(),
          feeMicroUsd: q.feeMicroUsd.toString(),
          feeUsd: formatUsd(q.feeMicroUsd),
        },
        quoted: {
          feeIka: withSafetyMultiplier(q.feeIka).toString(),
          feeSui: withSafetyMultiplier(q.feeSui).toString(),
          feeMicroUsd: quotedMicroUsd.toString(),
          feeUsd: formatUsd(quotedMicroUsd),
          safetyMultiplier: env.PRICING_SAFETY_MULTIPLIER,
        },
        protocols: q.protocols.map(({ protocol, value }) => ({
          protocol,
          name: Object.entries(Protocol).find(([, v]) => v === protocol)?.[0],
          value: valueShape(value),
        })),
      };
    },
    {
      query: t.Object({
        curve: t.String(),
        sigAlgo: t.String(),
      }),
      detail: {
        tags: ["pricing"],
        summary: "Sign fee quote",
        description:
          "Quotes the cost of one signature for the given (curve, signatureAlgorithm) at the live USD rate. Returns both the raw on-chain pricing (IKA + SUI atomic units, microUSD) and a `quoted` view inflated by `PRICING_SAFETY_MULTIPLIER`. SDKs and dashboards should display `quoted.feeUsd`. Public — no auth.",
      },
    },
  );
