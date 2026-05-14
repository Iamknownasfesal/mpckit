"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight, Wallet } from "lucide-react";
import Link from "next/link";
import { DwalletStatus } from "@/components/dash/dwallet-status";
import { CopyMono, Mono } from "@/components/dash/mono";
import { PageHeader } from "@/components/dash/page-header";
import { Tile, TileHeader } from "@/components/dash/tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { curveLabel } from "@/lib/dwallet-curves";
import { relativeDate } from "@/lib/format";
import { useNetwork } from "@/lib/network";
import { queryKeys } from "@/lib/query-keys";

type DwalletRow = {
  id: string;
  accountId: string;
  suiDwalletId: string;
  curve: number;
  kind: string;
  status: string;
  encryptionKeyId: string;
  dkgTxDigest: string | null;
  acceptTxDigest: string | null;
  createdAt: string;
};

export default function DwalletsPage() {
  const network = useNetwork();
  const dwallets = useQuery({
    queryKey: queryKeys.dwallets.all(network),
    queryFn: () => api.get<{ dwallets: DwalletRow[] }>("/v1/dwallets"),
  });

  const rows = dwallets.data?.dwallets ?? [];
  const active = rows.filter((r) => r.status === "Active").length;
  const pending = rows.filter(
    (r) => r.status === "AwaitingKeyHolderSignature",
  ).length;

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Console · dWallets"
        title={
          <>
            Threshold-signing keys.{" "}
            <span className="text-primary">Read-only.</span>
          </>
        }
        description="Lifecycle actions live in the SDK. We surface the on-chain state, tx digests, and curves you own here."
        right={
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-11 rounded-full"
          >
            <a
              href="https://docs.mpckit.xyz/quickstart"
              target="_blank"
              rel="noreferrer"
            >
              SDK quickstart <ArrowUpRight />
            </a>
          </Button>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
        className="grid grid-cols-1 gap-px overflow-hidden rounded-3xl border bg-border/60 md:grid-cols-3"
      >
        <Stat
          kicker="Total dWallets"
          value={rows.length}
          loading={dwallets.isPending}
        />
        <Stat
          kicker="Active"
          value={active}
          loading={dwallets.isPending}
          tone="live"
        />
        <Stat
          kicker="Awaiting share"
          value={pending}
          loading={dwallets.isPending}
          tone={pending > 0 ? "warn" : "neutral"}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25, ease: "easeOut" }}
      >
        <Tile>
          <TileHeader
            kicker="Ledger"
            title="Your dWallets"
            description="Click any row to inspect on-chain state."
          />
          <div className="px-2 pb-2">
            {dwallets.isPending ? (
              <DwalletSkeleton />
            ) : rows.length === 0 ? (
              <EmptyState />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="t-kicker pl-6">Sui dWallet</TableHead>
                    <TableHead className="t-kicker">Curve</TableHead>
                    <TableHead className="t-kicker">Kind</TableHead>
                    <TableHead className="t-kicker">Status</TableHead>
                    <TableHead className="t-kicker">Created</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="pl-6">
                        <CopyMono
                          value={d.suiDwalletId}
                          display={shortId(d.suiDwalletId)}
                        />
                      </TableCell>
                      <TableCell>
                        <Mono>{curveLabel(d.curve)}</Mono>
                      </TableCell>
                      <TableCell>
                        <Mono>{d.kind}</Mono>
                      </TableCell>
                      <TableCell>
                        <DwalletStatus status={d.status} />
                      </TableCell>
                      <TableCell className="t-mono text-[11.5px] text-muted-foreground">
                        {relativeDate(d.createdAt)}
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Open dWallet"
                        >
                          <Link href={`/dwallets/${d.id}`}>
                            <ArrowUpRight />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Tile>
      </motion.div>
    </div>
  );
}

function Stat({
  kicker,
  value,
  loading,
  tone,
}: {
  kicker: string;
  value: number;
  loading: boolean;
  tone?: "live" | "warn" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-4 bg-background/85 p-7 md:p-8">
      <div className="flex flex-col gap-2.5">
        <span className="t-kicker">{kicker}</span>
        {loading ? (
          <Skeleton className="h-9 w-12" />
        ) : (
          <span className="t-mono text-[36px] font-medium leading-none tracking-tight">
            {value}
          </span>
        )}
      </div>
      {tone ? (
        <span
          className={
            tone === "live"
              ? "size-2 rounded-full bg-signal-live"
              : tone === "warn"
                ? "size-2 rounded-full bg-signal-warn pulse-dot"
                : "size-2 rounded-full bg-muted-foreground/40"
          }
        />
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <div className="grid size-12 place-items-center rounded-2xl border bg-card/50">
        <Wallet className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <div className="text-base font-medium">No dWallets yet</div>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          Run the SDK's onboarding flow with one of your API keys to create your
          first threshold-signing key.
        </p>
      </div>
      <Button asChild variant="outline" size="sm" className="mt-2 rounded-full">
        <a
          href="https://docs.mpckit.xyz/quickstart"
          target="_blank"
          rel="noreferrer"
        >
          Read the quickstart <ArrowUpRight />
        </a>
      </Button>
    </div>
  );
}

function DwalletSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6">Sui dWallet</TableHead>
          <TableHead>Curve</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <TableRow key={i}>
            <TableCell className="pl-6">
              <Skeleton className="h-4 w-40" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto size-7 rounded-md" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}
