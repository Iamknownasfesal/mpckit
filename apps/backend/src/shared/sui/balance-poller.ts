/**
 * Periodic poller for the operator hot wallet's SUI balance, one
 * sample per enabled chain network. The exported gauge
 * `mpckit_hot_wallet_sui_mist{network=...}` lets operators alert when
 * the wallet is about to run out on either chain — every PTB the
 * backend submits pays gas off this address (gas-pool sponsors *its
 * own* coin pool; the operator hot wallet is still the tx sender).
 *
 * Skipped silently when the wallet is unconfigured (DB-less / read-
 * only deploys). Runs detached: errors are logged but never thrown.
 */
import { type IkaNetwork, env } from "@/config/env";
import { log } from "@/config/log";
import { hotWalletSuiMist } from "@/shared/cache/metrics";
import { listNetworks } from "@/shared/networks/registry";
import { getSuiClient } from "@/shared/sui/client";
import { getHotWallet } from "@/shared/sui/hot-wallet";

const SUI_TYPE = "0x2::sui::SUI";

let timer: ReturnType<typeof setInterval> | undefined;

async function pollOnce(network: IkaNetwork, address: string): Promise<void> {
  const balances = await getSuiClient(network).core.listBalances({
    owner: address,
  });
  const sui = balances.balances?.find((b) => b.coinType === SUI_TYPE);
  hotWalletSuiMist.set({ network }, sui ? Number(sui.balance) : 0);
}

async function pollAll(address: string): Promise<void> {
  await Promise.all(
    listNetworks().map((n) =>
      pollOnce(n, address).catch((err) =>
        log.warn({ err, network: n }, "balance-poller: poll failed"),
      ),
    ),
  );
}

export function startBalancePoller(): void {
  if (timer) return;
  let address: string;
  try {
    address = getHotWallet().address();
  } catch {
    log.warn(
      "balance-poller: hot wallet not configured; skipping balance gauge",
    );
    return;
  }
  // Initial poll so the gauge isn't empty until the first interval.
  pollAll(address).catch((err) =>
    log.warn({ err }, "balance-poller: initial poll failed"),
  );
  const ms = env.OBSERVABILITY_BALANCE_POLL_SEC * 1000;
  timer = setInterval(() => {
    pollAll(address).catch((err) =>
      log.warn({ err }, "balance-poller: scheduled poll failed"),
    );
  }, ms);
  if (typeof timer.unref === "function") timer.unref();
  log.info(
    {
      address,
      networks: listNetworks(),
      intervalSec: env.OBSERVABILITY_BALANCE_POLL_SEC,
    },
    "balance-poller: started",
  );
}

export function stopBalancePoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
