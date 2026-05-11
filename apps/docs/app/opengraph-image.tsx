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
const BG = "#020404";

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
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          bottom: -120,
          right: -120,
          width: 720,
          height: 720,
          opacity: 0.08,
        }}
      >
        <circle cx="50" cy="50" r="35" fill={BONE} />
        <circle cx="27" cy="27" r="25" fill={BG} />
        <circle cx="31" cy="31" r="7" fill={BONE} />
        <circle cx="36" cy="36" r="5" fill={BG} />
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
              viewBox="0 0 100 100"
              xmlns="http://www.w3.org/2000/svg"
              style={{
                display: "block",
                width: 88,
                height: 88,
                marginRight: 28,
              }}
            >
              <circle cx="50" cy="50" r="35" fill={BONE} />
              <circle cx="27" cy="27" r="25" fill={BG} />
              <circle cx="31" cy="31" r="7" fill={BONE} />
              <circle cx="36" cy="36" r="5" fill={BG} />
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
