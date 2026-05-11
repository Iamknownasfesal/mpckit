/**
 * MpcKit brand mark. An "M" flowing into a "K" through a shared
 * vertical stroke: two letters, one continuous backbone. The K's
 * diagonals are picked out in the brand teal so the monogram reads
 * as "MK" without spelling it out.
 */
type Props = {
  size?: number;
  className?: string;
};

export function Mark({ size = 28, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="MpcKit"
      role="img"
      fill="none"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M 4 26 L 4 6 L 11 18 L 18 6 L 18 26" stroke="currentColor" />
      <path d="M 18 16 L 28 6" stroke="#2dd4d2" />
      <path d="M 18 16 L 28 26" stroke="#2dd4d2" />
    </svg>
  );
}
