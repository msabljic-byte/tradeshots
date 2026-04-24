import type { FilterState, QuickFilters } from "./types";

type ChipBuildArgs = FilterState & {
  folders: Array<{ id: string; name: string }>;
  onRemoveAttribute: (index: number) => void;
  onClearSearch: () => void;
  onClearTag: () => void;
  onSetDateRange: (range: { from: string | null; to: string | null }) => void;
  onSetPlaybook: (folderId: string | null) => void;
  onToggleQuickFilter: (key: keyof QuickFilters) => void;
};

export function buildActiveFilterChips(args: ChipBuildArgs) {
  const chips: Array<{ id: string; label: string; onRemove: () => void }> = [];

  if (args.searchQuery.trim().length > 0) {
    chips.push({
      id: "search",
      label: `Search: "${args.searchQuery.trim()}"`,
      onRemove: args.onClearSearch,
    });
  }

  if (args.tagFilter.trim().length > 0) {
    chips.push({
      id: "tag",
      label: `Tag: ${args.tagFilter.trim()}`,
      onRemove: args.onClearTag,
    });
  }
  if (args.dateRangeFilter.from || args.dateRangeFilter.to) {
    const from = args.dateRangeFilter.from
      ? new Date(args.dateRangeFilter.from).toLocaleDateString()
      : "...";
    const to = args.dateRangeFilter.to
      ? new Date(args.dateRangeFilter.to).toLocaleDateString()
      : "Now";
    chips.push({
      id: "date-range",
      label: `Date: ${from} - ${to}`,
      onRemove: () => args.onSetDateRange({ from: null, to: null }),
    });
  }

  if (args.playbookFilter) {
    const folderName =
      args.folders.find((f) => String(f.id) === String(args.playbookFilter))?.name ?? "Playbook";
    chips.push({
      id: `playbook-${args.playbookFilter}`,
      label: `Playbook: ${folderName}`,
      onRemove: () => args.onSetPlaybook(null),
    });
  }

  if (args.quickFilters.favorites) {
    chips.push({
      id: "favorites",
      label: "★ Favorites",
      onRemove: () => args.onToggleQuickFilter("favorites"),
    });
  }
  if (args.quickFilters.annotations) {
    chips.push({
      id: "annotations",
      label: "Has annotations",
      onRemove: () => args.onToggleQuickFilter("annotations"),
    });
  }
  if (args.quickFilters.notes) {
    chips.push({
      id: "notes",
      label: "Has notes",
      onRemove: () => args.onToggleQuickFilter("notes"),
    });
  }
  if (args.quickFilters.voice) {
    chips.push({
      id: "voice",
      label: "Has voice",
      onRemove: () => args.onToggleQuickFilter("voice"),
    });
  }

  args.filters.forEach((f, index) => {
    chips.push({
      id: `attr-${f.key}-${f.value}-${index}`,
      label: `${f.key}: ${f.value}`,
      onRemove: () => args.onRemoveAttribute(index),
    });
  });

  return chips;
}
