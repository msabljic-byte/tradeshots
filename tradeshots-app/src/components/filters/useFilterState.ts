"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AttributeFilter, FilterActions, FilterState, QuickFilters } from "./types";
import {
  filterStatesEqual,
  readFiltersFromParams,
  writeFiltersToParams,
} from "./filterUrlSerialization";

export function useFilterState(): FilterState & FilterActions {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initial = readFiltersFromParams(new URLSearchParams(searchParams.toString()));

  const [tagFilter, setTagFilter] = useState<string>(initial.tagFilter);
  const [searchQuery, setSearchQuery] = useState<string>(initial.searchQuery);
  const [filters, setFilters] = useState<AttributeFilter[]>(initial.filters);
  const [quickFilters, setQuickFilters] = useState<QuickFilters>(initial.quickFilters);
  const [dateRangeFilter, setDateRangeFilter] = useState<{
    from: string | null;
    to: string | null;
  }>(initial.dateRangeFilter);
  const [playbookFilter, setPlaybookFilter] = useState<string | null>(initial.playbookFilter);

  const lastPushedRef = useRef<FilterState>(initial);
  const isApplyingFromUrlRef = useRef<boolean>(false);

  useEffect(() => {
    const current: FilterState = {
      tagFilter,
      searchQuery,
      filters,
      quickFilters,
      dateRangeFilter,
      playbookFilter,
    };
    if (filterStatesEqual(current, lastPushedRef.current)) return;
    if (isApplyingFromUrlRef.current) {
      isApplyingFromUrlRef.current = false;
      lastPushedRef.current = current;
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    writeFiltersToParams(nextParams, current);
    const qs = nextParams.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;

    router.replace(target, { scroll: false });
    lastPushedRef.current = current;
  }, [
    tagFilter,
    searchQuery,
    filters,
    quickFilters,
    dateRangeFilter,
    playbookFilter,
    pathname,
    router,
    searchParams,
  ]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fromUrl = readFiltersFromParams(new URLSearchParams(searchParams.toString()));
    const current: FilterState = {
      tagFilter,
      searchQuery,
      filters,
      quickFilters,
      dateRangeFilter,
      playbookFilter,
    };
    if (filterStatesEqual(fromUrl, current)) return;

    isApplyingFromUrlRef.current = true;
    setTagFilter(fromUrl.tagFilter);
    setSearchQuery(fromUrl.searchQuery);
    setFilters(fromUrl.filters);
    setQuickFilters(fromUrl.quickFilters);
    setDateRangeFilter(fromUrl.dateRangeFilter);
    setPlaybookFilter(fromUrl.playbookFilter);
    lastPushedRef.current = fromUrl;
  }, [searchParams]);

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
