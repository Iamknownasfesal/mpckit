import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const BG = "#0c1a1a";
const FG = "#f8fafc";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={28} height={28} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="35" fill={FG} />
        <circle cx="27" cy="27" r="25" fill={BG} />
        <circle cx="31" cy="31" r="7" fill={FG} />
        <circle cx="36" cy="36" r="5" fill={BG} />
      </svg>
    </div>,
    size,
  );
}
