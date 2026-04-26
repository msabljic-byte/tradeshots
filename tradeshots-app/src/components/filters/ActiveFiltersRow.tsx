import { X } from "lucide-react";

type ActiveFilterChip = {
  id: string;
  label: string;
  onRemove: () => void;
};

type ActiveFiltersRowProps = {
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  onSaveView: () => void;
};

export function ActiveFiltersRow({ chips, onClearAll, onSaveView }: ActiveFiltersRowProps) {
  if (chips.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
        Active
      </span>
      {chips.map((chip) => (
        <div
          key={chip.id}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--accent-tint)] py-0.5 pl-2.5 pr-1"
        >
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--accent)]">
            {chip.label}
          </span>
          <button
            onClick={chip.onRemove}
            aria-label={`Remove filter: ${chip.label}`}
            className="inline-flex h-4 w-4 items-center justify-center rounded-[2px] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-on)]"
          >
            <X className="h-2.5 w-2.5" strokeWidth={2} />
          </button>
        </div>
      ))}
      {chips.length > 0 && (
        <button
          onClick={onSaveView}
          className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          Save view
        </button>
      )}
      {chips.length > 1 && (
        <button
          onClick={onClearAll}
          className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
