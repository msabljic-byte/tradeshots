import type { FilterState } from "@/components/filters/types";

export type SavedViewFilters = {
  attributeFilters: Array<{ key: string; value: string }>;
  tagFilter: string;
  searchQuery: string;
  quickFilters: {
    voice: boolean;
    annotations: boolean;
    notes: boolean;
    favorites: boolean;
  };
  dateRangeFilter: { from: string | null; to: string | null };
  playbookFilter: string | null;
};

export type SavedView = {
  id: string;
  user_id: string;
  name: string;
  filters: SavedViewFilters | Array<{ key: string; value: string }>;
  created_at: string;
};

/**
 * Convert a SavedView's stored filters payload into the FilterState
 * shape used at runtime. Handles legacy array-only payloads.
 */
export function savedViewToFilterState(view: SavedView): FilterState {
  if (Array.isArray(view.filters)) {
    return {
      filters: view.filters,
      tagFilter: "",
      searchQuery: "",
      quickFilters: { voice: false, annotations: false, notes: false, favorites: false },
      dateRangeFilter: { from: null, to: null },
      playbookFilter: null,
    };
  }
  const f = view.filters;
  return {
    filters: f.attributeFilters ?? [],
    tagFilter: f.tagFilter ?? "",
    searchQuery: f.searchQuery ?? "",
    quickFilters: {
      voice: Boolean(f.quickFilters?.voice),
      annotations: Boolean(f.quickFilters?.annotations),
      notes: Boolean(f.quickFilters?.notes),
      favorites: Boolean(f.quickFilters?.favorites),
    },
    dateRangeFilter: f.dateRangeFilter ?? { from: null, to: null },
    playbookFilter: f.playbookFilter ?? null,
  };
}

/**
 * Convert a runtime FilterState into the SavedViewFilters payload
 * shape for persistence.
 */
export function filterStateToSavedViewFilters(state: FilterState): SavedViewFilters {
  return {
    attributeFilters: state.filters,
    tagFilter: state.tagFilter,
    searchQuery: state.searchQuery,
    quickFilters: state.quickFilters,
    dateRangeFilter: state.dateRangeFilter,
    playbookFilter: state.playbookFilter,
  };
}

/**
 * Compare two filter states for deep equality. Used by the "Modified"
 * indicator: if the active view's stored filters match the current
 * state, the view is "clean"; otherwise it's "modified".
 */
export function filtersEqual(a: FilterState, b: FilterState): boolean {
  if (a.tagFilter !== b.tagFilter) return false;
  if (a.searchQuery !== b.searchQuery) return false;
  if (a.playbookFilter !== b.playbookFilter) return false;
  if (a.dateRangeFilter.from !== b.dateRangeFilter.from) return false;
  if (a.dateRangeFilter.to !== b.dateRangeFilter.to) return false;
  for (const k of ["voice", "annotations", "notes", "favorites"] as const) {
    if (a.quickFilters[k] !== b.quickFilters[k]) return false;
  }
  if (a.filters.length !== b.filters.length) return false;
  const norm = (fs: Array<{ key: string; value: string }>) =>
    fs
      .map((f) => `${f.key}:${f.value}`)
      .sort()
      .join("|");
  return norm(a.filters) === norm(b.filters);
}
