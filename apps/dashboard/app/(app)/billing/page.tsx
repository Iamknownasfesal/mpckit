"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Copy,
  Receipt,
  Wallet,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { CodeWindow } from "@/components/dash/code-window";
import { CoinLogo } from "@/components/dash/coin-logo";
import { Kicker } from "@/components/dash/kicker";
import { Mono } from "@/components/dash/mono";
import { PageHeader } from "@/components/dash/page-header";
import { StatusPill } from "@/components/dash/status-pill";
import { Tile, TileBody, TileHeader } from "@/components/dash/tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { coinMeta } from "@/lib/coins";
import { suiscanObjectUrl, suiscanTxUrl, useNetwork } from "@/lib/network";

type BalanceRes = { creditsMicro: string; creditsUsd: string };
type AddressRes = { address: string };
type PricingRes = {
  unit: "microUSD";
  microPerUsd: number;
  ops: Record<string, number>;
  opsUsd: Record<string, string>;
  acceptedCoinTypes: string[];
  minDepositMicro: number;
  minDepositUsd: string;
  coinPricesUsd: Record<string, string>;
  priceFeed: { stale: boolean; source: string; lastFeedSuccessAt: string };
};
type DepositRow = {
  id: string;
  txDigest: string;
  senderAddress: string;
  coinType: string;
  amountAtomic: string;
  creditsMicro: string;
  creditsUsd: string;
  sweepStatus: string;
  sweepTxDigest: string | null;
  createdAt: string;
  sweptAt: string | null;
};
type ChargeRow = {
  id: string;
  opType: string;
  opId: string | null;
  kind: string;
  creditsMicro: string;
  creditsUsd: string;
  reason: string | null;
  createdAt: string;
};

export default function BillingPage() {
  const network = useNetwork();
  const balance = useQuery({
    queryKey: ["billing", "balance", network],
    queryFn: () => api.get<BalanceRes>("/v1/billing/balance"),
    refetchInterval: 10_000,
  });
  const address = useQuery({
    queryKey: ["billing", "address", network],
    queryFn: () => api.get<AddressRes>("/v1/billing/address"),
  });
  const pricing = useQuery({
    queryKey: ["billing", "pricing"],
    queryFn: () => api.get<PricingRes>("/v1/billing/pricing"),
  });
  const history = useQuery({
    queryKey: ["billing", "history", network],
    queryFn: () =>
      api.get<{ deposits: DepositRow[]; charges: ChargeRow[] }>(
        "/v1/billing/history",
      ),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Console · Billing"
        title={
          <>
            Credits.{" "}
            <span className="text-primary">Paid by the signature.</span>
          </>
        }
        description="Deposit any accepted coin to your address, declare the tx digest, get credited at the live USD rate. Charges land in real time as your API keys are used."
        right={<DeclareDepositDialog />}
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
      >
        <TopRow
          balance={balance.data}
          balanceLoading={balance.isPending}
          address={address.data?.address}
          addressLoading={address.isPending}
          pricing={pricing.data}
          pricingLoading={pricing.isPending}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25, ease: "easeOut" }}
      >
        <OpsPricingTile data={pricing.data} loading={pricing.isPending} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.32, ease: "easeOut" }}
      >
        <LedgerTile
          deposits={history.data?.deposits ?? []}
          charges={history.data?.charges ?? []}
          loading={history.isPending}
        />
      </motion.div>
    </div>
  );
}

function TopRow({
  balance,
  balanceLoading,
  address,
  addressLoading,
  pricing,
  pricingLoading,
}: {
  balance?: BalanceRes;
  balanceLoading: boolean;
  address?: string;
  addressLoading: boolean;
  pricing?: PricingRes;
  pricingLoading: boolean;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <BalanceHero
        balanceMicro={balance?.creditsMicro}
        loading={balanceLoading}
      />
      <DepositTile
        address={address}
        addressLoading={addressLoading}
        pricing={pricing}
        pricingLoading={pricingLoading}
      />
    </div>
  );
}

function BalanceHero({
  balanceMicro,
  loading,
}: {
  balanceMicro?: string;
  loading: boolean;
}) {
  const micro = balanceMicro ? Number(balanceMicro) : 0;
  const dollars = micro / 1_000_000;
  const display = loading ? null : formatBalance(dollars);
  return (
    <Tile glow="teal" dots className="lg:col-span-5">
      <div className="flex h-full flex-col p-8 md:p-10">
        <div className="flex items-center justify-between">
          <Kicker>Available balance</Kicker>
          <Wallet className="size-4 text-muted-foreground" />
        </div>
        <div className="mt-6 min-w-0">
          {loading ? (
            <Skeleton className="h-16 w-48" />
          ) : (
            <div
              className="t-mono truncate font-medium leading-[0.95] tracking-[-0.025em]"
              style={{
                fontSize: "clamp(40px, 6.5vw, 76px)",
              }}
            >
              {display}
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          {loading ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <Mono>{formatMicro(micro)} microUSD</Mono>
          )}
          <StatusPill tone="primary">1M microUSD = $1</StatusPill>
        </div>
      </div>
    </Tile>
  );
}

function formatBalance(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

function formatMicro(micro: number): string {
  if (!Number.isFinite(micro)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(micro));
}

function DepositTile({
  address,
  addressLoading,
  pricing,
  pricingLoading,
}: {
  address?: string;
  addressLoading: boolean;
  pricing?: PricingRes;
  pricingLoading: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const network = useNetwork();
  async function copy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <Tile className="lg:col-span-7">
      <div className="flex h-full flex-col gap-6 p-7 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <Kicker>Top up · Deposit address</Kicker>
            <h3 className="text-balance text-lg font-semibold tracking-tight">
              Send any accepted coin to this Sui address.
            </h3>
          </div>
          <ArrowDownToLine className="size-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
          <div className="flex shrink-0 items-center justify-center rounded-xl border bg-background p-3">
            {addressLoading || !address ? (
              <Skeleton className="size-[136px]" />
            ) : (
              <QRCodeSVG
                value={address}
                size={136}
                bgColor="transparent"
                fgColor="currentColor"
                className="text-foreground"
                level="M"
              />
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <Kicker className="mb-1.5 block">Address</Kicker>
              {addressLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : address ? (
                <div className="flex items-center gap-2">
                  <code
                    className="t-mono flex-1 rounded-xl border bg-background/70 px-3 py-2.5 text-[12.5px] text-foreground"
                    title={address}
                  >
                    {shortAddress(address)}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copy}
                    className="h-10 shrink-0 rounded-xl px-3"
                    aria-label={copied ? "Copied" : "Copy address"}
                  >
                    {copied ? (
                      <>
                        <Check /> Copied
                      </>
                    ) : (
                      <>
                        <Copy /> Copy
                      </>
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Kicker>
                  Accepted ·{" "}
                  {pricing
                    ? `${pricing.acceptedCoinTypes.length} coin${pricing.acceptedCoinTypes.length === 1 ? "" : "s"}`
                    : "loading"}
                </Kicker>
                {pricing ? (
                  <span className="t-mono text-[10.5px] text-muted-foreground">
                    min {formatUsdAmount(pricing.minDepositMicro)}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pricingLoading ? (
                  <>
                    <Skeleton className="h-7 w-24 rounded-full" />
                    <Skeleton className="h-7 w-24 rounded-full" />
                  </>
                ) : pricing?.acceptedCoinTypes.length === 0 ? (
                  <span className="t-mono text-[11px] text-muted-foreground">
                    No accepted coins configured.
                  </span>
                ) : (
                  pricing?.acceptedCoinTypes.map((coinType) => (
                    <CoinChip
                      key={coinType}
                      coinType={coinType}
                      priceUsd={pricing.coinPricesUsd[coinType]}
                      network={network}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Tile>
  );
}

function CoinChip({
  coinType,
  priceUsd,
  network,
}: {
  coinType: string;
  priceUsd?: string;
  network: "testnet" | "mainnet";
}) {
  const meta = coinMeta(coinType);
  return (
    <a
      href={suiscanObjectUrl(coinType.split("::")[0] ?? coinType, network)}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-2 rounded-full border bg-card/60 py-1 pl-1 pr-3 transition-colors hover:border-primary/40 hover:bg-card"
      title={coinType}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <CoinLogo symbol={meta.symbol} />
      </span>
      <div className="flex items-baseline gap-1.5 leading-none">
        <span className="t-mono text-[11px] font-medium text-foreground">
          {meta.symbol}
        </span>
        {priceUsd ? (
          <span className="t-mono text-[10px] text-muted-foreground">
            {priceUsd}
          </span>
        ) : null}
      </div>
      <ArrowUpRight className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  );
}

function OpsPricingTile({
  data,
  loading,
}: {
  data?: PricingRes;
  loading: boolean;
}) {
  return (
    <Tile>
      <TileHeader
        kicker="Pricing"
        title="What each operation costs"
        description="Charged against your balance the moment an op completes. Rates apply to every API key on this account."
        right={
          data ? (
            <StatusPill
              tone={data.priceFeed.stale ? "warn" : "live"}
              pulse={!data.priceFeed.stale}
            >
              {data.priceFeed.stale ? "Feed stale" : "Feed live"}
            </StatusPill>
          ) : null
        }
      />
      <TileBody className="pt-8">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : data ? (
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border bg-border/60 sm:grid-cols-2 md:grid-cols-3">
            {Object.entries(data.ops).map(([op, micro]) => (
              <div
                key={op}
                className="flex flex-col gap-2 bg-background/85 p-5"
              >
                <Mono className="self-start">{op}</Mono>
                <div className="t-mono mt-1 text-2xl font-medium tracking-tight">
                  {data.opsUsd[op]}
                </div>
                <span className="t-mono text-[11px] text-muted-foreground">
                  {micro.toLocaleString()} microUSD
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </TileBody>
    </Tile>
  );
}

function LedgerTile({
  deposits,
  charges,
  loading,
}: {
  deposits: DepositRow[];
  charges: ChargeRow[];
  loading: boolean;
}) {
  const network = useNetwork();
  return (
    <Tile>
      <TileHeader
        kicker="Activity"
        title="Deposits and charges"
        description="Reverse-chronological. Last 50 deposits and 100 charges. Tx digests link to Suiscan."
      />
      <div className="px-6 pb-8 pt-2 md:px-8">
        <Tabs defaultValue="deposits" className="gap-5">
          <TabsList>
            <TabsTrigger value="deposits">
              <ArrowDownToLine className="mr-1.5 size-3.5" />
              Deposits
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5">
                {deposits.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="charges">
              <Receipt className="mr-1.5 size-3.5" />
              Charges
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5">
                {charges.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="deposits" className="mt-4">
            {loading ? (
              <SkeletonRows />
            ) : deposits.length === 0 ? (
              <EmptyHistory
                icon={ArrowDownToLine}
                label="No deposits yet"
                hint="Send coins to the address above, then declare the tx digest."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="t-kicker">When</TableHead>
                    <TableHead className="t-kicker">Coin</TableHead>
                    <TableHead className="t-kicker">Amount</TableHead>
                    <TableHead className="t-kicker">Credited</TableHead>
                    <TableHead className="t-kicker">Sweep</TableHead>
                    <TableHead className="t-kicker text-right">Tx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deposits.map((d) => {
                    const meta = coinMeta(d.coinType);
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="t-mono text-[11.5px] text-muted-foreground">
                          {relativeDate(d.createdAt)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="grid size-4 shrink-0 place-items-center">
                              <CoinLogo symbol={meta.symbol} />
                            </span>
                            <Mono>{meta.symbol}</Mono>
                          </span>
                        </TableCell>
                        <TableCell className="t-mono text-[11.5px]">
                          {d.amountAtomic}
                        </TableCell>
                        <TableCell className="t-mono">{d.creditsUsd}</TableCell>
                        <TableCell>
                          <SweepStatus status={d.sweepStatus} />
                        </TableCell>
                        <TableCell className="text-right">
                          <TxLink digest={d.txDigest} network={network} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>
          <TabsContent value="charges" className="mt-4">
            {loading ? (
              <SkeletonRows />
            ) : charges.length === 0 ? (
              <EmptyHistory
                icon={Receipt}
                label="No charges yet"
                hint="Charges land here every time the API performs a paid op."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="t-kicker">When</TableHead>
                    <TableHead className="t-kicker">Op</TableHead>
                    <TableHead className="t-kicker">Kind</TableHead>
                    <TableHead className="t-kicker">Cost</TableHead>
                    <TableHead className="t-kicker">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {charges.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="t-mono text-[11.5px] text-muted-foreground">
                        {relativeDate(c.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Mono>{c.opType}</Mono>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            c.kind === "refund" ? "outline" : "secondary"
                          }
                          className="t-mono text-[10px]"
                        >
                          {c.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="t-mono">{c.creditsUsd}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {c.reason ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Tile>
  );
}

function DeclareDepositDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState("");

  const declare = useMutation({
    mutationFn: async (txDigest: string) =>
      api.post<{
        deposit: DepositRow;
        duplicate: boolean;
        creditsUsd: string;
      }>("/v1/billing/deposit", { txDigest }),
    onSuccess: (data) => {
      toast.success(
        data.duplicate ? "Already credited" : `Credited ${data.creditsUsd}`,
      );
      setOpen(false);
      setDigest("");
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (err) =>
      toast.error("Couldn't credit deposit", {
        description: err instanceof ApiError ? err.message : "Unknown error",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="h-11 rounded-full">
          <ArrowDownToLine /> Declare deposit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!digest.trim()) return;
            declare.mutate(digest.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Credit a deposit</DialogTitle>
            <DialogDescription>
              Paste the Sui transaction digest from your wallet. We verify the
              on-chain balance change and credit at the live rate.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <CodeWindow filename="declare-deposit" status="INPUT">
              <div className="space-y-2 px-4 py-4">
                <Label htmlFor="tx-digest" className="t-kicker">
                  Sui tx digest
                </Label>
                <Input
                  id="tx-digest"
                  value={digest}
                  onChange={(e) => setDigest(e.target.value)}
                  placeholder="9V8e…J4Tn"
                  className="t-mono"
                  required
                  autoFocus
                />
              </div>
            </CodeWindow>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!digest.trim() || declare.isPending}
            >
              {declare.isPending ? "Verifying…" : "Credit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SweepStatus({ status }: { status: string }) {
  if (status === "swept") return <StatusPill tone="live">swept</StatusPill>;
  if (status === "pending")
    return (
      <StatusPill tone="warn" pulse>
        pending
      </StatusPill>
    );
  return <StatusPill tone="neutral">{status}</StatusPill>;
}

function TxLink({
  digest,
  network,
}: {
  digest: string;
  network: "testnet" | "mainnet";
}) {
  return (
    <a
      href={suiscanTxUrl(digest, network)}
      target="_blank"
      rel="noreferrer"
      className="t-mono inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-primary"
    >
      {digest.slice(0, 6)}…
      <ArrowUpRight className="size-3.5" />
    </a>
  );
}

function EmptyHistory({
  icon: Icon,
  label,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="grid size-10 place-items-center rounded-2xl border bg-card/50">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2 py-6">
      {Array.from({ length: 3 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function formatUsdAmount(micro: number | string): string {
  const m = typeof micro === "string" ? Number(micro) : micro;
  if (!Number.isFinite(m)) return "$0";
  const usd = m / 1_000_000;
  if (usd >= 1) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(usd);
  }
  if (usd >= 0.0001) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(usd);
  }
  return `${m.toLocaleString()} microUSD`;
}

function shortAddress(addr: string): string {
  if (addr.length <= 22) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
