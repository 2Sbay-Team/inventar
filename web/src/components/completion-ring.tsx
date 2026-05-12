// v0.9 Phase 5 — Circular progress ring rendered on the Shop
// Identity section header. Apple Watch-style: a thin "track" arc
// underneath, a thicker brand-coloured progress arc on top, the
// percentage rendered as text in the middle.
//
// The stroke uses `currentColor` so the ring picks up the merchant's
// brand colour through Tailwind's `text-accent` class — when the
// merchant changes brand_primary_color, the ring re-paints in the
// new colour without any prop drilling.

export interface CompletionRingProps {
  percentage: number; // 0-100
  size?: number; // px; default 56
  strokeWidth?: number; // px; default 5
  testId?: string;
}

export function CompletionRing({
  percentage,
  size = 56,
  strokeWidth = 5,
  testId = 'completion-ring',
}: CompletionRingProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      data-testid={testId}
      role="img"
      aria-label={`${clamped}%`}
      className="text-accent"
    >
      {/* Track — same brand colour at 12% alpha. Same ratio applyTheme
          uses for the bg of pill / chip indicators, so the ring's
          empty portion reads as the same family of grey-when-orange,
          blue-tinted-grey-when-navy, etc. */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={strokeWidth}
      />
      {/* Progress. Rotated -90° so the arc starts at 12 o'clock
          (the universally-understood "0%" position). strokeDasharray
          + strokeDashoffset is the standard SVG trick for partial
          rings — dasharray = circumference, dashoffset = the unfilled
          portion. */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.round(size * 0.28)}
        fontWeight={600}
        className="fill-ink font-display"
        data-testid={`${testId}-percent`}
      >
        {clamped}%
      </text>
    </svg>
  );
}
