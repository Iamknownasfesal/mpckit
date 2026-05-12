import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type TileProps = HTMLAttributes<HTMLDivElement> & {
  glow?: "teal" | "amber" | "danger" | "none";
  dots?: boolean;
  inset?: boolean;
};

export function Tile({
  glow = "none",
  dots = false,
  inset = false,
  className,
  children,
  ...rest
}: TileProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border bg-card/40 backdrop-blur-md",
        inset && "bg-background/60",
        className,
      )}
      {...rest}
    >
      {glow !== "none" ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0",
            glow === "teal" && "tile-glow-teal",
            glow === "amber" && "tile-glow-amber",
            glow === "danger" && "tile-glow-danger",
          )}
        />
      ) : null}
      {dots ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 dot-ledger dot-ledger-fade"
        />
      ) : null}
      <div className="relative">{children}</div>
    </div>
  );
}

export function TileBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("p-6 md:p-8", className)}>{children}</div>;
}

export function TileHeader({
  kicker,
  title,
  description,
  right,
  className,
}: {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-6 pt-6 md:px-8 md:pt-7",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {kicker ? <div className="t-kicker">{kicker}</div> : null}
        <h2 className="text-xl font-semibold tracking-[-0.02em] md:text-2xl">
          {title}
        </h2>
        {description ? (
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
