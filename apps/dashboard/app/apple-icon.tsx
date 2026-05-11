import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0c1a1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 36,
      }}
    >
      <svg
        width={130}
        height={130}
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 4 26 L 4 6 L 11 18 L 18 6 L 18 26" stroke="#f8fafc" />
        <path d="M 18 16 L 28 6" stroke="#2dd4d2" />
        <path d="M 18 16 L 28 26" stroke="#2dd4d2" />
      </svg>
    </div>,
    size,
  );
}
