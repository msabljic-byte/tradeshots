import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { AttributesSection } from "./AttributesSection";

type ScreenshotRow = {
  id: string;
  tags?: string[] | null;
  folder_id?: string | null;
};

type FolderRow = { id: string; name: string };

type AddFilterMenuProps = {
  screenshots: ScreenshotRow[];
  attributesByScreenshot: Record<string, Array<{ key: string; value: string }>>;
  folders: FolderRow[];
  tagFilter: string;
  filters: Array<{ key: string; value: string }>;
  dateRangeFilter: { from: string | null; to: string | null };
  playbookFilter: string | null;
  onSetTagFilter: (value: string) => void;
  onAddAttributeFilter: (pair: { key: string; value: string }) => void;
  onRemoveAttributeFilter: (index: number) => void;
  onSetDateRange: (range: { from: string | null; to: string | null }) => void;
  onSetPlaybook: (folderId: string | null) => void;
  onClose: () => void;
};

export function AddFilterMenu({
  screenshots,
  attributesByScreenshot,
  folders,
  tagFilter,
  filters,
  dateRangeFilter,
  playbookFilter,
  onSetTagFilter,
  onAddAttributeFilter,
  onRemoveAttributeFilter,
  onSetDateRange,
  onSetPlaybook,
  onClose,
}: AddFilterMenuProps) {
  const [tagSearchLocal, setTagSearchLocal] = useState("");

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of screenshots) {
      (s.tags ?? []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [screenshots]);

  const visibleTags = useMemo(() => {
    if (!tagSearchLocal.trim()) return availableTags;
    const q = tagSearchLocal.trim().toLowerCase();
    return availableTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [availableTags, tagSearchLocal]);

  return (
    <div
      className="ui-popover absolute right-0 top-10 z-40 animate-dropdown-in transition-all duration-150 ease-in-out"
      style={{ width: 380, maxHeight: 560 }}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
          Add Filter
        </span>
        <button
          onClick={onClose}
          aria-label="Close filter menu"
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: 500 }}>
        <div className="p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
            Tags
          </div>
          {availableTags.length === 0 ? (
            <div className="font-serif text-sm italic text-[var(--text-muted)]">No tags yet.</div>
          ) : (
            <>
              <input
                type="text"
                value={tagSearchLocal}
                onChange={(e) => setTagSearchLocal(e.target.value)}
                placeholder="Search tags..."
                className="ui-input mb-2 h-8 w-full text-sm"
              />
              <div className="flex flex-wrap gap-1.5">
                {visibleTags.slice(0, 12).map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => onSetTagFilter(tagFilter === tag.name ? "" : tag.name)}
                    className={`rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                      tagFilter === tag.name
                        ? "border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]"
                        : "border-[var(--border-strong)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {tag.name} <span className="opacity-60">({tag.count})</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-[var(--border-subtle)]" />

        <AttributesSection
          attributesByScreenshot={attributesByScreenshot}
          filters={filters}
          onAddAttributeFilter={onAddAttributeFilter}
          onRemoveAttributeFilter={onRemoveAttributeFilter}
        />

        <div className="border-t border-[var(--border-subtle)]" />

        <div className="p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
            Date
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[
              { label: "Today", days: 0 },
              { label: "Last 7 days", days: 7 },
              { label: "Last 30 days", days: 30 },
              { label: "Last 90 days", days: 90 },
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  const to = new Date().toISOString();
                  const from = new Date(
                    Date.now() - preset.days * 24 * 60 * 60 * 1000
                  ).toISOString();
                  onSetDateRange({ from, to });
                }}
                className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateRangeFilter.from ? dateRangeFilter.from.slice(0, 10) : ""}
              onChange={(e) =>
                onSetDateRange({
                  ...dateRangeFilter,
                  from: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
              className="ui-input h-8 flex-1 text-sm"
            />
            <span className="font-mono text-[10px] text-[var(--text-muted)]">to</span>
            <input
              type="date"
              value={dateRangeFilter.to ? dateRangeFilter.to.slice(0, 10) : ""}
              onChange={(e) =>
                onSetDateRange({
                  ...dateRangeFilter,
                  to: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
              className="ui-input h-8 flex-1 text-sm"
            />
          </div>
        </div>

        <div className="border-t border-[var(--border-subtle)]" />

        <div className="p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
            Playbook
          </div>
          {folders.length === 0 ? (
            <div className="font-serif text-sm italic text-[var(--text-muted)]">
              No playbooks yet.
            </div>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => {
                const count = screenshots.filter((s) => String(s.folder_id) === String(folder.id)).length;
                const isActive = String(playbookFilter) === String(folder.id);
                return (
                  <button
                    key={folder.id}
                    onClick={() => onSetPlaybook(isActive ? null : folder.id)}
                    className={`flex w-full items-center justify-between rounded-[var(--radius-md)] px-2 py-1.5 transition-colors ${
                      isActive
                        ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                        : "text-[var(--text-primary)] hover:bg-[var(--bg-shadow)]"
                    }`}
                  >
                    <span className="font-serif text-sm">{folder.name}</span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
