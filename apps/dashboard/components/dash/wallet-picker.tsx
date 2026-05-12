"use client";

import {
  useConnectWallet,
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useWallets,
} from "@mysten/dapp-kit";
import type { WalletWithRequiredFeatures } from "@mysten/wallet-standard";
import { ArrowUpRight, Check, ChevronRight, Plus, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Kicker } from "@/components/dash/kicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SUGGESTED: { name: string; url: string; blurb: string }[] = [
  { name: "Slush", url: "https://slush.app", blurb: "Mysten Labs official" },
  {
    name: "Sui Wallet",
    url: "https://chromewebstore.google.com/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil",
    blurb: "Chrome extension",
  },
  {
    name: "Suiet",
    url: "https://suiet.app",
    blurb: "Lightweight, open source",
  },
  {
    name: "Phantom",
    url: "https://phantom.com/download",
    blurb: "Multi-chain (Sui, Solana, EVM)",
  },
];

export function WalletPickerDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConnected?: (account: { address: string }) => void;
}) {
  const wallets = useWallets();
  const currentAccount = useCurrentAccount();
  const currentWallet = useCurrentWallet();
  const { mutateAsync: connect } = useConnectWallet();
  const { mutateAsync: disconnect } = useDisconnectWallet();
  const [pending, setPending] = useState<string | null>(null);

  async function pick(wallet: WalletWithRequiredFeatures) {
    setPending(wallet.name);
    try {
      if (currentWallet.currentWallet) {
        await disconnect();
      }
      const res = await connect({ wallet });
      const account = res.accounts[0];
      if (account) onConnected?.({ address: account.address });
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't connect wallet", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setPending(null);
    }
  }

  const hasInstalled = wallets.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[440px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32 tile-glow-teal opacity-50"
        />
        <div className="relative px-6 pt-6 pb-2">
          <DialogHeader className="space-y-1.5 text-left">
            <Kicker>Authentication · Wallet</Kicker>
            <DialogTitle className="text-balance text-xl font-semibold tracking-[-0.02em]">
              Pick a wallet to continue
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              Your wallet signs a one-time message to prove you own this
              address. We never see your keys.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6">
          {hasInstalled ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <Kicker>Detected on this device</Kicker>
                <span className="t-mono text-[10.5px] text-muted-foreground">
                  {wallets.length} {wallets.length === 1 ? "wallet" : "wallets"}
                </span>
              </div>
              <ul className="space-y-1.5">
                {wallets.map((w) => {
                  const isCurrent =
                    currentWallet.currentWallet?.name === w.name;
                  return (
                    <li key={w.name}>
                      <WalletRow
                        wallet={w}
                        isCurrent={isCurrent}
                        currentAddress={
                          isCurrent ? currentAccount?.address : undefined
                        }
                        pending={pending === w.name}
                        disabled={pending !== null}
                        onClick={() => pick(w)}
                      />
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <EmptyInstall />
          )}

          <div className="mt-6">
            <div className="mb-2.5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <Kicker>{hasInstalled ? "Add another" : "Install one"}</Kicker>
              <span className="h-px flex-1 bg-border" />
            </div>
            <ul className="grid grid-cols-2 gap-1.5">
              {SUGGESTED.map((s) => (
                <li key={s.name}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-2 rounded-lg border bg-card/40 px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-card/70"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-background">
                      <Plus className="size-3 text-muted-foreground transition-colors group-hover:text-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium">{s.name}</div>
                      <div className="t-mono truncate text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                        {s.blurb}
                      </div>
                    </div>
                    <ArrowUpRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WalletRow({
  wallet,
  isCurrent,
  currentAddress,
  pending,
  disabled,
  onClick,
}: {
  wallet: WalletWithRequiredFeatures;
  isCurrent: boolean;
  currentAddress?: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border bg-card/40 p-3 text-left transition-all hover:-translate-y-px hover:border-primary/60 hover:bg-card/70 disabled:translate-y-0 disabled:opacity-60",
        isCurrent && "border-primary/50 bg-primary/5",
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border bg-background">
        {wallet.icon ? (
          <img src={wallet.icon} alt="" className="size-7 object-contain" />
        ) : (
          <Wallet className="size-4 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14.5px] font-medium leading-tight">
          {wallet.name}
          {isCurrent ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 t-mono text-[9px] uppercase tracking-[0.14em] text-primary">
              <span className="size-1 rounded-full bg-primary" />
              Connected
            </span>
          ) : null}
        </div>
        {isCurrent && currentAddress ? (
          <code className="t-mono mt-0.5 block text-[10.5px] text-muted-foreground">
            {shortAddress(currentAddress)}
          </code>
        ) : null}
      </div>
      {pending ? (
        <span className="t-mono text-[10px] uppercase tracking-[0.16em] text-primary">
          Connecting…
        </span>
      ) : isCurrent ? (
        <Check className="size-4 text-primary" />
      ) : (
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      )}
    </button>
  );
}

function EmptyInstall() {
  return (
    <div className="rounded-xl border bg-card/40 p-6 text-center">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl border bg-background">
        <Wallet className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">No Sui wallet detected</div>
      <p className="mx-auto mt-1 max-w-xs text-[12px] text-muted-foreground">
        Install one of the wallets below, refresh, then come back here.
      </p>
    </div>
  );
}

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
