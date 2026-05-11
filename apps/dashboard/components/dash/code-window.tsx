import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function CodeWindow({
  filename,
  status,
  className,
  children,
}: {
  filename?: string;
  status?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/80 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-md",
        className,
      )}
    >
      <div className="rounded-xl border bg-background">
        <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
          <span className="size-2 rounded-full bg-rose-400/80" />
          <span className="size-2 rounded-full bg-amber-400/80" />
          <span className="size-2 rounded-full bg-emerald-400/80" />
          {filename ? (
            <span className="t-mono ms-3 text-[11px] text-muted-foreground">
              {filename}
            </span>
          ) : null}
          {status ? (
            <span className="t-mono ms-auto text-[10.5px] text-muted-foreground">
              {status}
            </span>
          ) : null}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
