"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ScreenshotUploader from "@/components/upload/ScreenshotUploader";
import { createPortal } from "react-dom";

type ScreenshotRow = {
  id: string;
  image_url: string;
  created_at: string;
  tags?: string[] | null;
  notes?: string | null;
};

/** Normalize rows from Supabase (column names vary by schema / PostgREST) */
function parseTradeAttributeRow(
  row: Record<string, unknown>
): { key: string; value: string } | null {
  const rawKey =
    row.key ??
    row["key"] ??
    row.attr_key ??
    row.attribute_key ??
    row.field ??
    row.name;
  const rawValue =
    row.value ??
    row["value"] ??
    row.attr_value ??
    row.attribute_value ??
    row.val;
  if (rawKey == null || rawValue == null) return null;
  const key = String(rawKey).trim().toLowerCase();
  const value = String(rawValue).trim().toLowerCase();
  if (!key || !value) return null;
  return { key, value };
}

function buildAttributeMapFromRows(
  rows: Record<string, unknown>[]
): Record<string, Record<string, string[]>> {
  const map: Record<string, Record<string, string[]>> = {};
  for (const row of rows) {
    const sid =
      row.screenshot_id != null ? String(row.screenshot_id) : "";
    if (!sid) continue;
    const parsed = parseTradeAttributeRow(row);
    if (!parsed) continue;
    if (!map[sid]) map[sid] = {};
    const { key: keyLower, value: valueLower } = parsed;
    if (!map[sid][keyLower]) map[sid][keyLower] = [];
    if (!map[sid][keyLower].includes(valueLower)) {
      map[sid][keyLower].push(valueLower);
    }
  }
  return map;
}

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [allAttributes, setAllAttributes] = useState<any[]>([]);
  const [attributeKeyValuesByScreenshot, setAttributeKeyValuesByScreenshot] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [filters, setFilters] = useState<
    Array<{
      key: string;
      value: string;
    }>
  >([]);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [draggedScreenshotId, setDraggedScreenshotId] = useState<string[]>([]);
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null);
  const [commandActiveIndex, setCommandActiveIndex] = useState<number>(-1);
  const [selectedIds, setSelectedIds] = useState<any[]>([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);
  const [bulkBaseAttributes, setBulkBaseAttributes] = useState<any[] | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [modalEntered, setModalEntered] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  const [savedViews, setSavedViews] = useState<any[]>([]);
  const [viewName, setViewName] = useState("");
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [currentNote, setCurrentNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savedNoteToast, setSavedNoteToast] = useState(false);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [undoData, setUndoData] = useState<{
    attribute: any;
    index: number;
  } | null>(null);
  const [savingAttributes, setSavingAttributes] = useState(false);
  const [savedAttributesToast, setSavedAttributesToast] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isMacPlatform, setIsMacPlatform] = useState(false);

  const multiSelectHint = isMacPlatform
      ? "⌘ to select • ⇧ to select range"
      : "Ctrl to select • Shift to select range";

  function handleImageLoaded(id: string) {
    setLoadedImages((prev) => ({ ...prev, [id]: true }));
  }

  function addFilter(key: string, value: string) {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedKey || !normalizedValue) return;

    setFilters((prev) => {
      const exists = prev.some(
        (f) => f.key === normalizedKey && f.value === normalizedValue
      );
      if (exists) return prev;
      return [...prev, { key: normalizedKey, value: normalizedValue }];
    });

    setShowFilterMenu(false);
    setSelectedKey("");
    setSearchTerm("");
  }

  function removeFilter(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }

  const fetchScreenshots = async () => {
    setLoading(true);
    setAttributeKeyValuesByScreenshot({});

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
      setScreenshots([]);
      setLoading(false);
      return;
    }

    let query = supabase
      .from("screenshots")
      .select("id, image_url, created_at, tags, notes")
      .eq("user_id", user.id);

    if (activeFolderId) {
      query = query.eq("folder_id", activeFolderId);
    }

    const { data, error: screenshotsError } = await query.order("created_at", {
      ascending: false,
    });

    if (screenshotsError) {
      setError(screenshotsError.message);
      setScreenshots([]);
      setAttributeKeyValuesByScreenshot({});
    } else {
      setError(null);
      const screenshotRows = (data ?? []) as ScreenshotRow[];
      setScreenshots(screenshotRows);

      const screenshotIds = screenshotRows.map((s) => s.id);
      if (screenshotIds.length > 0) {
        const { data: attrData, error: attrError } = await supabase
          .from("trade_attributes")
          .select("*")
          .in("screenshot_id", screenshotIds);

        if (attrError) {
          console.warn("trade_attributes (by screenshot):", attrError.message);
          setAttributeKeyValuesByScreenshot({});
        } else if (attrData) {
          setAttributeKeyValuesByScreenshot(
            buildAttributeMapFromRows(attrData as Record<string, unknown>[])
          );
        } else {
          setAttributeKeyValuesByScreenshot({});
        }
      }
    }

    setLoading(false);
  };

  const fetchAllAttributes = useCallback(async () => {
    const { data, error } = await supabase.from("trade_attributes").select("*");
    if (error) {
      console.warn("fetchAllAttributes:", error.message);
      setAllAttributes([]);
      return;
    }
    setAllAttributes(data ?? []);
  }, []);

  async function fetchSavedViews() {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      setSavedViews([]);
      return;
    }

    const { data } = await supabase
      .from("saved_views")
      .select("*")
      .eq("user_id", user.id);

    setSavedViews(data || []);
  }

  async function fetchFolders() {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      setFolders([]);
      return;
    }

    const { data } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    setFolders(data || []);
  }

  async function createFolder(name: string, parentId: string | null = null) {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    await supabase.from("folders").insert({
      name,
      parent_id: parentId,
      user_id: user.id,
    });

    await fetchFolders();
  }

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  }

  function hasChildren(folderId: string) {
    return folders.some((f: any) => f.parent_id === folderId);
  }

  async function handleSaveView() {
    if (!viewName || filters.length === 0) return;

    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    await supabase.from("saved_views").insert({
      user_id: user.id,
      name: viewName,
      filters: filters,
    });

    setViewName("");
    await fetchSavedViews();
  }

  function applyView(view: any) {
    if (!view?.filters) return;
    setFilters(view.filters);
    setActiveViewId(view.id);
  }

  async function deleteView(id: string) {
    await supabase.from("saved_views").delete().eq("id", id);

    setSavedViews((prev) => prev.filter((v) => v.id !== id));

    if (activeViewId === id) {
      setActiveViewId(null);
      setFilters([]);
    }
  }

  async function renameView(id: string, newName: string) {
    await supabase
      .from("saved_views")
      .update({ name: newName })
      .eq("id", id);

    await fetchSavedViews();
  }

  /** Rebuild per-screenshot attribute map from DB (same source as grid filters + autocomplete) */
  const refreshTradeAttributesIndex = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const { data: shotRows, error: shotsErr } = await supabase
      .from("screenshots")
      .select("id")
      .eq("user_id", user.id);

    if (shotsErr) {
      console.warn("refreshTradeAttributesIndex (screenshots):", shotsErr.message);
      return;
    }

    const ids = (shotRows ?? []).map((s) => s.id);
    if (ids.length === 0) {
      setAttributeKeyValuesByScreenshot({});
      return;
    }

    const { data: attrData, error: attrErr } = await supabase
      .from("trade_attributes")
      .select("*")
      .in("screenshot_id", ids);

    if (attrErr) {
      console.warn("refreshTradeAttributesIndex:", attrErr.message);
      return;
    }

    setAttributeKeyValuesByScreenshot(
      buildAttributeMapFromRows((attrData ?? []) as Record<string, unknown>[])
    );
  }, []);

  useEffect(() => {
    async function loadDashboardData() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        router.replace("/login");
        return;
      }

      setEmail(user.email ?? null);
      await fetchScreenshots();
      await fetchAllAttributes();
    }

    loadDashboardData().finally(() => {
      setCheckingSession(false);
    });
  }, [router, fetchAllAttributes]);

  useEffect(() => {
    if (checkingSession) return;
    fetchScreenshots();
  }, [activeFolderId]);

  useEffect(() => {
    fetchSavedViews();
  }, []);

  useEffect(() => {
    fetchFolders();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsMacPlatform(navigator.platform.includes("Mac"));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target?.closest(".profile-menu")) {
        setIsProfileOpen(false);
      }
    }

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }

      if (e.key === "Escape") {
        setIsCommandOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (selectedIndex === null) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [selectedIndex]);

  useEffect(() => {
    fetchAllAttributes();
  }, [fetchAllAttributes]);

  // Group attributes per screenshot to enable scalable multi-filter logic.
  const attributesByScreenshot = useMemo(() => {
    const result: Record<
      string,
      Array<{ key: string; value: string }>
    > = {};

    for (const [screenshotId, keyMap] of Object.entries(
      attributeKeyValuesByScreenshot
    )) {
      const pairs: Array<{ key: string; value: string }> = [];
      for (const [key, values] of Object.entries(keyMap ?? {})) {
        for (const value of values ?? []) {
          pairs.push({ key, value });
        }
      }
      result[screenshotId] = pairs;
    }

    return result;
  }, [attributeKeyValuesByScreenshot]);

  /** Pairs from loaded screenshots — stays in sync with fetchScreenshots / local patches */
  const attributePairsFromScreenshots = useMemo(() => {
    const pairs: Array<{ key: string; value: string }> = [];
    const seen = new Set<string>();
    for (const keyMap of Object.values(attributeKeyValuesByScreenshot)) {
      for (const [key, values] of Object.entries(keyMap ?? {})) {
        for (const value of values ?? []) {
          const k = String(key).trim().toLowerCase();
          const v = String(value).trim().toLowerCase();
          if (!k || !v) continue;
          const sig = `${k}\0${v}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          pairs.push({ key: k, value: v });
        }
      }
    }
    return pairs;
  }, [attributeKeyValuesByScreenshot]);

  /** Merged DB + screenshot map so filter autocomplete works even if one source lags */
  const allAttributesNormalized = useMemo(() => {
    const fromDb = (allAttributes ?? [])
      .map((row: any) =>
        parseTradeAttributeRow(row as Record<string, unknown>)
      )
      .filter((x): x is { key: string; value: string } => x !== null);

    const seen = new Set<string>();
    const merged: Array<{ key: string; value: string }> = [];
    const push = (a: { key: string; value: string }) => {
      const sig = `${a.key}\0${a.value}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      merged.push(a);
    };
    for (const a of attributePairsFromScreenshots) push(a);
    for (const a of fromDb) push(a);
    return merged;
  }, [allAttributes, attributePairsFromScreenshots]);

  /** Keys from merged pairs plus any key present in per-screenshot maps */
  const uniqueKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const a of allAttributesNormalized) {
      if (a.key) keys.add(a.key);
    }
    for (const keyMap of Object.values(attributeKeyValuesByScreenshot)) {
      for (const k of Object.keys(keyMap ?? {})) {
        const kl = k.trim().toLowerCase();
        if (kl) keys.add(kl);
      }
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [allAttributesNormalized, attributeKeyValuesByScreenshot]);

  /** Values for selected attribute key — read maps first, then merged pairs */
  const valuesForKey = useMemo(() => {
    if (!selectedKey) return [];
    const values = new Set<string>();
    for (const keyMap of Object.values(attributeKeyValuesByScreenshot)) {
      const list = keyMap[selectedKey];
      if (list) {
        for (const v of list) {
          if (v) values.add(v);
        }
      }
    }
    for (const a of allAttributesNormalized) {
      if (a.key === selectedKey && a.value) values.add(a.value);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [selectedKey, attributeKeyValuesByScreenshot, allAttributesNormalized]);

  /** All distinct values (for modal Field/Value datalists) */
  const allUniqueAttributeValues = useMemo(() => {
    const values = new Set<string>();
    for (const a of allAttributesNormalized) {
      if (a.value) values.add(a.value);
    }
    for (const keyMap of Object.values(attributeKeyValuesByScreenshot)) {
      for (const list of Object.values(keyMap ?? {})) {
        for (const v of list ?? []) {
          if (v) values.add(v);
        }
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [allAttributesNormalized, attributeKeyValuesByScreenshot]);

  const filteredKeys = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return uniqueKeys;
    return uniqueKeys.filter((k) => k.toLowerCase().includes(term));
  }, [searchTerm, uniqueKeys]);

  const filteredValues = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return valuesForKey;
    return valuesForKey.filter((v) => v.toLowerCase().includes(term));
  }, [searchTerm, valuesForKey]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showFilterMenu) {
          setShowFilterMenu(false);
          return;
        }
        return;
      }

      if (showFilterMenu) return;

      const tagFilterLower = tagFilter.trim().toLowerCase();

      const filteredScreenshots = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
          );

        return matchesTag && matchesAttribute;
      });

      if (selectedIndex === null) return;
      if (selectedIndex < 0 || selectedIndex >= filteredScreenshots.length) return;

      if (e.key === "ArrowRight") {
        setSelectedIndex((prev) =>
          prev !== null && prev < filteredScreenshots.length - 1
            ? prev + 1
            : prev
        );
      }
      if (e.key === "ArrowLeft") {
        setSelectedIndex((prev) =>
          prev !== null && prev > 0 ? prev - 1 : prev
        );
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    screenshots,
    tagFilter,
    filters,
    attributesByScreenshot,
    showFilterMenu,
    selectedIndex,
  ]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedIndex(null);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (selectedIndex === null) {
      setModalEntered(false);
      return;
    }
    setModalEntered(false);
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setModalEntered(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [selectedIndex]);

  useEffect(() => {
    if (selectedIndex === null) {
      setCurrentNote("");
      return;
    }

    const tagFilterLower = tagFilter.trim().toLowerCase();

    const filtered = screenshots.filter((s) => {
      const matchesTag =
        !tagFilterLower ||
        s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

      const pairs = attributesByScreenshot[s.id] ?? [];
      const matchesAttribute =
        filters.length === 0 ||
        filters.every((f) =>
          pairs.some((a) => a.key === f.key && a.value === f.value)
        );

      return matchesTag && matchesAttribute;
    });

    const shot = filtered[selectedIndex];
    setCurrentNote(shot?.notes ?? "");
  }, [
    selectedIndex,
    screenshots,
    tagFilter,
    filters,
    attributesByScreenshot,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAttributes() {
      if (selectedIndex === null) {
        if (!cancelled) setAttributes([]);
        return;
      }

      const tagFilterLower = tagFilter.trim().toLowerCase();

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
          );

        return matchesTag && matchesAttribute;
      });

      const screenshot = filtered[selectedIndex];
      if (!screenshot) {
        if (!cancelled) setAttributes([]);
        return;
      }

      const { data } = await supabase
        .from("trade_attributes")
        .select("*")
        .eq("screenshot_id", screenshot.id);

      if (!cancelled) setAttributes(data || []);
    }

    fetchAttributes();
    return () => {
      cancelled = true;
    };
  }, [
    selectedIndex,
    tagFilter,
    filters,
    attributesByScreenshot,
  ]);

  useEffect(() => {
    if (selectedIndex === null) {
      setUndoData(null);
      setBulkTargetIds([]);
      setBulkBaseAttributes(null);
    }
  }, [selectedIndex]);

  async function handleLogout() {
    setSigningOut(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setError(error.message);
        return;
      }
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleSaveNote() {
    if (selectedIndex === null) return;

    setSavingNote(true);
    setError(null);
    try {
      const tagFilterLower = tagFilter.trim().toLowerCase();

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
          );

        return matchesTag && matchesAttribute;
      });

      const shot = filtered[selectedIndex];
      if (!shot) return;

      const { error: saveError } = await supabase
        .from("screenshots")
        .update({ notes: currentNote })
        .eq("id", shot.id);

      if (saveError) {
        setError(saveError.message);
        return;
      }

      // Keep UI in sync for note navigation.
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === shot.id
            ? {
                ...s,
                notes: currentNote,
              }
            : s
        )
      );

      setSavedNoteToast(true);
      setTimeout(() => setSavedNoteToast(false), 2000);
    } finally {
      setSavingNote(false);
    }
  }

  async function saveAttributes(
    attrList: any[],
    options?: { showToast?: boolean }
  ) {
    if (selectedIndex === null) return;

    setSavingAttributes(true);
    setError(null);

    const showToast = options?.showToast !== false;

    try {
      const tagFilterLower = tagFilter.trim().toLowerCase();

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
          );

        return matchesTag && matchesAttribute;
      });

      const screenshot = filtered[selectedIndex];
      if (!screenshot) return;

      const { error: deleteError } = await supabase
        .from("trade_attributes")
        .delete()
        .eq("screenshot_id", screenshot.id);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData.user) {
        setError(userError?.message ?? "User not found.");
        return;
      }

      const rows = attrList
        .map((attr) => ({
          screenshot_id: screenshot.id,
          user_id: userData.user.id,
          key: (attr?.key ?? "").toString(),
          value: (attr?.value ?? "").toString(),
        }))
        .filter((r) => r.key.trim().length > 0);

      if (rows.length === 0) {
        await fetchAllAttributes();
        await refreshTradeAttributesIndex();
        if (showToast) {
          setSavedAttributesToast(true);
          setTimeout(() => setSavedAttributesToast(false), 2000);
        }
        return;
      }

      const { error: insertError } = await supabase
        .from("trade_attributes")
        .insert(rows);

      if (insertError) {
        setError(insertError.message);
        return;
      }

      await fetchAllAttributes();
      await refreshTradeAttributesIndex();
      if (showToast) {
        setSavedAttributesToast(true);
        setTimeout(() => setSavedAttributesToast(false), 2000);
      }
    } finally {
      setSavingAttributes(false);
    }
  }

  async function handleSaveAttributes() {
    if (selectedIndex === null) return;

    // Bulk "Add Attribute" mode: apply ONLY the changes (delta) made in the modal
    // to all selected screenshots, without clobbering unrelated attributes.
    if (bulkTargetIds.length > 0 && bulkBaseAttributes) {
      setSavingAttributes(true);
      setError(null);

      try {
        const user = (await supabase.auth.getUser()).data.user;
        if (!user) {
          setError("User not found.");
          return;
        }

        const normalizePairs = (rows: any[]) => {
          const out: Array<{ sig: string; key: string; value: string }> = [];
          for (const r of rows ?? []) {
            const keyRaw = (r?.key ?? "").toString();
            const valueRaw = (r?.value ?? "").toString();
            const key = keyRaw.trim();
            if (!key) continue;
            const value = valueRaw.trim();

            const sig = `${key.toLowerCase()}\0${value.toLowerCase()}`;
            out.push({ sig, key, value });
          }
          return out;
        };

        const basePairs = normalizePairs(bulkBaseAttributes);
        const newPairs = normalizePairs(attributes);

        const baseSigSet = new Set(basePairs.map((p) => p.sig));
        const newSigSet = new Set(newPairs.map((p) => p.sig));

        const toAdd = newPairs.filter((p) => !baseSigSet.has(p.sig));
        const toRemove = basePairs.filter((p) => !newSigSet.has(p.sig));

        // Remove deleted attributes across all selected screenshots.
        for (const p of toRemove) {
          await supabase
            .from("trade_attributes")
            .delete()
            .in("screenshot_id", bulkTargetIds)
            .eq("key", p.key)
            .eq("value", p.value);
        }

        // Add newly added attributes across all selected screenshots.
        for (const p of toAdd) {
          // If DB enforces uniqueness by key (common), remove any existing value for this key.
          const { error: deleteKeyError } = await supabase
            .from("trade_attributes")
            .delete()
            .in("screenshot_id", bulkTargetIds)
            .eq("key", p.key);

          if (deleteKeyError) {
            setError(deleteKeyError.message);
            return;
          }

          const rows = bulkTargetIds.map((sid) => ({
            screenshot_id: sid,
            user_id: user.id,
            key: p.key,
            value: p.value,
          }));

          if (rows.length > 0) {
            const { error: insertError } = await supabase
              .from("trade_attributes")
              .insert(rows);

            if (insertError) {
              setError(insertError.message);
              return;
            }
          }
        }

        await fetchAllAttributes();
        await refreshTradeAttributesIndex();

        setSavedAttributesToast(true);
        setTimeout(() => setSavedAttributesToast(false), 2000);
      } finally {
        setSavingAttributes(false);
      }

      setBulkTargetIds([]);
      setBulkBaseAttributes(null);
      setSelectedIndex(null);
      return;
    }

    await saveAttributes(attributes);
  }

  async function handleDeleteAttribute(index: number) {
    const removed = attributes[index];

    const updated = attributes.filter((_, i) => i !== index);
    setAttributes(updated);

    setUndoData({
      attribute: removed,
      index,
    });

    await saveAttributes(updated);

    setTimeout(() => {
      setUndoData(null);
    }, 5000);
  }

  async function handleUndo() {
    if (!undoData) return;

    const restored = [...attributes];
    restored.splice(undoData.index, 0, undoData.attribute);

    setAttributes(restored);

    await saveAttributes(restored);

    setUndoData(null);
  }

  const tagFilterLower = tagFilter.trim().toLowerCase();

  const filteredScreenshots = screenshots.filter((s) => {
    const matchesTag =
      !tagFilterLower ||
      s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

    if (filters.length === 0) return matchesTag;

    const pairs = attributesByScreenshot[s.id] ?? [];
    const matchesAttributes = filters.every((filter) =>
      pairs.some(
        (a) => a.key === filter.key && a.value === filter.value
      )
    );

    return matchesTag && matchesAttributes;
  });

  const selectedImage =
    selectedIndex !== null ? filteredScreenshots[selectedIndex] ?? null : null;
  const panelWidth = isPanelOpen ? 380 : 48;
  const profileInitials = (email ?? "?")
    .split("@")[0]
    .split(/[.\-_ ]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";

  async function openBulkModal() {
    const ids = selectedIds.filter(Boolean).map((id) => String(id));
    const firstId = ids[0];
    if (!firstId) return;

    const idx = filteredScreenshots.findIndex((s) => s.id === firstId);
    if (idx === -1) return;

    setBulkTargetIds(ids);
    setBulkBaseAttributes(null);

    const { data: baseData } = await supabase
      .from("trade_attributes")
      .select("*")
      .eq("screenshot_id", firstId);

    setBulkBaseAttributes(baseData ?? []);

    setSelectedIds([]);
    setLastSelectedIndex(null);
    setSelectedIndex(idx);
  }

  function toggleSelectedId(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
    );
  }

  function openScreenshotFromCommand(screenshotId: string) {
    const currentFilteredIndex = filteredScreenshots.findIndex(
      (s) => s.id === screenshotId
    );
    if (currentFilteredIndex >= 0) {
      setSelectedIndex(currentFilteredIndex);
      return;
    }

    // If hidden by active filters, clear filters then open within full list.
    setTagFilter("");
    setFilters([]);
    window.setTimeout(() => {
      const allIndex = screenshots.findIndex((s) => s.id === screenshotId);
      if (allIndex >= 0) {
        setSelectedIndex(allIndex);
      }
    }, 0);
  }

  async function applyBulkAttribute(key: string, value: string) {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    if (!selectedIds.length) return;

    const rows = selectedIds.map((id) => ({
      screenshot_id: id,
      user_id: user.id,
      key,
      value,
    }));

    await supabase.from("trade_attributes").insert(rows);

    setSelectedIds([]);

    await fetchAllAttributes();
  }

  async function handleBulkDelete() {
    await supabase
      .from("screenshots")
      .delete()
      .in("id", selectedIds);

    setSelectedIds([]);
    setLastSelectedIndex(null);
    setShowDeleteConfirm(false);

    await fetchScreenshots();
  }

  const commandViewResults = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    const source = savedViews ?? [];
    if (!q) return source.slice(0, 12);
    return source
      .filter((v) => String(v?.name ?? "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [savedViews, commandQuery]);

  const commandScreenshotResults = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return [];
    return screenshots
      .filter((s) => {
        const inNotes = String(s?.notes ?? "").toLowerCase().includes(q);
        const inTags = (s.tags ?? []).some((tag) =>
          String(tag).toLowerCase().includes(q)
        );
        return inNotes || inTags;
      })
      .slice(0, 20);
  }, [screenshots, commandQuery]);

  const commandItems = useMemo(
    () => [
      ...commandViewResults.map((view: any) => ({
        type: "view" as const,
        id: String(view.id),
        label: String(view.name ?? ""),
        payload: view,
      })),
      ...commandScreenshotResults.map((shot) => ({
        type: "screenshot" as const,
        id: String(shot.id),
        label:
          shot.tags && shot.tags.length > 0
            ? shot.tags.join(", ")
            : String(shot.notes ?? "Open screenshot"),
        payload: shot,
      })),
    ],
    [commandViewResults, commandScreenshotResults]
  );

  function renderFolders(parentId: string | null = null, level = 0) {
    return folders
      .filter((f: any) => f.parent_id === parentId)
      .map((folder: any) => {
        const isExpanded = expandedFolders.has(String(folder.id));
        const isActive = activeFolderId === folder.id;

        return (
          <div key={folder.id}>
            <div
              className={`
                group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5
                ${isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"}
                ${draggedScreenshotId.length > 0 ? "hover:bg-blue-100" : ""}
                ${hoverFolderId === folder.id ? "bg-blue-100" : ""}
              `}
              style={{ paddingLeft: `${8 + level * 16}px` }}
              title={hasChildren(String(folder.id)) ? "Click arrow to expand" : ""}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setHoverFolderId(folder.id);
              }}
              onDragEnter={() => setHoverFolderId(folder.id)}
              onDrop={async (e) => {
                e.preventDefault();

                if (!draggedScreenshotId || draggedScreenshotId.length === 0) return;

                await supabase
                  .from("screenshots")
                  .update({ folder_id: folder.id })
                  .in("id", draggedScreenshotId);

                setDraggedScreenshotId([]);
                setHoverFolderId(null);
                setSelectedIds([]);
                await fetchScreenshots();
              }}
            >
              {hasChildren(String(folder.id)) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(String(folder.id));
                  }}
                  className={`text-xs ${
                    isActive ? "text-white/80 hover:text-white" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {isExpanded ? "▼" : "▶"}
                </button>
              ) : (
                <span className="w-3" />
              )}

              <span
                onClick={() => setActiveFolderId(folder.id)}
                className="flex-1 truncate text-sm"
              >
                📁 {folder.name}
              </span>
            </div>

            {isExpanded && renderFolders(folder.id, level + 1)}
          </div>
        );
      });
  }

  function executeCommandItem(item: (typeof commandItems)[number]) {
    if (!item) return;
    if (item.type === "view") {
      applyView(item.payload);
      setIsCommandOpen(false);
      return;
    }

    openScreenshotFromCommand(item.id);
    setIsCommandOpen(false);
  }

  useEffect(() => {
    if (!isCommandOpen) {
      setCommandActiveIndex(-1);
      return;
    }

    if (commandItems.length === 0) {
      setCommandActiveIndex(-1);
      return;
    }

    setCommandActiveIndex((prev) =>
      prev < 0 || prev >= commandItems.length ? 0 : prev
    );
  }, [isCommandOpen, commandItems.length]);

  useEffect(() => {
    if (!isCommandOpen) return;

    function handleCommandNav(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (commandItems.length === 0) return;
        setCommandActiveIndex((prev) =>
          prev < 0 ? 0 : (prev + 1) % commandItems.length
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (commandItems.length === 0) return;
        setCommandActiveIndex((prev) =>
          prev < 0
            ? commandItems.length - 1
            : (prev - 1 + commandItems.length) % commandItems.length
        );
        return;
      }

      if (e.key === "Enter") {
        if (commandActiveIndex < 0 || commandActiveIndex >= commandItems.length)
          return;
        e.preventDefault();
        executeCommandItem(commandItems[commandActiveIndex]);
      }
    }

    window.addEventListener("keydown", handleCommandNav);
    return () => window.removeEventListener("keydown", handleCommandNav);
  }, [isCommandOpen, commandItems, commandActiveIndex]);

  return (
    <div className="flex h-screen bg-gray-50">
      <div
        className="flex w-64 flex-col border-r border-gray-200 bg-white p-4"
        onDragOver={(e) => e.preventDefault()}
      >
        <h1 className="mb-6 text-lg font-semibold text-gray-900">TradeShots</h1>

        <button
          type="button"
          onClick={() => {
            const name = prompt("Folder name");
            if (!name) return;

            void createFolder(name, activeFolderId);
          }}
          className="mb-4 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
        >
          + New Folder
        </button>

        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setActiveFolderId(null)}
            className={`
              w-full rounded-lg px-3 py-2 text-left text-sm
              ${activeFolderId === null
                ? "bg-gray-900 text-white"
                : "text-gray-700 hover:bg-gray-100"
              }
            `}
          >
            All Screenshots
          </button>

          <div className="space-y-1">{renderFolders(null, 0)}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <div className="w-full max-w-md">
            <button
              type="button"
              onClick={() => setIsCommandOpen(true)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-500 transition hover:bg-gray-50"
            >
              <span>Search or jump to…</span>
              <span className="text-xs text-gray-400">Ctrl + K</span>
            </button>
          </div>

          <div className="ml-4 flex min-w-[44px] items-center justify-end">
            <div className="profile-menu relative">
              <button
                type="button"
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                aria-expanded={isProfileOpen}
                aria-haspopup="menu"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                {profileInitials}
              </button>

              {isProfileOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                  <div className="px-2 py-1">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">
                      Signed in as
                    </p>
                    <p className="truncate text-sm text-gray-900">{email ?? ""}</p>
                  </div>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    type="button"
                    className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm text-gray-500"
                    disabled
                  >
                    Account settings
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={signingOut}
                    className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm text-red-600 transition hover:bg-gray-100 disabled:opacity-60"
                  >
                    {signingOut ? "Signing out..." : "Log out"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 font-sans">
          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {checkingSession ? (
            <div className="py-20 text-center">
              <p className="text-sm text-gray-600">Checking your session...</p>
            </div>
          ) : loading ? (
            <div className="py-20 text-center">
              <p className="text-sm text-gray-600">Loading screenshots...</p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">Your Screenshots</h2>
              </div>

              <div className="mb-6">
                <ScreenshotUploader onUploadComplete={fetchScreenshots} />
              </div>

              {screenshots.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <p className="text-lg font-medium text-gray-900">No screenshots yet</p>
                  <p className="mt-2 text-sm text-gray-600">
                    Upload your first trade to get started
                  </p>
                </div>
              ) : (
              <>
              <div className="mb-6 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <input
                    value={viewName}
                    onChange={(e) => setViewName(e.target.value)}
                    placeholder="View name"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />

                  <button
                    type="button"
                    onClick={() => void handleSaveView()}
                    className="rounded-lg bg-gray-900 px-3 py-1 text-sm text-white"
                  >
                    Save View
                  </button>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {savedViews.map((view) => (
                    <div key={view.id} className="group flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => applyView(view)}
                        className={`
                          rounded-full px-3 py-1 text-sm transition
                          ${activeViewId === view.id
                            ? "bg-gray-900 text-white"
                            : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                          }
                        `}
                      >
                        {view.name}
                      </button>

                      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => {
                            const newName = prompt("Rename view", view.name);
                            if (newName) {
                              void renameView(view.id, newName);
                            }
                          }}
                          className="rounded p-1.5 text-gray-600 transition hover:bg-gray-200 hover:text-gray-900"
                        >
                          ✏
                        </button>

                        <button
                          type="button"
                          onClick={() => void deleteView(view.id)}
                          className="rounded p-1.5 text-gray-600 transition hover:bg-gray-200 hover:text-red-600"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <input
                  type="text"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder="Filter by tag..."
                  className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-500 transition focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFilterMenu(true);
                      setSelectedKey("");
                      setSearchTerm("");
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-100"
                  >
                    + Add Filter
                  </button>

                  {filters.map((f, index) => (
                    <div
                      key={`${f.key}-${f.value}-${index}`}
                      className="flex items-center gap-2 rounded-full bg-gray-900 px-3 py-1 text-sm text-white"
                    >
                      <span className="font-medium">
                        {f.key}: {f.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFilter(index)}
                        className="text-white/70 transition hover:text-white"
                        aria-label="Remove filter"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {showFilterMenu && (
                  <div
                    className="fixed inset-0 z-[200] flex cursor-pointer items-start justify-center bg-black/40 pt-32"
                    onClick={() => setShowFilterMenu(false)}
                  >
                    <div
                      className="w-full max-w-md cursor-default rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        placeholder={
                          selectedKey ? "Search value..." : "Search attribute..."
                        }
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full border-b border-gray-300 px-2 py-2 text-sm text-gray-900 placeholder:text-gray-500 outline-none"
                      />

                      <div className="mt-2 max-h-60 overflow-y-auto">
                        {!selectedKey ? (
                          filteredKeys.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">
                              No results found
                            </div>
                          ) : (
                            filteredKeys.map((key) => (
                              <div
                                key={key}
                                onClick={() => {
                                  setSelectedKey(key);
                                  setSearchTerm("");
                                }}
                                className="cursor-pointer rounded px-3 py-2 text-sm text-gray-900 transition hover:bg-gray-100"
                              >
                                {key}
                              </div>
                            ))
                          )
                        ) : filteredValues.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">
                            No results found
                          </div>
                        ) : (
                          filteredValues.map((value) => (
                            <div
                              key={value}
                              onClick={() => addFilter(selectedKey, value)}
                              className="cursor-pointer rounded px-3 py-2 text-sm text-gray-900 transition hover:bg-gray-100"
                            >
                              {value}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {filteredScreenshots.length === 0 ? (
                <div className="py-12">
                  <p className="text-lg font-semibold text-gray-900">
                    No matching screenshots
                  </p>
                  <p className="mt-2 text-sm text-gray-600">
                    Try adjusting tags or filters
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {filteredScreenshots.map((shot, index) => (
                    <div
                      key={shot.id}
                      draggable
                      onDragStart={(e) => {
                        let idsToDrag: string[] = [];

                        if (selectedIds.includes(shot.id)) {
                          idsToDrag = selectedIds.map((id) => String(id));
                        } else {
                          idsToDrag = [shot.id];
                          setSelectedIds([shot.id]);
                        }

                        setDraggedScreenshotId(idsToDrag);
                        e.dataTransfer.setData("text/plain", JSON.stringify(idsToDrag));
                        e.dataTransfer.effectAllowed = "move";

                        // Use a small custom drag preview instead of full card image.
                        const ghost = document.createElement("div");
                        ghost.style.position = "fixed";
                        ghost.style.top = "-1000px";
                        ghost.style.left = "-1000px";
                        ghost.style.padding = "6px 10px";
                        ghost.style.borderRadius = "8px";
                        ghost.style.background = "rgba(17,24,39,0.92)";
                        ghost.style.color = "#fff";
                        ghost.style.fontSize = "12px";
                        ghost.style.fontWeight = "600";
                        ghost.style.pointerEvents = "none";
                        ghost.textContent =
                          idsToDrag.length > 1
                            ? `Moving ${idsToDrag.length} screenshots`
                            : "Moving screenshot";
                        document.body.appendChild(ghost);
                        e.dataTransfer.setDragImage(ghost, 12, 12);
                        window.setTimeout(() => {
                          ghost.remove();
                        }, 0);
                      }}
                      onDragEnd={() => {
                        setDraggedScreenshotId([]);
                        setHoverFolderId(null);
                      }}
                      title="Ctrl + Click to select multiple"
                      onClick={(e) => {
                        const isMulti = e.ctrlKey || e.metaKey;
                        const isShift = e.shiftKey;

                        if (isShift && lastSelectedIndex !== null) {
                          const start = Math.min(lastSelectedIndex, index);
                          const end = Math.max(lastSelectedIndex, index);

                          const rangeIds = filteredScreenshots
                            .slice(start, end + 1)
                            .map((s) => s.id);

                          setSelectedIds((prev) => [
                            ...new Set([...prev, ...rangeIds]),
                          ]);
                          setLastSelectedIndex(index);
                          return;
                        }

                        if (isMulti) {
                          e.preventDefault();
                          setSelectedIds((prev) =>
                            prev.includes(shot.id)
                              ? prev.filter((id) => id !== shot.id)
                              : [...prev, shot.id]
                          );
                          setLastSelectedIndex(index);
                          return;
                        }

                        setSelectedIndex(index);
                      }}
                      className={`group relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                        selectedIds.length > 0 ? "cursor-pointer" : ""
                      } ${
                        selectedIds.includes(shot.id)
                          ? "ring-2 ring-gray-900 scale-[0.98]"
                          : ""
                      }`}
                    >
                      {selectedIds.includes(shot.id) && (
                        <div className="absolute top-2 left-2 rounded bg-white p-1 shadow">
                          ✓
                        </div>
                      )}
                      <div className="relative h-48 w-full overflow-hidden bg-gray-100">
                        <img
                          src={shot.image_url}
                          draggable={false}
                          alt="Uploaded screenshot"
                          onLoad={() => handleImageLoaded(shot.id)}
                          className={`h-48 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
                            loadedImages[shot.id] ? "opacity-100" : "opacity-0"
                          }`}
                        />
                        <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/10" />
                        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          View
                        </div>
                      </div>

                      <div className="flex min-h-[3.5rem] flex-grow flex-col justify-center px-3 py-3">
                        {shot.tags && shot.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {shot.tags?.map((tag, i) => (
                              <span
                                key={`${shot.id}-${tag}-${i}`}
                                className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {selectedIds.length === 0 && (
                        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
                          <div className="whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
                            {multiSelectHint}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
              )}
            </>
          )}
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-4 rounded-xl bg-gray-900 text-white px-6 py-3 shadow-lg">
            <span className="text-sm">{selectedIds.length} selected</span>

            <button
              type="button"
              onClick={() => void openBulkModal()}
              className="text-sm underline"
            >
              Add Attribute
            </button>

            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Delete
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedIds([]);
                setLastSelectedIndex(null);
              }}
              className="text-sm text-gray-300 hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {draggedScreenshotId.length > 1 && (
        <div className="fixed bottom-6 right-6 rounded bg-gray-900 px-3 py-1 text-xs text-white shadow">
          {draggedScreenshotId.length} items
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <p className="mb-4 text-sm text-gray-900">
              Delete {selectedIds.length} screenshots?
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void handleBulkDelete()}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {false && (
        <div
          className={`fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-200 relative group ${
            modalEntered ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* ✅ Close when clicking background */}
          <div
            className="absolute inset-0"
            onClick={() => setSelectedIndex(null)}
          />

          {/* LEFT arrow */}
          {selectedIndex !== null && selectedIndex! > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIndex((prev) =>
                  prev !== null && prev > 0 ? prev - 1 : prev
                );
              }}
              className="
                absolute left-4 top-1/2 -translate-y-1/2
                z-[100000]
                text-white text-3xl
                bg-black/40
                w-12 h-12
                rounded-full
                flex items-center justify-center
                cursor-pointer
                transition-all duration-200
                opacity-0 group-hover:opacity-100
                hover:bg-black/60
              "
            >
              ←
            </button>
          )}

          {/* RIGHT arrow */}
          {selectedIndex !== null &&
            selectedIndex! < filteredScreenshots.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIndex((prev) =>
                    prev !== null && prev < filteredScreenshots.length - 1
                      ? prev + 1
                      : prev
                  );
                }}
                className="
                  absolute right-4 top-1/2 -translate-y-1/2
                  z-[100000]
                  text-white text-3xl
                  bg-black/40
                  w-12 h-12
                  rounded-full
                  flex items-center justify-center
                  cursor-pointer
                  transition-all duration-200
                  opacity-0 group-hover:opacity-100
                  hover:bg-black/60
                "
              >
                →
              </button>
            )}

          {/* Close (X) */}
          <button
            type="button"
            onClick={() => setSelectedIndex(null)}
            aria-label="Close modal"
            className="
              absolute top-4 right-4 z-[100000]
              text-white text-xl
              bg-black/50 hover:bg-black/70
              rounded-full w-10 h-10
              flex items-center justify-center
              transition
            "
          >
            ×
          </button>

          {/* Image */}
          <div
            className="relative z-10 transform transition-all duration-200 scale-95 opacity-0"
            style={{ animation: "fadeIn 0.2s ease-out forwards" }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={filteredScreenshots[selectedIndex!].image_url}
              alt=""
              className="max-h-[90vh] max-w-[90vw] origin-center animate-[fadeIn_0.2s_ease-out] rounded-md object-contain shadow-lg"
            />
          </div>

          {/* Counter */}
          <div
            className="
              absolute bottom-4 left-1/2 -translate-x-1/2
              z-50
              text-white text-sm
              bg-black/50 px-3 py-1 rounded-full
            "
          >
            {selectedIndex! + 1} / {filteredScreenshots.length}
          </div>
        </div>
      )}
      {mounted &&
        selectedImage &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/60 backdrop-blur-sm group">
            {/* Dismiss layer (behind sheet) */}
            <div
              className="absolute inset-0 z-0 cursor-pointer"
              onClick={() => setSelectedIndex(null)}
            />

            <div className="animate-[fadeIn_0.2s_ease-out] absolute inset-0 z-10 flex min-h-0 min-w-0 overflow-hidden bg-white shadow-xl">
              {/* LEFT: IMAGE */}
              <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
                <div className="flex h-full min-h-0 w-full items-center justify-center p-2">
                  <img
                    src={filteredScreenshots[selectedIndex!].image_url}
                    alt=""
                    className="max-h-full max-w-full w-auto cursor-default animate-[fadeIn_0.2s_ease-out] rounded-md object-contain shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>

              {/* RIGHT: PANEL — only this column scrolls when content is tall */}
              <div
                className={`box-border flex h-full min-h-0 ${isPanelOpen ? "w-[380px]" : "w-[48px]"} shrink-0 flex-col overflow-y-auto border-l border-gray-200 bg-gray-50 p-4 transition-all duration-300`}
              >
                <div className="mb-4 flex items-center justify-between">
                  {isPanelOpen && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Details
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsPanelOpen(!isPanelOpen)}
                    className="text-gray-500 transition hover:text-gray-900"
                  >
                    {isPanelOpen ? "→" : "←"}
                  </button>
                </div>

                {isPanelOpen && (
                  <div className="space-y-6">
                    {/* ATTRIBUTES */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Attributes
                      </p>

                      <datalist id="dashboard-trade-attr-keys">
                        {uniqueKeys.map((k) => (
                          <option key={k} value={k} />
                        ))}
                      </datalist>
                      <datalist id="dashboard-trade-attr-values">
                        {allUniqueAttributeValues.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>

                      <div className="mt-2 space-y-2">
                        {attributes.map((attr, index) => (
                          <div
                            key={attr.id ?? index}
                            className="group flex items-center gap-2"
                          >
                            <div className="flex min-w-0 flex-1 gap-2">
                              <input
                                value={attr.key || ""}
                                onChange={(e) => {
                                  const updated = [...attributes];
                                  updated[index].key = e.target.value;
                                  setAttributes(updated);
                                }}
                                placeholder="Field"
                                list="dashboard-trade-attr-keys"
                                autoComplete="off"
                                className="w-1/2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
                              />

                              <input
                                value={attr.value || ""}
                                onChange={(e) => {
                                  const updated = [...attributes];
                                  updated[index].value = e.target.value;
                                  setAttributes(updated);
                                }}
                                placeholder="Value"
                                list="dashboard-trade-attr-values"
                                autoComplete="off"
                                className="w-1/2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
                              />
                            </div>

                            <button
                              type="button"
                              aria-label="Remove attribute row"
                              onClick={() => handleDeleteAttribute(index)}
                              className="shrink-0 text-sm text-gray-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setAttributes([
                            ...attributes,
                            { id: `tmp-${Date.now()}-${Math.random()}`, key: "", value: "" },
                          ])
                        }
                        className="mt-3 text-sm text-blue-600 hover:underline"
                      >
                        + Add field
                      </button>

                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleSaveAttributes();
                        }}
                        disabled={savingAttributes}
                        className="mt-3 w-full rounded-lg bg-gray-900 py-2 text-sm font-medium text-white transition hover:bg-gray-800 active:scale-[0.98] disabled:active:scale-100"
                      >
                        {savingAttributes ? "Saving attributes..." : "Save attributes"}
                      </button>

                      {savedAttributesToast && (
                        <div className="mt-2 text-xs font-medium text-green-700">
                          Saved ✓
                        </div>
                      )}
                    </div>

                    {/* NOTES */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Notes
                      </p>
                      <textarea
                        value={currentNote}
                        onChange={(e) => setCurrentNote(e.target.value)}
                        placeholder="Write your trade thoughts..."
                        className="mt-2 w-full h-24 rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-900"
                      />

                      <button
                        type="button"
                        onClick={handleSaveNote}
                        disabled={savingNote}
                        className="mt-2 w-full rounded-lg bg-gray-900 py-2 text-sm font-medium text-white transition hover:bg-gray-800 active:scale-[0.98] disabled:active:scale-100"
                      >
                        {savingNote ? "Saving note..." : "Save note"}
                      </button>

                      {savedNoteToast && (
                        <div className="mt-2 text-xs font-medium text-green-700">
                          Saved ✓
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed controls — above sheet + image so they’re never covered or clipped */}
            <button
              type="button"
              onClick={() => setSelectedIndex(null)}
              aria-label="Close modal"
              className="fixed top-4 z-[2147483646] flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-xl text-white shadow-lg ring-2 ring-white/30 transition hover:bg-zinc-800"
              style={{
                right: `clamp(1rem, calc(${panelWidth}px + 1rem), calc(100vw - 3rem))`,
              }}
            >
              ×
            </button>

            {selectedIndex !== null && selectedIndex! > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIndex((prev) =>
                    prev !== null && prev > 0 ? prev - 1 : prev
                  );
                }}
                className="
                  fixed left-4 top-1/2 z-[2147483646] -translate-y-1/2
                  flex h-12 w-12 items-center justify-center rounded-full
                  bg-black/50 text-3xl text-white shadow-lg
                  opacity-0 transition-all duration-200 hover:bg-black/70
                  group-hover:opacity-100
                "
              >
                ←
              </button>
            )}

            {selectedIndex !== null &&
              selectedIndex! < filteredScreenshots.length - 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedIndex((prev) =>
                      prev !== null && prev < filteredScreenshots.length - 1
                        ? prev + 1
                        : prev
                    );
                  }}
                  className="
                    fixed top-1/2 z-[2147483646] -translate-y-1/2
                    flex h-12 w-12 items-center justify-center rounded-full
                    bg-black/50 text-3xl text-white shadow-lg
                    opacity-0 transition-all duration-200 hover:bg-black/70
                    group-hover:opacity-100
                  "
                  style={{
                    right: `clamp(1rem, calc(${panelWidth}px + 1rem), calc(100vw - 3rem))`,
                  }}
                >
                  →
                </button>
              )}

            <div
              className="fixed bottom-4 left-1/2 z-[2147483645] -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white"
            >
              {selectedIndex! + 1} / {filteredScreenshots.length}
            </div>

            {undoData && (
              <div
                className="pointer-events-none fixed inset-x-0 bottom-0 z-[2147483647] flex justify-center pb-6"
                role="status"
              >
                <div className="pointer-events-auto flex max-w-[min(100vw-2rem,28rem)] items-center gap-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-xl">
                  <span>Attribute removed</span>
                  <button
                    type="button"
                    onClick={() => void handleUndo()}
                    className="underline hover:text-gray-300"
                  >
                    Undo
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body
        )}

      {undoData &&
        !selectedImage &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[2147483647] flex justify-center pb-6"
            role="status"
          >
            <div className="pointer-events-auto flex max-w-[min(100vw-2rem,28rem)] items-center gap-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-xl">
              <span>Attribute removed</span>
              <button
                type="button"
                onClick={() => void handleUndo()}
                className="underline hover:text-gray-300"
              >
                Undo
              </button>
            </div>
          </div>,
          document.body
        )}

      {isCommandOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/40 pt-32"
          onClick={() => setIsCommandOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden"
          >
            <input
              autoFocus
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              placeholder="Search screenshots, views..."
              className="w-full border-b border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none"
            />

            <div className="max-h-80 overflow-y-auto">
              {commandViewResults.length > 0 && (
                <div className="border-b border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Saved Views
                </div>
              )}
              {commandViewResults.map((view) => {
                const flatIndex = commandItems.findIndex(
                  (item) => item.type === "view" && item.id === String(view.id)
                );
                return (
                  <div
                    key={`view-${view.id}`}
                    onClick={() =>
                      executeCommandItem({
                        type: "view",
                        id: String(view.id),
                        label: String(view.name ?? ""),
                        payload: view,
                      })
                    }
                    className={`cursor-pointer px-4 py-2 text-sm text-gray-800 hover:bg-gray-100 ${
                      flatIndex === commandActiveIndex ? "bg-gray-100" : ""
                    }`}
                  >
                    🔎 {view.name}
                  </div>
                );
              })}

              {commandScreenshotResults.length > 0 && (
                <div className="border-b border-t border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Screenshots
                </div>
              )}
              {commandScreenshotResults.map((shot) => {
                const flatIndex = commandItems.findIndex(
                  (item) =>
                    item.type === "screenshot" && item.id === String(shot.id)
                );
                const preview =
                  shot.tags && shot.tags.length > 0
                    ? shot.tags.join(", ")
                    : shot.notes || "Open screenshot";
                return (
                  <div
                    key={`shot-${shot.id}`}
                    onClick={() =>
                      executeCommandItem({
                        type: "screenshot",
                        id: String(shot.id),
                        label: String(preview),
                        payload: shot,
                      })
                    }
                    className={`cursor-pointer px-4 py-2 text-sm text-gray-800 hover:bg-gray-100 ${
                      flatIndex === commandActiveIndex ? "bg-gray-100" : ""
                    }`}
                  >
                    🖼 {preview}
                  </div>
                );
              })}

              {commandItems.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-500">
                  No results found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

