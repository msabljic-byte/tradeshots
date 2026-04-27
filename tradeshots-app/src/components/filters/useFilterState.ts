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

  const [tagFilters, setTagFilters] = useState<string[]>(initial.tagFilters);
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
      tagFilters,
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
    tagFilters,
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
      tagFilters,
      searchQuery,
      filters,
      quickFilters,
      dateRangeFilter,
      playbookFilter,
    };
    if (filterStatesEqual(fromUrl, current)) return;

    isApplyingFromUrlRef.current = true;
    setTagFilters(fromUrl.tagFilters);
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

  const addTagFilter = useCallback((tag: string) => {
    setTagFilters((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  }, []);

  const removeTagFilter = useCallback((tag: string) => {
    setTagFilters((prev) => prev.filter((t) => t !== tag));
  }, []);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilters((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const clearAllFilters = useCallback(() => {
    setTagFilters([]);
    setSearchQuery("");
    setFilters([]);
    setQuickFilters({ voice: false, annotations: false, notes: false, favorites: false });
    setDateRangeFilter({ from: null, to: null });
    setPlaybookFilter(null);
  }, []);

  return {
    tagFilters,
    searchQuery,
    filters,
    quickFilters,
    dateRangeFilter,
    playbookFilter,
    setTagFilters,
    addTagFilter,
    removeTagFilter,
    toggleTagFilter,
    setSearchQuery,
    setFilters,
    setQuickFilters,
    setDateRangeFilter,
    setPlaybookFilter,
    removeFilter,
    clearAllFilters,
  };
}
