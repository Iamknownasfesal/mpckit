/**
 * MPCKit brand mark. A moon with its top-left bitten out (~25% gone),
 * and a smaller moon inside the gap whose bite faces the opposite
 * direction (bottom-right). The two crescents read as parties combining
 * into one signature: the MPC ceremony, geometrically.
 *
 * Implemented as two `fill-rule="evenodd"` paths so each crescent is a
 * single filled shape with a circular hole. No SVG masks, no clipPaths,
 * no background-matching tricks — renders identically across browsers
 * and at every size from favicon to hero.
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
      aria-label="MPCKit"
      role="img"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M50,50 m-35,0 a35,35 0 1,0 70,0 a35,35 0 1,0 -70,0 M27,27 m-25,0 a25,25 0 1,0 50,0 a25,25 0 1,0 -50,0"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M31,31 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0 M36,36 m-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0"
      />
    </svg>
  );
}
