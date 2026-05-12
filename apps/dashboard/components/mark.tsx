/**
 * MPCKit brand mark. A crescent moon — body circle plus a background-
 * colored "bite" circle that overlaps the upper-left. The bite circle
 * extends past the body's edge so the visible crescent has the
 * characteristic moon shape; the part of the bite circle outside the
 * body is the same color as the surrounding page, so it's invisible.
 *
 * Pass a `bg` override if rendering over a non-page-background surface
 * (e.g. a card, modal, or coloured chip).
 */
type Props = {
  size?: number;
  className?: string;
  bg?: string;
};

export function Mark({ size = 24, className, bg = "#020404" }: Props) {
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
      <circle cx="50" cy="50" r="35" fill="currentColor" />
      <circle cx="27" cy="27" r="25" fill={bg} />
    </svg>
  );
}
