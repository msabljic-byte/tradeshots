import { Seal } from "@/components/brand/Seal";

export function Logo({
  label = "Shirumi",
  variant = "horizontal",
  sealSize = "md",
  className = "",
}: {
  label?: string;
  variant?: "horizontal" | "stacked" | "wordmark-only";
  sealSize?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  if (variant === "wordmark-only") {
    return (
      <span
        className={`leading-none ${className}`.trim()}
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "20px",
          fontWeight: 400,
          letterSpacing: "-0.01em",
          color: "var(--text-primary)",
        }}
      >
        {label}
      </span>
    );
  }

  const stacked = variant === "stacked";
  return (
    <span
      className={`inline-flex ${stacked ? "flex-col items-center gap-3" : "items-center gap-[14px]"} ${className}`.trim()}
    >
      <Seal size={sealSize} />
      <span
        className="leading-none"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 400,
          letterSpacing: "-0.01em",
          fontSize: stacked ? "28px" : "20px",
          color: "var(--text-primary)",
        }}
      >
        {label}
      </span>
    </span>
  );
}
