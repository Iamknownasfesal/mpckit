"use client";

import { CodeWindow } from "@/components/dash/code-window";
import { CopyMono, Mono } from "@/components/dash/mono";
import { PageHeader } from "@/components/dash/page-header";
import { StatusPill } from "@/components/dash/status-pill";
import { Tile, TileBody, TileHeader } from "@/components/dash/tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { suiscanTxUrl, useNetwork } from "@/lib/network";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
  updatedAt: string;
};

const CURVE_LABELS: Record<number, string> = {
  0: "secp256k1",
  1: "secp256r1",
  2: "ed25519",
  3: "ristretto",
};

export default function DwalletDetailPage() {
  const { id } = useParams<{ id: string }>();
  const network = useNetwork();
  const q = useQuery({
    queryKey: ["dwallets", network, id],
    queryFn: () => api.get<{ dwallet: DwalletRow }>(`/v1/dwallets/${id}`),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.dwallet.status === "AwaitingKeyHolderSignature"
        ? 4000
        : false,
  });

  return (
    <div className="space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
          <Link href="/dwallets">
            <ArrowLeft /> All dWallets
          </Link>
        </Button>
        <PageHeader
          kicker={`dWallet · ${id?.slice(0, 8) ?? ""}…`}
          title={
            q.data ? (
              <>
                <span className="text-primary">
                  {CURVE_LABELS[q.data.dwallet.curve] ?? "curve-?"}
                </span>{" "}
                dWallet
              </>
            ) : (
              "Loading dWallet…"
            )
          }
          description={
            q.data ? (
              <>
                On-chain status, tx history, and the immutable identifiers we
                track in our database.
              </>
            ) : null
          }
          right={q.data ? <DStatus status={q.data.dwallet.status} /> : null}
        />
      </div>

      {q.isPending ? (
        <Tile>
          <TileBody>
            <Skeleton className="h-32 w-full" />
          </TileBody>
        </Tile>
      ) : q.error ? (
        <Tile glow="danger">
          <TileBody>
            <div className="t-mono text-sm text-destructive">
              {q.error instanceof ApiError
                ? q.error.message
                : "Couldn't load dWallet"}
            </div>
          </TileBody>
        </Tile>
      ) : q.data ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: "easeOut" }}
        >
          <DwalletDetail dwallet={q.data.dwallet} />
        </motion.div>
      ) : null}
    </div>
  );
}

function DwalletDetail({ dwallet }: { dwallet: DwalletRow }) {
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Tile className="lg:col-span-3" dots>
        <TileHeader
          kicker="On-chain · Identifier"
          title="Sui dWallet"
          description="Globally unique under Ika's coordinator on Sui."
        />
        <TileBody className="pt-7">
          <CodeWindow
            filename={`dwallet-${dwallet.id.slice(0, 8)}`}
            status="LIVE"
          >
            <div className="space-y-4 px-5 py-5">
              <div>
                <div className="t-kicker mb-1.5">Sui dWallet ID</div>
                <CopyMono value={dwallet.suiDwalletId} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="t-kicker mb-1.5">Curve</div>
                  <Mono>
                    {CURVE_LABELS[dwallet.curve] ?? `curve-${dwallet.curve}`}
                  </Mono>
                </div>
                <div>
                  <div className="t-kicker mb-1.5">Kind</div>
                  <Mono>{dwallet.kind}</Mono>
                </div>
              </div>
              <div>
                <div className="t-kicker mb-1.5">DKG tx</div>
                {dwallet.dkgTxDigest ? (
                  <TxLink digest={dwallet.dkgTxDigest} />
                ) : (
                  <span className="t-mono text-[11.5px] text-muted-foreground">
                    pending
                  </span>
                )}
              </div>
              <div>
                <div className="t-kicker mb-1.5">Accept tx</div>
                {dwallet.acceptTxDigest ? (
                  <TxLink digest={dwallet.acceptTxDigest} />
                ) : (
                  <span className="t-mono text-[11.5px] text-muted-foreground">
                    pending
                  </span>
                )}
              </div>
            </div>
          </CodeWindow>
        </TileBody>
      </Tile>

      <Tile className="lg:col-span-2">
        <TileHeader kicker="Metadata" title="Stored locally" />
        <TileBody className="space-y-5 pt-7">
          <Row label="Local row ID">
            <CopyMono value={dwallet.id} display={shortId(dwallet.id)} />
          </Row>
          <Row label="Account">
            <Mono>{shortId(dwallet.accountId)}</Mono>
          </Row>
          <Row label="Encryption key">
            <Mono>{shortId(dwallet.encryptionKeyId)}</Mono>
          </Row>
          <Row label="Created">
            <span className="t-mono text-[11.5px]">
              {relativeDate(dwallet.createdAt)}
            </span>
          </Row>
          <Row label="Updated">
            <span className="t-mono text-[11.5px]">
              {relativeDate(dwallet.updatedAt)}
            </span>
          </Row>
        </TileBody>
      </Tile>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
      <span className="t-kicker">{label}</span>
      {children}
    </div>
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

function TxLink({ digest }: { digest: string }) {
  const network = useNetwork();
  return (
    <a
      href={suiscanTxUrl(digest, network)}
      target="_blank"
      rel="noreferrer"
      className="t-mono inline-flex items-center gap-1.5 text-[11.5px] text-primary transition-opacity hover:opacity-80"
    >
      {digest.slice(0, 10)}…
      <ArrowUpRight className="size-3.5" />
    </a>
  );
}

function shortId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 12)}…${id.slice(-6)}`;
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
