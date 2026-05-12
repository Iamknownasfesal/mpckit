"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  currentNetwork,
  type Network,
  networkHint,
  networkLabel,
  setNetwork,
  useNetwork,
} from "@/lib/network";
import { cn } from "@/lib/utils";

/**
 * Side-effect: stamp the active network onto `<html data-network>` so
 * CSS can apply the mainnet amber tint sitewide. Mount this once at the
 * shell level.
 */
export function NetworkBodyTint() {
  const network = useNetwork();
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.network = network;
  }, [network]);
  return null;
}

/**
 * Sidebar card. Segmented control over the two networks, with an inline
 * confirmation dialog when switching to mainnet.
 */
export function NetworkBadge() {
  const network = useNetwork();
  const isMainnet = network === "mainnet";
  return (
    <div
      className={cn(
        "rounded-xl border bg-card/40 p-3 transition-colors",
        isMainnet && "border-signal-warn/30 bg-signal-warn/5",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="t-kicker">Network</span>
        <span className="relative flex size-2" aria-hidden>
          <span
            className={cn(
              "absolute inline-flex size-full rounded-full opacity-60 animate-ping",
              isMainnet ? "bg-signal-warn" : "bg-signal-live",
            )}
          />
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              isMainnet ? "bg-signal-warn" : "bg-signal-live",
            )}
          />
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="t-mono text-sm font-medium tracking-tight text-foreground">
          {networkLabel(network)}
        </span>
        {isMainnet ? (
          <span className="t-mono text-[9.5px] uppercase tracking-[0.18em] text-signal-warn">
            Live
          </span>
        ) : null}
      </div>
      <div className="t-mono mt-0.5 text-[10.5px] leading-tight text-muted-foreground">
        {networkHint(network)}
      </div>
      <NetworkSegment active={network} />
    </div>
  );
}

/**
 * Compact pill used in the header. Same semantics as the sidebar card,
 * just smaller — clicking the inactive label opens the dialog.
 */
export function NetworkHeaderPill() {
  const network = useNetwork();
  const isMainnet = network === "mainnet";
  return (
    <NetworkSegment
      active={network}
      className={cn(
        "rounded-full border bg-card/40 p-0.5",
        isMainnet && "border-signal-warn/30 bg-signal-warn/5",
      )}
      pillClassName="rounded-full px-2.5 py-1 text-[10px]"
    />
  );
}

function NetworkSegment({
  active,
  className,
  pillClassName,
}: {
  active: Network;
  className?: string;
  pillClassName?: string;
}) {
  const [pending, setPending] = useState<Network | null>(null);
  return (
    <>
      <div
        className={cn(
          "mt-3 grid grid-cols-2 gap-1 rounded-md border bg-background/50 p-0.5",
          className,
        )}
      >
        <NetworkPill
          target="testnet"
          active={active}
          onPick={() => switchTo("testnet", setPending)}
          pillClassName={pillClassName}
        />
        <NetworkPill
          target="mainnet"
          active={active}
          onPick={() => setPending("mainnet")}
          pillClassName={pillClassName}
        />
      </div>
      <MainnetConfirm
        open={pending === "mainnet" && active === "testnet"}
        onClose={() => setPending(null)}
        onConfirm={() => {
          setPending(null);
          switchTo("mainnet");
        }}
      />
    </>
  );
}

function NetworkPill({
  target,
  active,
  onPick,
  pillClassName,
}: {
  target: Network;
  active: Network;
  onPick: () => void;
  pillClassName?: string;
}) {
  const isActive = active === target;
  const isMain = target === "mainnet";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={isActive}
      className={cn(
        "t-mono inline-flex items-center justify-center gap-1.5 rounded-[5px] px-2 py-1 text-[10.5px] uppercase tracking-[0.14em] transition-colors",
        isActive
          ? isMain
            ? "bg-signal-warn/15 text-signal-warn"
            : "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
        pillClassName,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isActive
            ? isMain
              ? "bg-signal-warn"
              : "bg-signal-live"
            : "bg-muted-foreground/40",
        )}
      />
      <span>{target === "testnet" ? "Testnet" : "Mainnet"}</span>
    </button>
  );
}

function MainnetConfirm({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-signal-warn" />
            Switch to mainnet?
          </DialogTitle>
          <DialogDescription className="pt-1 text-[13px] leading-relaxed">
            You're about to leave testnet. On mainnet every charge debits real
            credit and every signature controls real value. Your testnet keys,
            dWallets, and balance stay where they are when you switch back.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>
            Stay on testnet
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            className="mainnet-confirm inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium text-background outline-none transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
            style={{ backgroundColor: "var(--signal-warn)" }}
          >
            Switch to mainnet
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Apply a network change: persist, invalidate every cached query so the
 * dashboard refetches under the new `x-network` header, and toast so the
 * user gets visible confirmation. Wrap so the caller doesn't have to
 * thread a `setPending` setter into the dialog path.
 */
function switchTo(
  next: Network,
  setPending?: (n: Network | null) => void,
): void {
  if (currentNetwork() === next) return;
  if (setPending) setPending(null);
  setNetwork(next);
  // QueryClientProvider sits above; we read it via the queryClient export.
  queryClientRef?.invalidateQueries();
  toast.success(`Switched to ${networkLabel(next)}`);
}

// Lazy reference assigned by `NetworkSwitcherBootstrap` below — we
// don't want to call useQueryClient() inside `switchTo` because that
// hook would have to live in a component, and switchTo is shared by
// both the dialog confirm path and the testnet pill.
let queryClientRef: ReturnType<typeof useQueryClient> | null = null;

/**
 * Drop this inside the QueryClientProvider so `switchTo()` can reach
 * the active client without going through a hook each call.
 */
export function NetworkSwitcherBootstrap() {
  const client = useQueryClient();
  useEffect(() => {
    queryClientRef = client;
    return () => {
      queryClientRef = null;
    };
  }, [client]);
  return null;
}
