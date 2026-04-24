import { Seal } from "@/components/brand/Seal";

export function Logo({
  label = "TradeShots",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <Seal />
      <span className="text-h2 leading-none text-foreground">{label}</span>
    </span>
  );
}
