import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "MpcKit Console: issue keys, top up billing, inspect dWallets.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#020404";
const BONE = "#f8fafc";
const SOFT = "rgba(248, 250, 252, 0.62)";
const TEAL = "#2dd4d2";

const SANS =
  '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function Crescent({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="35" fill={BONE} />
      <circle cx="27" cy="27" r="25" fill={BG} />
      <circle cx="31" cy="31" r="7" fill={BONE} />
      <circle cx="36" cy="36" r="5" fill={BG} />
    </svg>
  );
}

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BG,
        color: BONE,
        fontFamily: SANS,
        display: "flex",
        flexDirection: "column",
        padding: "72px 80px",
      }}
    >
      {/* HERO: wordmark + tagline on left, crescent on right */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            paddingRight: 32,
          }}
        >
          <div
            style={{
              fontSize: 52,
              fontWeight: 600,
              letterSpacing: "-0.04em",
              display: "flex",
            }}
          >
            MpcKit
          </div>
          <div
            style={{
              marginTop: 32,
              fontSize: 92,
              fontWeight: 700,
              letterSpacing: "-0.045em",
              lineHeight: 1.02,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ display: "flex" }}>Sign on every</span>
            <span style={{ display: "flex" }}>chain. One API.</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Crescent s={300} />
        </div>
      </div>

      {/* BOTTOM: status + url */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: TEAL,
              marginRight: 14,
              display: "flex",
            }}
          />
          <span style={{ fontSize: 22, color: SOFT, display: "flex" }}>
            Live on Sui testnet + mainnet
          </span>
        </div>
        <span
          style={{
            fontSize: 24,
            color: BONE,
            fontWeight: 500,
            display: "flex",
          }}
        >
          app.mpckit.xyz
        </span>
      </div>
    </div>,
    size,
  );
}
