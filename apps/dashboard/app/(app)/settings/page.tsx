"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Fingerprint,
  LogOut,
  MonitorSmartphone,
  Pencil,
  Trash2,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActivityFeed, type AuditEvent } from "@/components/dash/activity-feed";
import { Mono } from "@/components/dash/mono";
import { PageHeader } from "@/components/dash/page-header";
import { StatusPill } from "@/components/dash/status-pill";
import { Tile, TileBody, TileHeader } from "@/components/dash/tile";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { authClient, useSession } from "@/lib/auth-client";
import { relativeDate } from "@/lib/format";
import { identityDisplay } from "@/lib/identity";
import { queryKeys } from "@/lib/query-keys";
import { toastError } from "@/lib/toast";

type PasskeyRow = {
  id: string;
  name: string | null;
  deviceType: string | null;
  createdAt: string;
  transports: string | null;
};

type SessionRow = {
  id: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Console · Settings"
        title={
          <>
            Account. <span className="text-primary">Security. Devices.</span>
          </>
        }
        description="Edit your profile, manage passkeys and active sessions, and sign out from every device."
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.18, ease: "easeOut" }}
      >
        <ProfileCard />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.24, ease: "easeOut" }}
      >
        <PasskeysCard />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.3, ease: "easeOut" }}
      >
        <SessionsCard />
      </motion.div>

      <motion.div
        id="activity"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.36, ease: "easeOut" }}
      >
        <ActivityCard />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.42, ease: "easeOut" }}
      >
        <DangerZone />
      </motion.div>
    </div>
  );
}

function ProfileCard() {
  const { data: session, refetch } = useSession();
  const user = session?.user;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (user && !editing) setName(user.name ?? "");
  }, [user, editing]);

  const save = useMutation({
    mutationFn: async (newName: string) => {
      const res = await authClient.updateUser({ name: newName });
      if (res?.error) throw new Error(res.error.message ?? "update failed");
      return res;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      setEditing(false);
      refetch();
    },
    onError: (err) => toastError("Couldn't update profile", err),
  });

  if (!user) {
    return (
      <Tile>
        <TileBody>
          <Skeleton className="h-12 w-1/3" />
        </TileBody>
      </Tile>
    );
  }

  const ident = identityDisplay({ name: user.name, email: user.email });
  const isSiws = ident.kind === "siws";

  return (
    <Tile>
      <TileHeader
        kicker="Identity"
        title="Profile"
        description="How you appear in MPCKit."
      />
      <TileBody className="pt-7">
        <div className="flex items-center gap-5">
          <Avatar className="size-16 ring-2 ring-primary/20 ring-offset-2 ring-offset-background">
            <AvatarFallback className="bg-primary/15 text-primary">
              {isSiws ? (
                <Wallet className="size-6" />
              ) : (
                <span className="text-lg">{ident.initials || "?"}</span>
              )}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span
                className={
                  isSiws ? "t-mono text-lg font-medium" : "text-lg font-medium"
                }
              >
                {isSiws ? ident.primary : user.name || "Unnamed operator"}
              </span>
              {/* biome-ignore lint/suspicious/noExplicitAny: better-auth user shape */}
              {(user as any).isAdmin ? (
                <Badge
                  variant="default"
                  className="text-[10px] uppercase tracking-wider"
                >
                  Admin
                </Badge>
              ) : null}
            </div>
            <Mono>{ident.secondary}</Mono>
          </div>
        </div>

        {editing && !isSiws ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || name === user.name) {
                setEditing(false);
                return;
              }
              save.mutate(name.trim());
            }}
            className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="profile-name" className="t-kicker">
                Display name
              </Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setName(user.name ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : isSiws ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            className="mt-6 rounded-full"
          >
            <Pencil /> Edit name
          </Button>
        )}
      </TileBody>
    </Tile>
  );
}

function PasskeysCard() {
  const qc = useQueryClient();
  const passkeys = useQuery({
    queryKey: queryKeys.passkeys.all,
    queryFn: async () => {
      const res = await fetch("/api/auth/passkey/list-user-passkeys", {
        credentials: "include",
      });
      if (!res.ok) return [] as PasskeyRow[];
      return (await res.json()) as PasskeyRow[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const res = await authClient.passkey.addPasskey();
      if (res?.error) throw new Error(res.error.message ?? "couldn't add");
      return res;
    },
    onSuccess: () => {
      toast.success("Passkey added");
      qc.invalidateQueries({ queryKey: queryKeys.passkeys.all });
    },
    onError: (err) => toastError("Couldn't add passkey", err),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await authClient.passkey.deletePasskey({ id });
      if (res?.error) throw new Error(res.error.message ?? "couldn't remove");
      return res;
    },
    onSuccess: () => {
      toast.success("Passkey removed");
      qc.invalidateQueries({ queryKey: queryKeys.passkeys.all });
    },
    onError: (err) => toastError("Couldn't remove passkey", err),
  });

  const rows = passkeys.data ?? [];

  return (
    <Tile>
      <TileHeader
        kicker="Auth · Passkeys"
        title="Device-bound credentials"
        description="Sign in without a wallet popup using a passkey on each device you use."
        right={
          <Button
            size="sm"
            onClick={() => add.mutate()}
            disabled={add.isPending}
            className="rounded-full"
          >
            <Fingerprint /> {add.isPending ? "Awaiting…" : "Add passkey"}
          </Button>
        }
      />
      <div className="px-6 pb-2 md:px-8">
        {passkeys.isPending ? (
          <SkeletonList rows={2} />
        ) : rows.length === 0 ? (
          <EmptyRow
            icon={Fingerprint}
            label="No passkeys yet"
            hint="Add one to skip the wallet popup on this device."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl border bg-card/40">
                    <Fingerprint className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {p.name || p.deviceType || "Passkey"}
                    </div>
                    <div className="t-mono mt-0.5 text-[11px] text-muted-foreground">
                      {p.transports
                        ? p.transports.split(",").join(" · ")
                        : "credential"}{" "}
                      · added {relativeDate(p.createdAt)}
                    </div>
                  </div>
                </div>
                <ConfirmDelete
                  title={`Remove "${p.name ?? "passkey"}"?`}
                  description="You'll need another sign-in method on this device."
                  onConfirm={() => remove.mutate(p.id)}
                  pending={remove.isPending && remove.variables === p.id}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Tile>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const { data: current, refetch: refetchSession } = useSession();
  const currentToken =
    (current as { session?: { token?: string } } | undefined)?.session?.token ??
    null;

  const sessions = useQuery({
    queryKey: queryKeys.sessions.all,
    queryFn: async () => {
      const res = await fetch("/api/auth/list-sessions", {
        credentials: "include",
      });
      if (!res.ok) return [] as SessionRow[];
      return (await res.json()) as SessionRow[];
    },
  });

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch("/api/auth/revoke-session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error("couldn't revoke");
      return res.json();
    },
    onSuccess: async (_data, token) => {
      const isMine = currentToken === token;
      qc.invalidateQueries({ queryKey: queryKeys.sessions.all });
      if (isMine) {
        toast.success("Signed out", {
          description: "You revoked the session you were using.",
        });
        window.location.href = "/sign-in";
        return;
      }
      toast.success("Session revoked");
      await refetchSession();
    },
    onError: () =>
      toastError(
        "Couldn't revoke session",
        undefined,
        "Try again or sign out everywhere.",
      ),
  });

  const rows = sessions.data ?? [];

  return (
    <Tile>
      <TileHeader
        kicker="Devices · Active sessions"
        title="Where you're signed in"
        description="Revoke any session you don't recognise. Revoking the device you're on signs you out immediately."
      />
      <div className="px-6 pb-2 md:px-8">
        {sessions.isPending ? (
          <SkeletonList rows={2} />
        ) : rows.length === 0 ? (
          <EmptyRow
            icon={MonitorSmartphone}
            label="No active sessions"
            hint="Your current session will appear here once it propagates."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((s) => {
              const isCurrent =
                currentToken !== null && s.token === currentToken;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl border bg-card/40">
                      <MonitorSmartphone className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate text-sm font-medium">
                        {summariseUA(s.userAgent)}
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 t-mono text-[9px] uppercase tracking-[0.14em] text-primary">
                            <span className="size-1 rounded-full bg-primary" />
                            This device
                          </span>
                        ) : null}
                      </div>
                      <div className="t-mono mt-0.5 text-[11px] text-muted-foreground">
                        {s.ipAddress ?? "unknown ip"} · last seen{" "}
                        {relativeDate(s.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <ConfirmDelete
                    title={
                      isCurrent ? "Sign out this device?" : "Revoke session?"
                    }
                    description={
                      isCurrent
                        ? "You'll be redirected to the sign-in page right after."
                        : "That device will be signed out immediately."
                    }
                    cta={isCurrent ? "Sign out" : "Revoke"}
                    onConfirm={() => revoke.mutate(s.token)}
                    pending={revoke.isPending && revoke.variables === s.token}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Tile>
  );
}

function ActivityCard() {
  const audit = useQuery({
    queryKey: queryKeys.audit(100),
    queryFn: () =>
      api.get<{ events: AuditEvent[] }>("/v1/users/me/audit?limit=100"),
  });
  return (
    <Tile>
      <TileHeader
        kicker="Audit · Last 100 events"
        title="Activity log"
        description="Append-only. Every key issuance, revocation, sign-in, and session change attributed to your account."
      />
      <TileBody className="pt-4">
        <div className="max-h-[480px] overflow-y-auto">
          <ActivityFeed
            loading={audit.isPending}
            events={audit.data?.events ?? []}
            emptyHint="Sign in a few times, issue a key, and events will appear here."
          />
        </div>
      </TileBody>
    </Tile>
  );
}

function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const all = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/revoke-sessions", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("revoke-all failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Signed out everywhere");
      window.location.href = "/sign-in";
    },
    onError: () =>
      toastError("Couldn't sign out", undefined, "Try again in a moment."),
  });

  return (
    <Tile glow="danger">
      <TileHeader
        kicker="Danger zone"
        title={<span className="text-destructive">Sign out everywhere</span>}
        description="Kill every active session, including this one. You'll be redirected to the sign-in page."
        right={<StatusPill tone="danger">Irreversible</StatusPill>}
      />
      <TileBody className="pt-7">
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle />
          <AlertDescription>
            This kills every active session, including this one. You'll need to
            sign in again on each device.
          </AlertDescription>
        </Alert>
        <Button
          variant="destructive"
          onClick={() => setConfirming(true)}
          disabled={all.isPending}
          className="rounded-full"
        >
          <LogOut /> Sign out everywhere
        </Button>
      </TileBody>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign out from every device?</DialogTitle>
            <DialogDescription>
              Including this one. You'll be redirected to the sign-in page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                all.mutate();
              }}
            >
              Sign me out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tile>
  );
}

function ConfirmDelete({
  title,
  description,
  cta = "Remove",
  onConfirm,
  pending,
}: {
  title: string;
  description: string;
  cta?: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        aria-label="Delete"
      >
        <Trash2 />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              {cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptyRow({
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

function SkeletonList({ rows }: { rows: number }) {
  return (
    <ul className="divide-y divide-border/60">
      {Array.from({ length: rows }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
        <li key={i} className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="size-8 rounded-md" />
        </li>
      ))}
    </ul>
  );
}

function summariseUA(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS device";
  if (/Android/.test(ua)) return "Android device";
  if (/Mac OS X/.test(ua)) {
    if (/Chrome/.test(ua)) return "Mac · Chrome";
    if (/Safari/.test(ua)) return "Mac · Safari";
    if (/Firefox/.test(ua)) return "Mac · Firefox";
    return "Mac";
  }
  if (/Windows/.test(ua)) {
    if (/Edg/.test(ua)) return "Windows · Edge";
    if (/Chrome/.test(ua)) return "Windows · Chrome";
    if (/Firefox/.test(ua)) return "Windows · Firefox";
    return "Windows";
  }
  if (/Linux/.test(ua)) return "Linux";
  return ua.slice(0, 40);
}
