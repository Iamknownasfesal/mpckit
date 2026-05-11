import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = `${SITE_NAME} — sign on every chain from one API.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BONE = "#f8fafc";
const MUTED = "rgba(248, 250, 252, 0.62)";
const TEAL = "#2dd4d2";
const HAIRLINE = "rgba(248, 250, 252, 0.10)";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: "#020404",
        color: BONE,
        fontFamily:
          '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        overflow: "hidden",
      }}
    >
      {/* Faint Mark watermark, bleeding off the bottom-right corner */}
      <svg
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          position: "absolute",
          bottom: -120,
          right: -120,
          width: 720,
          height: 720,
          opacity: 0.08,
        }}
      >
        <path d="M 4 26 L 4 6 L 11 18 L 18 6 L 18 26" stroke={BONE} />
        <path d="M 18 16 L 28 6" stroke={TEAL} />
        <path d="M 18 16 L 28 26" stroke={TEAL} />
      </svg>

      {/* Single subtle teal glow in the upper-left for depth */}
      <div
        style={{
          position: "absolute",
          top: -260,
          left: -200,
          width: 640,
          height: 640,
          borderRadius: 9999,
          background:
            "radial-gradient(circle at center, rgba(45, 212, 210, 0.10) 0%, transparent 70%)",
        }}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "80px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Centered hero block */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg
              viewBox="0 0 32 32"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                display: "block",
                width: 88,
                height: 88,
                marginRight: 28,
              }}
            >
              <path d="M 4 26 L 4 6 L 11 18 L 18 6 L 18 26" stroke={BONE} />
              <path d="M 18 16 L 28 6" stroke={TEAL} />
              <path d="M 18 16 L 28 26" stroke={TEAL} />
            </svg>
            <span
              style={{
                fontSize: 120,
                fontWeight: 600,
                letterSpacing: "-0.04em",
                lineHeight: 1,
              }}
            >
              {SITE_NAME}
            </span>
          </div>
          <div
            style={{
              marginTop: 36,
              fontSize: 30,
              color: MUTED,
              lineHeight: 1.4,
              display: "flex",
              maxWidth: 880,
            }}
          >
            {SITE_DESCRIPTION}
          </div>
        </div>

        {/* Bottom hairline + url */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 24,
            borderTop: `1px solid ${HAIRLINE}`,
          }}
        >
          <span
            style={{
              fontSize: 16,
              color: MUTED,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Hosted MPC · Live on Sui testnet + mainnet
          </span>
          <span
            style={{
              fontSize: 18,
              color: TEAL,
              letterSpacing: "0.1em",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            mpckit.xyz
          </span>
        </div>
      </div>
    </div>,
    size,
  );
}
