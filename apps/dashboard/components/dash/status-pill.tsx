import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Tone = "live" | "warn" | "danger" | "neutral" | "primary";

const TONE_DOT: Record<Tone, string> = {
  live: "bg-signal-live",
  warn: "bg-signal-warn",
  danger: "bg-signal-danger",
  neutral: "bg-muted-foreground/60",
  primary: "bg-primary",
};

export function StatusPill({
  tone = "neutral",
  pulse,
  children,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "t-mono inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground backdrop-blur-md",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          TONE_DOT[tone],
          pulse && "pulse-dot",
        )}
      />
      {children}
    </span>
  );
}
