import type React from "react";
import { MessageSquare, Mic, Pencil, Plus, Search } from "lucide-react";
import type { QuickFilters } from "./types";

type FilterBarProps = {
  searchQuery: string;
  quickFilters: QuickFilters;
  hasActiveDashboardFilters: boolean;
  onSearchChange: (value: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onToggleQuickFilter: (key: keyof QuickFilters) => void;
  showFilterMenu: boolean;
  onToggleFilterMenu: () => void;
  filterMenuRef: React.RefObject<HTMLDivElement | null>;
  renderFilterMenuContent: () => React.ReactNode;
};

export function FilterBar({
  searchQuery,
  quickFilters,
  hasActiveDashboardFilters,
  onSearchChange,
  searchInputRef,
  onToggleQuickFilter,
  showFilterMenu,
  onToggleFilterMenu,
  filterMenuRef,
  renderFilterMenuContent,
}: FilterBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-[320px]">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search notes, tags, attributes..."
          className="ui-input h-8 w-full pl-9 pr-3 text-sm"
        />
      </div>

      <span
        aria-hidden="true"
        className="ml-auto"
        style={{
          display: "inline-block",
          width: "1px",
          height: "20px",
          backgroundColor: "var(--border-subtle)",
          margin: "0 calc(var(--space-4) - var(--space-2) / 2)",
          alignSelf: "center",
          flexShrink: 0,
        }}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          title="Has annotations"
          aria-label="Filter screenshots with annotations"
          aria-pressed={quickFilters.annotations}
          onClick={() => onToggleQuickFilter("annotations")}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border p-0 transition-[background-color,border-color] duration-150 ease-in-out focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] focus-visible:outline-offset-2 ${
            quickFilters.annotations
              ? "border-[color:var(--accent)] bg-[color:var(--accent-tint)] text-[color:var(--accent)]"
              : "border-[color:var(--border-subtle)] bg-transparent text-muted hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-shadow)]"
          }`}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        </button>

        <button
          type="button"
          title="Has notes"
          aria-label="Filter screenshots with notes"
          aria-pressed={quickFilters.notes}
          onClick={() => onToggleQuickFilter("notes")}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border p-0 transition-[background-color,border-color] duration-150 ease-in-out focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] focus-visible:outline-offset-2 ${
            quickFilters.notes
              ? "border-[color:var(--accent)] bg-[color:var(--accent-tint)] text-[color:var(--accent)]"
              : "border-[color:var(--border-subtle)] bg-transparent text-muted hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-shadow)]"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        </button>

        <button
          type="button"
          title="Has voice memos"
          aria-label="Filter screenshots with voice memos"
          aria-pressed={quickFilters.voice}
          onClick={() => onToggleQuickFilter("voice")}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border p-0 transition-[background-color,border-color] duration-150 ease-in-out focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] focus-visible:outline-offset-2 ${
            quickFilters.voice
              ? "border-[color:var(--accent)] bg-[color:var(--accent-tint)] text-[color:var(--accent)]"
              : "border-[color:var(--border-subtle)] bg-transparent text-muted hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-shadow)]"
          }`}
        >
          <Mic className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      <div className="relative" ref={filterMenuRef}>
        <button
          type="button"
          onClick={onToggleFilterMenu}
          className="app-label-meta inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-surface hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add Filter
        </button>
        {showFilterMenu ? renderFilterMenuContent() : null}
      </div>

    </div>
  );
}
