/**
 * The Conduit brand mark: a mint arc + node ("C"). This is the real product
 * mark — keep the geometry exact.
 */
export default function BrandMark({
  size = 30,
  className,
  glow = false,
  title,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={glow ? { filter: "drop-shadow(0 0 14px rgba(43,227,168,0.55))" } : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M736.4,315.3 A300,300 0 1 0 736.4,684.7"
        stroke="#2be3a8"
        strokeWidth="86"
        strokeLinecap="round"
      />
      <circle cx="800" cy="500" r="44" fill="#2be3a8" />
    </svg>
  );
}
