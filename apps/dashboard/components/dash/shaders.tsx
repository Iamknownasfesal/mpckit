"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

export const GrainBg = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.GrainGradient),
  { ssr: false, loading: () => <BgFallback /> },
);

function BgFallback({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 65%)",
        ...style,
      }}
    />
  );
}
