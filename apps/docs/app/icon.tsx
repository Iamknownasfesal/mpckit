import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0c1a1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={26}
        height={26}
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        strokeWidth={2.8}
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
