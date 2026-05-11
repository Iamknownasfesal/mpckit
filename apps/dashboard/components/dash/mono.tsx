"use client";

import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function Mono({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <code
      className={cn(
        "t-mono inline-flex items-center rounded-md border bg-background px-1.5 py-0.5 text-[11.5px] text-foreground/90",
        className,
      )}
    >
      {children}
    </code>
  );
}

export function CopyMono({
  value,
  display,
  className,
}: {
  value: string;
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "t-mono group inline-flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5 text-[11.5px] text-foreground/90 transition-colors hover:border-primary/50 hover:text-primary",
        className,
      )}
    >
      <span>{display ?? value}</span>
      {copied ? (
        <Check className="size-3 text-signal-live" />
      ) : (
        <Copy className="size-3 opacity-50 group-hover:opacity-100" />
      )}
    </button>
  );
}
