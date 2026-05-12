import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Metric({
  kicker,
  value,
  unit,
  right,
  className,
}: {
  kicker: string;
  value: ReactNode;
  unit?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5 p-7 md:p-8", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="t-kicker">{kicker}</span>
        {right}
      </div>
      <div className="t-mono text-[44px] font-medium leading-none tracking-tight text-foreground md:text-[52px]">
        {value}
      </div>
      {unit ? (
        <span className="t-mono text-[12px] text-muted-foreground">{unit}</span>
      ) : null}
    </div>
  );
}
