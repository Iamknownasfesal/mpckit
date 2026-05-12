import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Kicker({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("t-kicker", className)} {...rest}>
      {children}
    </span>
  );
}
