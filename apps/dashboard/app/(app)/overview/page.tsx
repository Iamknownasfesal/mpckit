"use client";

import { AddPasskeyBanner } from "@/components/add-passkey-banner";
import { ActivityFeed, type AuditEvent } from "@/components/dash/activity-feed";
import { CopyMono } from "@/components/dash/mono";
import { PageHeader } from "@/components/dash/page-header";
import { StatusPill } from "@/components/dash/status-pill";
import { Tile, TileBody, TileHeader } from "@/components/dash/tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useNetwork } from "@/lib/network";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CreditCard,
  KeyRound,
  Plus,
  Sparkles,
  Wallet,
} from "lucide-react";
import Link from "next/link";

type BalanceRes = { creditsMicro: string; creditsUsd: string };
type KeysRes = {
  keys: Array<{
    id: string;
    name: string;
    prefix: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }>;
};
type DwalletsRes = {
  dwallets: Array<{
    id: string;
    suiDwalletId: string;
    curve: number;
    kind: string;
    status: string;
    createdAt: string;
  }>;
};

export default function OverviewPage() {
  const { data: session } = useSession();
  const network = useNetwork();
  const balance = useQuery({
    queryKey: ["billing", "balance", network],
    queryFn: () => api.get<BalanceRes>("/v1/billing/balance"),
  });
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api.get<KeysRes>("/v1/users/me/api-keys"),
  });
  const dwallets = useQuery({
    queryKey: ["dwallets", network],
    queryFn: () => api.get<DwalletsRes>("/v1/dwallets"),
  });
  const audit = useQuery({
    queryKey: ["audit", { limit: 8 }],
    queryFn: () =>
      api.get<{ events: AuditEvent[] }>("/v1/users/me/audit?limit=8"),
  });

  const firstName =
    session?.user.name?.split(" ")[0] ??
    session?.user.email?.split("@")[0] ??
    "operator";

  const activeKeys = keys.data?.keys.filter((k) => !k.revokedAt) ?? [];
  const recentDwallets = (dwallets.data?.dwallets ?? []).slice(0, 5);
  const noKeys = !keys.isPending && activeKeys.length === 0;
  const noBalance =
    !balance.isPending && (balance.data?.creditsMicro ?? "0") === "0";
  const noDwallets =
    !dwallets.isPending && (dwallets.data?.dwallets.length ?? 0) === 0;
  const showOnboarding = noKeys || noBalance;

  return (
    <div className="space-y-10">
      <PageHeader
        kicker="Console · Overview"
        title={<>Welcome back, {firstName}.</>}
        description={
          <>
            Your signing service at a glance. All numbers update against your
            selected Sui network.
          </>
        }
        right={
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-11 rounded-full"
          >
            <Link href="/api-keys">
              <Plus /> New API key
            </Link>
          </Button>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
      >
        <StatGrid
          balanceMicro={balance.data?.creditsMicro}
          balanceLoading={balance.isPending}
          keys={activeKeys.length}
          keysLatest={activeKeys[0]?.name}
          keysLoading={keys.isPending}
          dwallets={dwallets.data?.dwallets.length ?? 0}
          dwalletsLatest={
            recentDwallets[0] ? shortId(recentDwallets[0].suiDwalletId) : null
          }
          dwalletsLoading={dwallets.isPending}
        />
      </motion.div>

      {showOnboarding ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease: "easeOut" }}
        >
          <GetStartedTile
            hasKeys={!noKeys}
            hasBalance={!noBalance}
            hasDwallets={!noDwallets}
          />
        </motion.div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.32, ease: "easeOut" }}
        className="grid gap-5 lg:grid-cols-2"
      >
        <RecentDwallets loading={dwallets.isPending} rows={recentDwallets} />
        <RecentActivity
          loading={audit.isPending}
          events={audit.data?.events ?? []}
        />
      </motion.div>

      <AddPasskeyBanner />
    </div>
  );
}

function StatGrid({
  balanceMicro,
  balanceLoading,
  keys,
  keysLatest,
  keysLoading,
  dwallets,
  dwalletsLatest,
  dwalletsLoading,
}: {
  balanceMicro?: string;
  balanceLoading: boolean;
  keys: number;
  keysLatest?: string;
  keysLoading: boolean;
  dwallets: number;
  dwalletsLatest: string | null;
  dwalletsLoading: boolean;
}) {
  const micro = balanceMicro ? Number(balanceMicro) : 0;
  const dollars = micro / 1_000_000;
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl border bg-border/60 md:grid-cols-3">
      <StatCell
        kicker="Balance"
        icon={CreditCard}
        loading={balanceLoading}
        big={formatBalanceUsd(dollars)}
        unit={
          balanceMicro
            ? `${new Intl.NumberFormat("en-US").format(Math.round(micro))} microUSD`
            : ""
        }
        href="/billing"
        cta="Top up"
      />
      <StatCell
        kicker="Active keys"
        icon={KeyRound}
        loading={keysLoading}
        big={String(keys)}
        unit={keysLatest ? `latest: ${keysLatest}` : "none yet"}
        href="/api-keys"
        cta="Manage"
      />
      <StatCell
        kicker="dWallets"
        icon={Wallet}
        loading={dwalletsLoading}
        big={String(dwallets)}
        unit={dwalletsLatest ?? "none yet"}
        href="/dwallets"
        cta="Open"
      />
    </div>
  );
}

function StatCell({
  kicker,
  icon: Icon,
  loading,
  big,
  unit,
  href,
  cta,
}: {
  kicker: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  big: string;
  unit: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="group relative flex flex-col gap-5 overflow-hidden bg-background/85 p-7 md:p-9">
      <div className="flex items-start justify-between text-muted-foreground">
        <span className="t-kicker">{kicker}</span>
        <Icon className="size-4 transition-colors group-hover:text-primary" />
      </div>
      <div className="min-w-0">
        {loading ? (
          <Skeleton className="h-10 w-32" />
        ) : (
          <div
            className="t-mono truncate font-medium leading-none tracking-tight text-foreground"
            style={{ fontSize: "clamp(32px, 3.6vw, 48px)" }}
          >
            {big}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        {loading ? (
          <Skeleton className="h-3 w-28" />
        ) : (
          <span className="t-mono truncate text-[11px] text-muted-foreground">
            {unit}
          </span>
        )}
        <Link
          href={href}
          className="t-mono inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary opacity-80 transition-opacity hover:opacity-100"
        >
          {cta}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function GetStartedTile({
  hasKeys,
  hasBalance,
  hasDwallets,
}: {
  hasKeys: boolean;
  hasBalance: boolean;
  hasDwallets: boolean;
}) {
  return (
    <Tile glow="teal" dots>
      <TileHeader
        kicker="Get started · 3 steps"
        title={
          <>
            Two minutes from key to{" "}
            <span className="text-primary">first signature</span>.
          </>
        }
        description="Each step ticks itself off as you complete it."
        right={<Sparkles className="size-4 text-primary" />}
      />
      <TileBody className="pt-7">
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Step
            n={1}
            done={hasKeys}
            kicker="API key"
            title="Issue your first key"
            hint="Used as Bearer in SDK calls. Plaintext shown once."
            href="/api-keys"
            cta={hasKeys ? "Done" : "Issue"}
          />
          <Step
            n={2}
            done={hasBalance}
            kicker="Credit"
            title="Top up credits"
            hint="Send any accepted coin to your deposit address."
            href="/billing"
            cta={hasBalance ? "Done" : "Top up"}
          />
          <Step
            n={3}
            done={hasDwallets}
            kicker="dWallet"
            title="Onboard a dWallet"
            hint="Run the SDK's DKG flow with your new key."
            href="https://docs.mpckit.xyz/quickstart"
            cta={hasDwallets ? "Done" : "Quickstart"}
            external
          />
        </ol>
      </TileBody>
    </Tile>
  );
}

function Step({
  n,
  done,
  kicker,
  title,
  hint,
  href,
  cta,
  external,
}: {
  n: number;
  done: boolean;
  kicker: string;
  title: string;
  hint: string;
  href: string;
  cta: string;
  external?: boolean;
}) {
  return (
    <li className="group relative flex flex-col gap-3 rounded-2xl border bg-background/70 p-5 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="t-mono text-[10.5px] uppercase tracking-[0.18em] text-primary">
          {kicker} · 0{n}
        </span>
        {done ? (
          <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" strokeWidth={2.6} />
          </span>
        ) : (
          <span className="grid size-5 place-items-center rounded-full border border-muted-foreground/30">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
          </span>
        )}
      </div>
      <div>
        <div
          className={
            done
              ? "text-sm font-medium opacity-50 line-through"
              : "text-[15px] font-medium tracking-tight"
          }
        >
          {title}
        </div>
        <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {hint}
        </div>
      </div>
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="t-mono mt-auto inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary"
        >
          {cta}
          <ArrowUpRight className="size-3.5" />
        </a>
      ) : (
        <Link
          href={href}
          className="t-mono mt-auto inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary"
        >
          {cta}
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </li>
  );
}

function RecentDwallets({
  loading,
  rows,
}: {
  loading: boolean;
  rows: DwalletsRes["dwallets"];
}) {
  return (
    <Tile>
      <TileHeader
        kicker="Recent · dWallets"
        title="Last 5 onboarded"
        right={
          <Button asChild variant="ghost" size="sm">
            <Link href="/dwallets">
              All <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <div className="px-6 pb-2 md:px-8">
        {loading ? (
          <ListSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyList icon={Wallet} label="No dWallets yet" />
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <CopyMono
                    value={d.suiDwalletId}
                    display={shortId(d.suiDwalletId)}
                  />
                  <div className="t-mono mt-1 text-[11px] text-muted-foreground">
                    curve {d.curve} · {d.kind}
                  </div>
                </div>
                <DStatus status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Tile>
  );
}

function RecentActivity({
  loading,
  events,
}: {
  loading: boolean;
  events: AuditEvent[];
}) {
  return (
    <Tile>
      <TileHeader
        kicker="Recent · Activity"
        title="Audit feed"
        description="Every key issuance, revocation, and sign-in attempt."
        right={
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings#activity">
              All <ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <div className="px-6 pb-2 md:px-8">
        <ActivityFeed loading={loading} events={events} limit={6} />
      </div>
    </Tile>
  );
}

function DStatus({ status }: { status: string }) {
  if (status === "Active") return <StatusPill tone="live">{status}</StatusPill>;
  if (status === "AwaitingKeyHolderSignature")
    return (
      <StatusPill tone="warn" pulse>
        awaiting share
      </StatusPill>
    );
  if (status === "Failed")
    return <StatusPill tone="danger">{status}</StatusPill>;
  return <StatusPill tone="neutral">{status}</StatusPill>;
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <ul className="divide-y divide-border/60">
      {Array.from({ length: rows }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
        <li key={i} className="flex items-center justify-between py-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-20" />
        </li>
      ))}
    </ul>
  );
}

function EmptyList({
  icon: Icon,
  label,
  cta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="grid size-10 place-items-center rounded-full border bg-card/40">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">{label}</div>
      {cta}
    </div>
  );
}

function formatBalanceUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}
