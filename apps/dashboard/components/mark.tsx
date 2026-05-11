/**
 * MpcKit brand mark. A moon with its top-left bitten out (~25% gone),
 * and a smaller moon inside the gap whose bite faces the opposite
 * direction (bottom-right). The two crescents read as parties combining
 * into one signature: the MPC ceremony, geometrically.
 */
type Props = {
  size?: number;
  className?: string;
};

export function Mark({ size = 24, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="MpcKit"
      role="img"
    >
      <defs>
        <mask id="mpckit-mark-moon">
          <rect width="100" height="100" fill="white" />
          <circle cx="27" cy="27" r="25" fill="black" />
        </mask>
        <mask id="mpckit-mark-small">
          <rect width="100" height="100" fill="white" />
          <circle cx="36" cy="36" r="5" fill="black" />
        </mask>
      </defs>
      <circle
        cx="50"
        cy="50"
        r="35"
        fill="currentColor"
        mask="url(#mpckit-mark-moon)"
      />
      <circle
        cx="31"
        cy="31"
        r="7"
        fill="currentColor"
        mask="url(#mpckit-mark-small)"
      />
    </svg>
  );
}
