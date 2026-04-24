import type React from "react";

export type AttributeFilter = { key: string; value: string };

export type QuickFilters = {
  voice: boolean;
  annotations: boolean;
  notes: boolean;
  favorites: boolean;
};

export type FilterState = {
  tagFilter: string;
  searchQuery: string;
  filters: AttributeFilter[];
  quickFilters: QuickFilters;
  dateRangeFilter: { from: string | null; to: string | null };
  playbookFilter: string | null;
};

export type FilterActions = {
  setTagFilter: (value: string) => void;
  setSearchQuery: (value: string) => void;
  setFilters: React.Dispatch<React.SetStateAction<AttributeFilter[]>>;
  setQuickFilters: React.Dispatch<React.SetStateAction<QuickFilters>>;
  setDateRangeFilter: React.Dispatch<
    React.SetStateAction<{ from: string | null; to: string | null }>
  >;
  setPlaybookFilter: React.Dispatch<React.SetStateAction<string | null>>;
  removeFilter: (index: number) => void;
  clearAllFilters: () => void;
};
