import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

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
