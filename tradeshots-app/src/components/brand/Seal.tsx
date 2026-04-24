import type { CSSProperties } from "react";

export function Seal({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const boxStyle: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: "var(--action-primary)",
    color: "var(--action-primary-foreground)",
  };

  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-[6px] shadow-sm ${className}`.trim()}
      style={boxStyle}
    >
      <span className="select-none text-sm font-semibold italic leading-none">S</span>
    </span>
  );
}
