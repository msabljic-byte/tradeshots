import { useCallback, useState } from "react";
import type { AttributeFilter, FilterActions, FilterState, QuickFilters } from "./types";

export function useFilterState(): FilterState & FilterActions {
  const [tagFilter, setTagFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filters, setFilters] = useState<AttributeFilter[]>([]);
  const [quickFilters, setQuickFilters] = useState<QuickFilters>({
    voice: false,
    annotations: false,
    notes: false,
    favorites: false,
  });
  const [dateRangeFilter, setDateRangeFilter] = useState<{
    from: string | null;
    to: string | null;
  }>({ from: null, to: null });
  const [playbookFilter, setPlaybookFilter] = useState<string | null>(null);

  const removeFilter = useCallback((index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAllFilters = useCallback(() => {
    setTagFilter("");
    setSearchQuery("");
    setFilters([]);
    setQuickFilters({ voice: false, annotations: false, notes: false, favorites: false });
    setDateRangeFilter({ from: null, to: null });
    setPlaybookFilter(null);
  }, []);

  return {
    tagFilter,
    searchQuery,
    filters,
    quickFilters,
    dateRangeFilter,
    playbookFilter,
    setTagFilter,
    setSearchQuery,
    setFilters,
    setQuickFilters,
    setDateRangeFilter,
    setPlaybookFilter,
    removeFilter,
    clearAllFilters,
  };
}
