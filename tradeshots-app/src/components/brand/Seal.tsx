import type { CSSProperties } from "react";

type SealSize = "xs" | "sm" | "md" | "lg" | "xl";

const SEAL_PIXELS: Record<SealSize, number> = {
  xs: 18,
  sm: 24,
  md: 36,
  lg: 52,
  xl: 72,
};

export function Seal({
  size = "md",
  className = "",
}: {
  size?: SealSize;
  className?: string;
}) {
  const px = SEAL_PIXELS[size];
  const sealStyle: CSSProperties = {
    width: px,
    height: px,
    backgroundColor: "var(--accent)",
    color: "var(--accent-on)",
    borderRadius: "var(--radius-md)",
    boxShadow: "0 1px 0 var(--accent-pressed)",
  };

  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`.trim()}
      style={sealStyle}
    >
      <span className="seal-border" />
      <span className="seal-glyph">
        <svg
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: "58%", height: "58%", display: "block", overflow: "visible" }}
          aria-hidden="true"
        >
          <text
            x="50"
            y="50"
            dx="-2.5"
            dy="-1.5"
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fontFamily="'Fraunces', Georgia, serif"
            fontSize="78"
            fontWeight="500"
            fontStyle="italic"
            style={{
              fontVariationSettings: "'opsz' 144, 'WONK' 1",
              fontFeatureSettings: "'kern' 1",
            }}
          >
            S
          </text>
        </svg>
      </span>
    </span>
  );
}
