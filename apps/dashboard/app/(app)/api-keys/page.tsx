"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CodeWindow } from "@/components/dash/code-window";
import { Mono } from "@/components/dash/mono";
import { PageHeader } from "@/components/dash/page-header";
import { ScopePicker } from "@/components/dash/scope-picker";
import { Tile, TileHeader } from "@/components/dash/tile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { type Network, useNetwork } from "@/lib/network";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ApiKeyRow = {
  id: string;
  name: string;
  network: Network;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type IssuedKey = {
  plaintext: string;
  key: ApiKeyRow;
};

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api.get<{ keys: ApiKeyRow[] }>("/v1/users/me/api-keys"),
  });

  const [tab, setTab] = useState<"active" | "revoked">("active");
  const rows = keys.data?.keys ?? [];
  const active = rows.filter((k) => !k.revokedAt);
  const revoked = rows.filter((k) => k.revokedAt);
  const visible = tab === "active" ? active : revoked;

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Console · Credentials"
        title={
          <>
            API keys. <span className="text-primary">Mint, name, revoke.</span>
          </>
        }
        description="Bearer tokens for SDK callers. Plaintext is shown exactly once. After that, only the hash lives in our database."
        right={
          <CreateKeyDialog
            onCreated={() => qc.invalidateQueries({ queryKey: ["api-keys"] })}
          />
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
      >
        <Tile>
          <TileHeader
            kicker="Ledger"
            title="Issued keys"
            right={
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as "active" | "revoked")}
              >
                <TabsList>
                  <TabsTrigger value="active">
                    Active
                    <Badge variant="secondary" className="ml-1.5 h-5 px-1.5">
                      {active.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="revoked">
                    Revoked
                    <Badge variant="outline" className="ml-1.5 h-5 px-1.5">
                      {revoked.length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />
          <div className="px-2 pb-2">
            {keys.isPending ? (
              <KeyTableSkeleton />
            ) : visible.length === 0 ? (
              <EmptyState revoked={tab === "revoked"} />
            ) : (
              <KeyTable rows={visible} revokedView={tab === "revoked"} />
            )}
          </div>
        </Tile>
      </motion.div>
    </div>
  );
}

function KeyTable({
  rows,
  revokedView,
}: {
  rows: ApiKeyRow[];
  revokedView: boolean;
}) {
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: async (id: string) =>
      api.delete<{ revoked: true }>(`/v1/users/me/api-keys/${id}`),
    onSuccess: (_d, id) => {
      toast.success("Key revoked", {
        description: `${rows.find((r) => r.id === id)?.prefix ?? ""}… will stop working immediately.`,
      });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err) => toastError("Couldn't revoke key", err),
  });

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="t-kicker pl-6">Name</TableHead>
          <TableHead className="t-kicker">Network</TableHead>
          <TableHead className="t-kicker">Prefix</TableHead>
          <TableHead className="t-kicker">Scopes</TableHead>
          <TableHead className="t-kicker">Last used</TableHead>
          <TableHead className="t-kicker">Created</TableHead>
          <TableHead className="t-kicker">
            {revokedView ? "Revoked" : ""}
          </TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className={revokedView ? "opacity-60" : ""}>
            <TableCell className="pl-6 font-medium">{row.name}</TableCell>
            <TableCell>
              <NetworkChip network={row.network} />
            </TableCell>
            <TableCell>
              <Mono>{row.prefix}…</Mono>
            </TableCell>
            <TableCell>
              {row.scopes.length === 0 ? (
                <span className="t-mono text-[11px] text-muted-foreground">
                  full access
                </span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {row.scopes.map((s) => (
                    <span
                      key={s}
                      className="t-mono inline-flex rounded-full border bg-card/60 px-2 py-0.5 text-[10.5px] text-foreground/80"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </TableCell>
            <TableCell className="t-mono text-[11.5px] text-muted-foreground">
              {row.lastUsedAt ? relativeDate(row.lastUsedAt) : "never"}
            </TableCell>
            <TableCell className="t-mono text-[11.5px] text-muted-foreground">
              {relativeDate(row.createdAt)}
            </TableCell>
            {revokedView ? (
              <TableCell className="t-mono text-[11.5px] text-muted-foreground">
                {row.revokedAt ? relativeDate(row.revokedAt) : ""}
              </TableCell>
            ) : (
              <TableCell />
            )}
            {!revokedView ? (
              <TableCell className="text-right">
                <RowActions row={row} onRevoke={() => revoke.mutate(row.id)} />
              </TableCell>
            ) : (
              <TableCell />
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RowActions({
  row,
  onRevoke,
}: {
  row: ApiKeyRow;
  onRevoke: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Open actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirming(true);
            }}
          >
            <Trash2 className="size-4" /> Revoke
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke "{row.name}"?</DialogTitle>
            <DialogDescription>
              Any process still using <Mono>{row.prefix}…</Mono> will start
              getting 401s immediately. This is not reversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                onRevoke();
                setConfirming(false);
              }}
            >
              <Trash2 /> Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateKeyDialog({ onCreated }: { onCreated: () => void }) {
  const activeNetwork = useNetwork();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [network, setKeyNetwork] = useState<Network>(activeNetwork);
  const [mode, setMode] = useState<"full" | "custom">("full");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issued, setIssued] = useState<IssuedKey | null>(null);

  const create = useMutation({
    mutationFn: async (input: {
      name: string;
      network: Network;
      scopes: string[];
    }) => api.post<IssuedKey>("/v1/users/me/api-keys", input),
    onSuccess: (data) => {
      setIssued(data);
      onCreated();
    },
    onError: (err) => toastError("Couldn't create key", err),
  });

  function reset() {
    setName("");
    setKeyNetwork(activeNetwork);
    setMode("full");
    setSelected(new Set());
    setIssued(null);
    create.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className="h-11 rounded-full">
          <Plus /> New API key
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] flex-col p-0 sm:max-w-lg"
        onInteractOutside={(e) => {
          if (issued) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (issued) e.preventDefault();
        }}
      >
        {issued ? (
          <IssuedKeyView issued={issued} onClose={() => setOpen(false)} />
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const scopesOut =
                mode === "full" ? [] : Array.from(selected).sort();
              create.mutate({
                name: name.trim(),
                network,
                scopes: scopesOut,
              });
            }}
          >
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Issue a new key</DialogTitle>
              <DialogDescription>
                Pick a name, a network, and what this key can do. Plaintext is
                shown exactly once.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
              <div className="space-y-2">
                <Label htmlFor="key-name" className="t-kicker">
                  Name
                </Label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="local laptop"
                  maxLength={64}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label className="t-kicker">Network</Label>
                <NetworkPickerInline value={network} onChange={setKeyNetwork} />
                <p className="t-mono text-[10.5px] leading-relaxed text-muted-foreground">
                  {network === "mainnet"
                    ? "This key gets the mpckit_live_ prefix and can only call mainnet."
                    : "This key gets the mpckit_test_ prefix and can only call testnet."}
                </p>
              </div>
              <div className="space-y-3">
                <Label className="t-kicker">Access</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as "full" | "custom")}
                  className="gap-2"
                >
                  <AccessRadio
                    id="mode-full"
                    value="full"
                    title="Full access"
                    desc="Can call every endpoint your account is allowed to."
                  />
                  <AccessRadio
                    id="mode-custom"
                    value="custom"
                    title="Custom scopes"
                    desc="Pick exactly which capabilities to grant."
                  />
                </RadioGroup>
              </div>
              {mode === "custom" ? (
                <div className="space-y-2">
                  <Label className="t-kicker">Capabilities</Label>
                  <ScopePicker value={selected} onChange={setSelected} />
                </div>
              ) : null}
              {create.error ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Couldn't create</AlertTitle>
                  <AlertDescription>
                    {create.error instanceof ApiError
                      ? create.error.message
                      : "Unknown error"}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
            <DialogFooter className="border-t bg-background/60 px-6 py-4 backdrop-blur">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  !name.trim() ||
                  create.isPending ||
                  (mode === "custom" && selected.size === 0)
                }
              >
                {create.isPending ? "Issuing…" : "Issue key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NetworkChip({ network }: { network: Network }) {
  const isMain = network === "mainnet";
  return (
    <span
      className={cn(
        "t-mono inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.14em]",
        isMain
          ? "border-signal-warn/30 bg-signal-warn/10 text-signal-warn"
          : "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isMain ? "bg-signal-warn" : "bg-primary",
        )}
      />
      {isMain ? "Mainnet" : "Testnet"}
    </span>
  );
}

function NetworkPickerInline({
  value,
  onChange,
}: {
  value: Network;
  onChange: (n: Network) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-md border bg-background/50 p-0.5">
      {(["testnet", "mainnet"] as const).map((target) => {
        const active = value === target;
        const isMain = target === "mainnet";
        return (
          <button
            type="button"
            key={target}
            onClick={() => onChange(target)}
            className={cn(
              "t-mono inline-flex items-center justify-center gap-1.5 rounded-[5px] px-2 py-1.5 text-[11px] uppercase tracking-[0.14em] transition-colors",
              active
                ? isMain
                  ? "bg-signal-warn/15 text-signal-warn"
                  : "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                active
                  ? isMain
                    ? "bg-signal-warn"
                    : "bg-signal-live"
                  : "bg-muted-foreground/40",
              )}
            />
            {target === "testnet" ? "Testnet" : "Mainnet"}
          </button>
        );
      })}
    </div>
  );
}

function AccessRadio({
  id,
  value,
  title,
  desc,
}: {
  id: string;
  value: string;
  title: string;
  desc: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card/40 p-3 transition-colors hover:bg-card/60 has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-primary/5"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </label>
  );
}

function IssuedKeyView({
  issued,
  onClose,
}: {
  issued: IssuedKey;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(issued.plaintext);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="px-6 pt-6">
        <DialogTitle>Save this key now</DialogTitle>
        <DialogDescription>
          We only stored the hash. If you close this without copying, you have
          to revoke and reissue.
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <CodeWindow filename={`${issued.key.name}.key`} status="ONCE">
          <div className="px-4 py-4">
            <div className="t-kicker mb-2">Plaintext</div>
            <code className="t-mono block break-all text-[12.5px] text-foreground">
              {issued.plaintext}
            </code>
            <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>
                {issued.key.scopes.length > 0
                  ? `${issued.key.scopes.length} scope${issued.key.scopes.length === 1 ? "" : "s"}`
                  : "full access"}
              </span>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? (
                  <>
                    <Check /> Copied
                  </>
                ) : (
                  <>
                    <Copy /> Copy plaintext
                  </>
                )}
              </Button>
            </div>
          </div>
        </CodeWindow>
      </div>
      <DialogFooter className="border-t bg-background/60 px-6 py-4 backdrop-blur">
        <Button onClick={onClose} className="rounded-full">
          I've saved it
        </Button>
      </DialogFooter>
    </div>
  );
}

function EmptyState({ revoked }: { revoked: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <div className="grid size-12 place-items-center rounded-2xl border bg-card/50">
        <KeyRound className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <div className="text-base font-medium">
          {revoked ? "No revoked keys" : "No keys yet"}
        </div>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">
          {revoked
            ? "Revoked keys stay here for audit."
            : "Issue a key to authenticate SDK requests."}
        </p>
      </div>
    </div>
  );
}

function KeyTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6">Name</TableHead>
          <TableHead>Network</TableHead>
          <TableHead>Prefix</TableHead>
          <TableHead>Scopes</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <TableRow key={i}>
            <TableCell className="pl-6">
              <Skeleton className="h-4 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-20 rounded-full" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-20" />
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
