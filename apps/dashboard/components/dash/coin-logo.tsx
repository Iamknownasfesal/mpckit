import { cn } from "@/lib/utils";

export function CoinLogo({
  symbol,
  className,
}: {
  symbol: string;
  className?: string;
}) {
  switch (symbol.toUpperCase()) {
    case "SUI":
      return <SuiLogo className={className} />;
    case "USDC":
      return <UsdcLogo className={className} />;
    case "USDT":
      return <UsdtLogo className={className} />;
    case "IKA":
      return <IkaLogo className={className} />;
    default:
      return <FallbackLogo symbol={symbol} className={className} />;
  }
}

function SuiLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 783 1000"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Sui"
      fill="none"
      className={cn("size-full", className)}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M626.027 417.029C666.817 468.244 691.209 533.014 691.209 603.469C691.209 673.925 666.076 740.673 624.214 792.176L620.588 796.626L619.641 790.981C618.817 786.201 617.869 781.34 616.757 776.478C595.785 684.349 527.471 605.365 415.03 541.378C339.095 498.28 295.626 446.448 284.213 387.487C276.838 349.375 282.318 311.098 292.907 278.301C303.496 245.545 319.235 218.063 332.626 201.541L376.383 148.06C384.046 138.666 398.426 138.666 406.09 148.06L626.068 417.029H626.027ZM695.206 363.59L402.01 5.12968C396.407 -1.70989 385.942 -1.70989 380.338 5.12968L87.184 363.59L86.2363 364.784C32.3026 431.738 0 516.821 0 609.444C0 825.138 175.151 1000 391.174 1000C607.198 1000 782.349 825.138 782.349 609.444C782.349 516.821 750.046 431.738 696.112 364.826L695.165 363.631L695.206 363.59ZM157.351 415.876L183.556 383.779L184.339 389.712C184.957 394.409 185.74 399.106 186.646 403.844C203.622 492.883 264.23 567.088 365.546 624.565C453.637 674.708 504.934 732.35 519.684 795.554C525.864 821.924 526.936 847.881 524.258 870.584L524.093 871.985L522.816 872.603C483.055 892.009 438.351 902.927 391.133 902.927C225.459 902.927 91.1394 768.855 91.1394 603.428C91.1394 532.396 115.902 467.172 157.269 415.793L157.351 415.876Z"
        fill="#298DFF"
      />
    </svg>
  );
}

function UsdcLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="USDC"
      className={cn("size-full", className)}
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        d="M16 5.5a.6.6 0 0 1 .6.6v1.46c4.07.43 7.34 3.71 7.78 7.78a.6.6 0 0 1-.6.6h-1.34a.6.6 0 0 1-.59-.5c-.4-2.94-2.7-5.25-5.65-5.65a.6.6 0 0 1-.5-.59V8.16c-4.07.43-7.34 3.71-7.78 7.78a.6.6 0 0 1-.59.5H6a.6.6 0 0 1-.6-.6c.44-4.07 3.71-7.34 7.78-7.78V6.1a.6.6 0 0 1 .6-.6Zm0 21a.6.6 0 0 1-.6-.6v-1.46a8.55 8.55 0 0 1-7.78-7.78.6.6 0 0 1 .6-.6h1.34a.6.6 0 0 1 .59.5c.4 2.94 2.7 5.25 5.65 5.65a.6.6 0 0 1 .5.59v1.34a8.55 8.55 0 0 0 7.78-7.78.6.6 0 0 1 .59-.5H26a.6.6 0 0 1 .6.6 8.55 8.55 0 0 1-7.78 7.78v1.66a.6.6 0 0 1-.6.6Zm-1.16-5.42v-.96c-1.45-.13-2.51-.83-2.69-2.07h1.4c.13.6.66.93 1.32 1.04v-1.95l-.35-.08c-1.4-.32-2.18-1.04-2.18-2.21 0-1.32 1.02-2.16 2.53-2.3v-.96h1.16v.96c1.42.14 2.41.86 2.55 2.05h-1.4c-.11-.55-.59-.9-1.18-1.02v1.87l.39.09c1.5.34 2.27 1.04 2.27 2.27 0 1.36-1.03 2.21-2.66 2.35v.96h-1.16Zm-1.16-5.5c0 .5.36.83 1.16 1.04v-1.96c-.74.07-1.16.43-1.16.92Zm2.32 2.51v1.96c.84-.07 1.21-.46 1.21-.96 0-.55-.41-.83-1.21-1Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function UsdtLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="USDT"
      className={cn("size-full", className)}
    >
      <circle cx="16" cy="16" r="16" fill="#26A17B" />
      <path
        d="M17.66 14.5v-2.04h4.74V9.34H9.61v3.12h4.74v2.04C10.51 14.7 7.6 15.5 7.6 16.46s2.91 1.76 6.75 1.96v6.05h3.31v-6.05c3.84-.2 6.75-1 6.75-1.96s-2.91-1.76-6.75-1.96Zm0 3.36c-.13.01-.97.06-2.05.06-1.5 0-2.55-.05-2.66-.06-3.66-.17-6.39-.91-6.39-1.78s2.73-1.62 6.39-1.79V16c.13.01 1.17.07 2.61.07 1.18 0 2.04-.04 2.1-.06v-1.74c3.65.17 6.38.91 6.38 1.78s-2.73 1.62-6.38 1.81Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function IkaLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="IKA"
      fill="none"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-full", className)}
    >
      <circle cx="16" cy="16" r="16" fill="oklch(20% 0.05 195)" />
      <path d="M 9 24 L 9 8 L 14 16 L 19 8 L 19 24" stroke="#ffffff" />
      <path d="M 19 16 L 25 8" stroke="#2dd4d2" />
      <path d="M 19 16 L 25 24" stroke="#2dd4d2" />
    </svg>
  );
}

function FallbackLogo({
  symbol,
  className,
}: {
  symbol: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-full place-items-center rounded-full bg-muted text-[9px] font-semibold uppercase text-foreground",
        className,
      )}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}
