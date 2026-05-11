"use client";

/**
 * Thin dynamic wrappers around @paper-design/shaders-react so each
 * shader is loaded on the client only (they require WebGL). Defaults
 * are tuned to mpckit's teal-on-dark palette so the homepage doesn't
 * have to repeat colors at every call site.
 */
import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

export const GrainBg = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.GrainGradient),
  { ssr: false, loading: () => <BgFallback /> },
);

export const DitherBg = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.Dithering),
  { ssr: false, loading: () => <BgFallback /> },
);

export const HalftoneBg = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.HalftoneDots),
  { ssr: false, loading: () => <BgFallback /> },
);

function BgFallback({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, var(--color-fd-primary) 22%, transparent), transparent 65%)",
        ...style,
      }}
    />
  );
}
