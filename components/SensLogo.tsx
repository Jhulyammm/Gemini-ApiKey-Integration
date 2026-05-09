interface SensLogoProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

// White outline diamond (rotated rounded square) with an internal "L" stroke.
// Rendered against the brand dark-navy.
export function SensLogo({ size = 32, strokeWidth = 6, className }: SensLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect
        x="22"
        y="22"
        width="56"
        height="56"
        rx="9"
        transform="rotate(45 50 50)"
      />
      <path d="M 36 40 L 36 64 L 60 64" />
      <path d="M 50 64 L 50 50" />
    </svg>
  );
}
