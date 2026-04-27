import type { AttributeFilter, FilterState, QuickFilters } from "./types";

const QF_KEYS: Array<keyof QuickFilters> = ["voice", "annotations", "notes", "favorites"];

/**
 * Serialize filter state to URLSearchParams. Mutates `target` in
 * place: deletes any existing filter-namespaced params first, then
 * writes current non-default values. Leaves non-filter params
 * untouched.
 */
export function writeFiltersToParams(target: URLSearchParams, state: FilterState): void {
  target.delete("q");
  target.delete("tag");
  target.delete("attr");
  target.delete("qf");
  target.delete("dfrom");
  target.delete("dto");
  target.delete("pb");

  if (state.searchQuery.trim()) {
    target.set("q", state.searchQuery.trim());
  }
  for (const tag of state.tagFilters) {
    if (tag.trim()) {
      target.append("tag", tag);
    }
  }
  for (const f of state.filters) {
    target.append("attr", `${f.key}:${f.value}`);
  }
  const activeQf = QF_KEYS.filter((k) => state.quickFilters[k]);
  if (activeQf.length > 0) {
    target.set("qf", activeQf.join(","));
  }
  if (state.dateRangeFilter.from) {
    target.set("dfrom", state.dateRangeFilter.from);
  }
  if (state.dateRangeFilter.to) {
    target.set("dto", state.dateRangeFilter.to);
  }
  if (state.playbookFilter) {
    target.set("pb", state.playbookFilter);
  }
}

/**
 * Parse URLSearchParams into filter state. Tolerant of malformed
 * input - unknown values are dropped silently rather than throwing.
 */
export function readFiltersFromParams(params: URLSearchParams): FilterState {
  const searchQuery = params.get("q") ?? "";
  const tagFilters = Array.from(
    new Set(params.getAll("tag").filter((t) => t.trim().length > 0))
  );

  const attrParams = params.getAll("attr");
  const filters: AttributeFilter[] = [];
  for (const raw of attrParams) {
    const colonIdx = raw.indexOf(":");
    if (colonIdx <= 0 || colonIdx === raw.length - 1) continue;
    const key = raw.slice(0, colonIdx);
    const value = raw.slice(colonIdx + 1);
    if (!key || !value) continue;
    filters.push({ key, value });
  }

  const qfRaw = params.get("qf") ?? "";
  const qfSet = new Set(qfRaw.split(",").map((s) => s.trim()).filter(Boolean));
  const quickFilters: QuickFilters = {
    voice: qfSet.has("voice"),
    annotations: qfSet.has("annotations"),
    notes: qfSet.has("notes"),
    favorites: qfSet.has("favorites"),
  };

  const dfrom = params.get("dfrom");
  const dto = params.get("dto");
  const dateRangeFilter = {
    from: dfrom || null,
    to: dto || null,
  };

  const playbookFilter = params.get("pb") || null;

  return {
    searchQuery,
    tagFilters,
    filters,
    quickFilters,
    dateRangeFilter,
    playbookFilter,
  };
}

/**
 * Compare two filter states for equality. Used to avoid redundant
 * URL updates and render loops.
 */
export function filterStatesEqual(a: FilterState, b: FilterState): boolean {
  if (a.searchQuery !== b.searchQuery) return false;
  if (a.tagFilters.length !== b.tagFilters.length) return false;
  const tagsA = [...a.tagFilters].sort().join("|");
  const tagsB = [...b.tagFilters].sort().join("|");
  if (tagsA !== tagsB) return false;
  if (a.playbookFilter !== b.playbookFilter) return false;
  if (a.dateRangeFilter.from !== b.dateRangeFilter.from) return false;
  if (a.dateRangeFilter.to !== b.dateRangeFilter.to) return false;
  for (const k of QF_KEYS) {
    if (a.quickFilters[k] !== b.quickFilters[k]) return false;
  }
  if (a.filters.length !== b.filters.length) return false;
  const serialize = (fs: AttributeFilter[]) => fs.map((f) => `${f.key}:${f.value}`).sort().join("|");
  return serialize(a.filters) === serialize(b.filters);
}
