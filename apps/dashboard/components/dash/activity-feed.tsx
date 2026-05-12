"use client";

import {
  AlertTriangle,
  Circle,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Mono } from "@/components/dash/mono";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type AuditEvent = {
  id: string;
  event: string;
  apiKeyId: string | null;
  metadata: unknown;
  createdAt: string;
};

type Tone = "primary" | "warn" | "danger" | "live" | "neutral";

const EVENT_META: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    tone: Tone;
  }
> = {
  "key.issued": {
    icon: KeyRound,
    label: "Issued API key",
    tone: "primary",
  },
  "key.revoked": {
    icon: Trash2,
    label: "Revoked API key",
    tone: "danger",
  },
  "user.created": {
    icon: UserPlus,
    label: "Account created",
    tone: "live",
  },
  "auth.ok": {
    icon: LogIn,
    label: "Signed in",
    tone: "live",
  },
  "auth.fail": {
    icon: AlertTriangle,
    label: "Failed sign-in",
    tone: "warn",
  },
  "auth.signout": {
    icon: LogOut,
    label: "Signed out",
    tone: "neutral",
  },
  "session.revoked": {
    icon: ShieldCheck,
    label: "Session revoked",
    tone: "warn",
  },
};

const TONE_BG: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  live: "bg-signal-live/10 text-signal-live",
  warn: "bg-signal-warn/10 text-signal-warn",
  danger: "bg-signal-danger/10 text-signal-danger",
  neutral: "bg-card/60 text-muted-foreground",
};

export function ActivityFeed({
  events,
  loading,
  limit,
  emptyHint = "Nothing here yet. Activity lands as you use the API.",
}: {
  events: AuditEvent[];
  loading: boolean;
  limit?: number;
  emptyHint?: string;
}) {
  if (loading) {
    return <SkeletonList rows={4} />;
  }
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="grid size-10 place-items-center rounded-full border bg-card/40">
          <Circle className="size-4 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium">No activity yet</div>
        <div className="max-w-xs text-xs text-muted-foreground">
          {emptyHint}
        </div>
      </div>
    );
  }
  const rows = limit ? events.slice(0, limit) : events;
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((e) => (
        <li key={e.id} className="flex items-start gap-3 py-3">
          <EventIcon eventKey={e.event} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13.5px] font-medium leading-tight">
                {labelFor(e)}
              </span>
              <Mono className="text-[10px]">{e.event}</Mono>
            </div>
            <div className="t-mono mt-1 text-[10.5px] text-muted-foreground">
              {fullDate(e.createdAt)} · {relativeDate(e.createdAt)}
              {metadataSummary(e) ? ` · ${metadataSummary(e)}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EventIcon({ eventKey }: { eventKey: string }) {
  const meta = EVENT_META[eventKey] ?? {
    icon: Circle,
    label: eventKey,
    tone: "neutral" as const,
  };
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border",
        TONE_BG[meta.tone],
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function labelFor(e: AuditEvent): string {
  const meta = EVENT_META[e.event];
  const base = meta?.label ?? e.event;
  if (e.event === "key.issued" || e.event === "user.created") {
    const md = (e.metadata ?? {}) as { name?: string };
    if (md.name) return `${base} · ${md.name}`;
  }
  return base;
}

function metadataSummary(e: AuditEvent): string {
  const md = (e.metadata ?? {}) as Record<string, unknown>;
  if (e.event === "key.issued" && Array.isArray(md.scopes)) {
    const scopes = md.scopes as string[];
    if (scopes.length === 0) return "full access";
    if (scopes.length === 1) return scopes[0] ?? "";
    return `${scopes.length} scopes`;
  }
  return "";
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <ul className="divide-y divide-border/60">
      {Array.from({ length: rows }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
        <li key={i} className="flex items-start gap-3 py-3">
          <Skeleton className="size-8 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
