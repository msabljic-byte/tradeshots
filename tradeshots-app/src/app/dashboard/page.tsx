"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  folder_id?: string | null;
  annotation?: unknown; // legacy
  annotations?: unknown; // structured JSON (preferred)
};

type AnnotationShape =
  | {
      id: string;
      kind: "path";
      color: string;
      size: number;
      points: Array<{ x: number; y: number }>;
    }
  | {
      id: string;
      kind: "arrow";
      color: string;
      size: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }
  | {
      id: string;
      kind: "text";
      color: string;
      size: number;
      x: number;
      y: number;
      text: string;
    }
  | {
      id: string;
      kind: "highlight";
      color: string;
      size: number;
      opacity: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

function parseAnnotationValue(raw: unknown): {
  image: string;
  shapes: AnnotationShape[];
} {
  if (raw == null) return { image: "", shapes: [] };

  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return { image: "", shapes: [] };
    if (value.startsWith("data:image/")) {
      return { image: value, shapes: [] };
    }
    try {
      return parseAnnotationValue(JSON.parse(value));
    } catch {
      return { image: value, shapes: [] };
    }
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const image = typeof obj.image === "string" ? obj.image : "";
    const shapesRaw = Array.isArray(obj.shapes)
      ? (obj.shapes as AnnotationShape[])
      : [];
    const shapes = shapesRaw.map((shape) => {
      if (shape.kind !== "highlight") return shape;
      return {
        ...shape,
        opacity:
          typeof (shape as any).opacity === "number"
            ? Math.max(0.05, Math.min(1, (shape as any).opacity))
            : 0.18,
      } as AnnotationShape;
    });
    // If serialized twice, decode nested payload too.
    if (!image && !shapes.length && typeof obj.annotation === "string") {
      return parseAnnotationValue(obj.annotation);
    }
    if (!image && !shapes.length && obj.annotations != null) {
      return parseAnnotationValue(obj.annotations);
    }
    return { image, shapes };
  }

  return { image: "", shapes: [] };
}

const LOCAL_ANNOTATIONS_KEY = "tradeshots.localAnnotations.v1";

function readLocalAnnotations(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_ANNOTATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalAnnotation(screenshotId: string, annotationPayload: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = readLocalAnnotations();
    existing[screenshotId] = annotationPayload;
    window.localStorage.setItem(LOCAL_ANNOTATIONS_KEY, JSON.stringify(existing));
  } catch {
    // Ignore localStorage write failures.
  }
}

function getLocalAnnotation(screenshotId: string): string | null {
  const existing = readLocalAnnotations();
  return existing[screenshotId] ?? null;
}

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
  const [allScreenshots, setAllScreenshots] = useState<any[]>([]);
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
  const [showMoveMenu, setShowMoveMenu] = useState(false);
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
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
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
  const [toast, setToast] = useState<string | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isMacPlatform, setIsMacPlatform] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<
    "select" | "draw" | "arrow" | "text" | "highlight"
  >("draw");
  const [strokeColor, setStrokeColor] = useState("#ef4444");
  const [strokeSize, setStrokeSize] = useState(3);
  const [highlightOpacity, setHighlightOpacity] = useState(0.18);
  const [textDraft, setTextDraft] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [annotationHistory, setAnnotationHistory] = useState<AnnotationShape[][]>([]);
  const [annotationHistoryIndex, setAnnotationHistoryIndex] = useState(-1);
  const [annotationShapes, setAnnotationShapes] = useState<AnnotationShape[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [isDraggingAnnotation, setIsDraggingAnnotation] = useState(false);
  const [annotationBaseDataUrl, setAnnotationBaseDataUrl] = useState("");
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const drawStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingRef = useRef(false);
  const isDraggingAnnotationRef = useRef(false);
  const dragStartPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStartShapeRef = useRef<AnnotationShape | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const multiSelectHint = isMacPlatform
      ? "⌘ to select • ⇧ to select range"
      : "Ctrl to select • Shift to select range";

  function handleImageLoaded(id: string) {
    setLoadedImages((prev) => ({ ...prev, [id]: true }));
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 2000);
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
      setAllScreenshots([]);
      setLoading(false);
      return;
    }

    const initial = await supabase
      .from("screenshots")
      .select("id, image_url, created_at, tags, notes, folder_id, annotations, annotation")
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });
    let data: any[] | null = initial.data as any[] | null;
    let screenshotsError = initial.error;

    // Graceful fallback for databases that don't yet have `annotations`/`annotation` columns.
    if (
      screenshotsError &&
      (screenshotsError.message.toLowerCase().includes("annotations") ||
        screenshotsError.message.toLowerCase().includes("annotation"))
    ) {
      const fallbackLegacy = await supabase
        .from("screenshots")
        .select("id, image_url, created_at, tags, notes, folder_id, annotation")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      data = fallbackLegacy.data;
      screenshotsError = fallbackLegacy.error;
    }

    // Final fallback when neither annotation column exists.
    if (
      screenshotsError &&
      screenshotsError.message.toLowerCase().includes("annotation")
    ) {
      const fallbackBase = await supabase
        .from("screenshots")
        .select("id, image_url, created_at, tags, notes, folder_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      data = fallbackBase.data;
      screenshotsError = fallbackBase.error;
    }

    if (screenshotsError) {
      setError(screenshotsError.message);
      setScreenshots([]);
      setAllScreenshots([]);
      setAttributeKeyValuesByScreenshot({});
    } else {
      setError(null);
      const allRows = (data ?? []) as any[];
      const hydratedRows = allRows.map((row) => {
        const sid = String(row?.id ?? "");
        if (!sid) return row;
        const local = getLocalAnnotation(sid);
        if (!local) return row;
        return {
          ...row,
          annotations: local,
          annotation: local,
        };
      });
      setAllScreenshots(hydratedRows);

      const screenshotRows = (activeFolderId
        ? hydratedRows.filter((s) => s.folder_id === activeFolderId)
        : hydratedRows) as ScreenshotRow[];
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

  async function renameFolder(folderId: string, currentName: string) {
    const newName = prompt("Rename folder", currentName);
    if (!newName || newName === currentName) return;

    await supabase
      .from("folders")
      .update({ name: newName })
      .eq("id", folderId);

    await fetchFolders();
  }

  async function deleteFolder(folderId: string | null) {
    if (!folderId) return;

    await supabase
      .from("folders")
      .delete()
      .eq("id", folderId);

    setFolderToDelete(null);

    if (activeFolderId === folderId) {
      setActiveFolderId(null);
    }

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

  function getFolderCount(folderId: string) {
    return allScreenshots.filter((s: any) => s.folder_id === folderId).length;
  }

  function generateShareId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().slice(0, 8);
    }

    return Math.random().toString(36).substring(2, 10);
  }

  async function handleShareFolder(folder: any) {
    let shareId = String(folder?.share_id ?? "");

    if (!shareId) {
      shareId = generateShareId();
      const { error: shareError } = await supabase
        .from("folders")
        .update({ share_id: shareId })
        .eq("id", folder.id);

      if (shareError) {
        setError(
          shareError.message.toLowerCase().includes("share_id")
            ? "folders.share_id column is missing. Please run DB migration to enable sharing."
            : shareError.message
        );
        return;
      }

      await fetchFolders();
    }

    const url = `${window.location.origin}/playbook/${shareId}`;
    await navigator.clipboard.writeText(url);
    showToast("Link copied ✓");
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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();

        const tagFilterLower = tagFilter.trim().toLowerCase();
        const visible = screenshots.filter((s) => {
          const matchesTag =
            !tagFilterLower ||
            s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

          if (filters.length === 0) return matchesTag;

          const keyMap = attributeKeyValuesByScreenshot[s.id] ?? {};
          const matchesAttributes = filters.every((filter) =>
            (keyMap[filter.key] ?? []).includes(filter.value)
          );

          return matchesTag && matchesAttributes;
        });

        setSelectedIds(visible.map((s) => s.id));
      }

      if (e.key === "Escape") {
        setSelectedIds([]);
        setIsCommandOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screenshots, tagFilter, filters, attributeKeyValuesByScreenshot]);

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

  function pushShapesHistory(nextShapes: AnnotationShape[]) {
    setAnnotationHistory((prev) => {
      const trimmed = prev.slice(0, annotationHistoryIndex + 1);
      const snapshot = nextShapes.map((s) => JSON.parse(JSON.stringify(s)));
      const next = [...trimmed, snapshot];
      setAnnotationHistoryIndex(next.length - 1);
      return next;
    });
  }

  function applyShapes(nextShapes: AnnotationShape[], options?: { pushHistory?: boolean }) {
    setAnnotationShapes(nextShapes);
    if (options?.pushHistory !== false) {
      pushShapesHistory(nextShapes);
    }
  }

  function translateShape(shape: AnnotationShape, dx: number, dy: number): AnnotationShape {
    if (shape.kind === "path") {
      return {
        ...shape,
        points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    }
    if (shape.kind === "arrow") {
      return {
        ...shape,
        fromX: shape.fromX + dx,
        fromY: shape.fromY + dy,
        toX: shape.toX + dx,
        toY: shape.toY + dy,
      };
    }
    if (shape.kind === "text") {
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    }
    return { ...shape, x: shape.x + dx, y: shape.y + dy };
  }

  function drawArrowShape(
    ctx: CanvasRenderingContext2D,
    shape: Extract<AnnotationShape, { kind: "arrow" }>
  ) {
    const distance = Math.hypot(shape.toX - shape.fromX, shape.toY - shape.fromY);
    const headLength = Math.max(8, Math.min(24, distance * 0.2));
    const angle = Math.atan2(shape.toY - shape.fromY, shape.toX - shape.fromX);
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.size;
    ctx.beginPath();
    ctx.moveTo(shape.fromX, shape.fromY);
    ctx.lineTo(shape.toX, shape.toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(shape.toX, shape.toY);
    ctx.lineTo(
      shape.toX - headLength * Math.cos(angle - Math.PI / 6),
      shape.toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      shape.toX - headLength * Math.cos(angle + Math.PI / 6),
      shape.toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.lineTo(shape.toX, shape.toY);
    ctx.fillStyle = shape.color;
    ctx.fill();
  }

  function drawHighlightShape(
    ctx: CanvasRenderingContext2D,
    shape: Extract<AnnotationShape, { kind: "highlight" }>
  ) {
    const x = shape.width >= 0 ? shape.x : shape.x + shape.width;
    const y = shape.height >= 0 ? shape.y : shape.y + shape.height;
    const w = Math.abs(shape.width);
    const h = Math.abs(shape.height);
    if (w < 1 || h < 1) return;

    ctx.save();
    // Marker-like translucent fill so image remains visible underneath.
    ctx.fillStyle = shape.color;
    ctx.globalAlpha = Math.max(0.05, Math.min(1, shape.opacity ?? 0.18));
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = Math.max(1, shape.size);
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawShapes(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    shapes: AnnotationShape[],
    selectedId: string | null
  ) {
    for (const shape of shapes) {
      if (shape.kind === "path") {
        if (shape.points.length < 2) continue;
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) {
          ctx.lineTo(shape.points[i].x, shape.points[i].y);
        }
        ctx.stroke();
      } else if (shape.kind === "arrow") {
        drawArrowShape(ctx, shape);
      } else if (shape.kind === "highlight") {
        drawHighlightShape(ctx, shape);
      } else if (shape.kind === "text") {
        const fontSize = Math.max(14, 12 + shape.size * 2);
        ctx.fillStyle = shape.color;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(shape.text, shape.x, shape.y);
      }

      if (selectedId && shape.id === selectedId) {
        let minX = 0;
        let minY = 0;
        let maxX = 0;
        let maxY = 0;
        if (shape.kind === "path") {
          const xs = shape.points.map((p) => p.x);
          const ys = shape.points.map((p) => p.y);
          minX = Math.min(...xs);
          minY = Math.min(...ys);
          maxX = Math.max(...xs);
          maxY = Math.max(...ys);
        } else if (shape.kind === "arrow") {
          minX = Math.min(shape.fromX, shape.toX);
          minY = Math.min(shape.fromY, shape.toY);
          maxX = Math.max(shape.fromX, shape.toX);
          maxY = Math.max(shape.fromY, shape.toY);
        } else if (shape.kind === "text") {
          const fontSize = Math.max(14, 12 + shape.size * 2);
          const width = Math.max(fontSize, ctx.measureText(shape.text).width);
          minX = shape.x;
          minY = shape.y;
          maxX = shape.x + width;
          maxY = shape.y + fontSize;
        } else {
          minX = Math.min(shape.x, shape.x + shape.width);
          minY = Math.min(shape.y, shape.y + shape.height);
          maxX = Math.max(shape.x, shape.x + shape.width);
          maxY = Math.max(shape.y, shape.y + shape.height);
        }
        const pad = 8;
        ctx.save();
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const boxX = Math.max(0, minX - pad);
        const boxY = Math.max(0, minY - pad);
        const boxW = Math.min(canvas.width, maxX - minX + pad * 2);
        const boxH = Math.min(canvas.height, maxY - minY + pad * 2);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.setLineDash([]);
        // Small corner handles as a move affordance.
        const handle = 6;
        const corners: Array<{ x: number; y: number }> = [
          { x: boxX, y: boxY },
          { x: boxX + boxW, y: boxY },
          { x: boxX, y: boxY + boxH },
          { x: boxX + boxW, y: boxY + boxH },
        ];
        ctx.fillStyle = "#2563eb";
        for (const corner of corners) {
          ctx.fillRect(corner.x - handle / 2, corner.y - handle / 2, handle, handle);
        }
        ctx.fillStyle = "#ffffff";
        for (const corner of corners) {
          ctx.fillRect(corner.x - 1.5, corner.y - 1.5, 3, 3);
        }
        ctx.restore();
      } else if (hoveredAnnotationId && shape.id === hoveredAnnotationId) {
        let minX = 0;
        let minY = 0;
        let maxX = 0;
        let maxY = 0;
        if (shape.kind === "path") {
          const xs = shape.points.map((p) => p.x);
          const ys = shape.points.map((p) => p.y);
          minX = Math.min(...xs);
          minY = Math.min(...ys);
          maxX = Math.max(...xs);
          maxY = Math.max(...ys);
        } else if (shape.kind === "arrow") {
          minX = Math.min(shape.fromX, shape.toX);
          minY = Math.min(shape.fromY, shape.toY);
          maxX = Math.max(shape.fromX, shape.toX);
          maxY = Math.max(shape.fromY, shape.toY);
        } else if (shape.kind === "text") {
          const fontSize = Math.max(14, 12 + shape.size * 2);
          const width = Math.max(fontSize, ctx.measureText(shape.text).width);
          minX = shape.x;
          minY = shape.y;
          maxX = shape.x + width;
          maxY = shape.y + fontSize;
        } else {
          minX = Math.min(shape.x, shape.x + shape.width);
          minY = Math.min(shape.y, shape.y + shape.height);
          maxX = Math.max(shape.x, shape.x + shape.width);
          maxY = Math.max(shape.y, shape.y + shape.height);
        }
        const pad = 6;
        ctx.save();
        ctx.strokeStyle = "#60a5fa";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(
          Math.max(0, minX - pad),
          Math.max(0, minY - pad),
          Math.min(canvas.width, maxX - minX + pad * 2),
          Math.min(canvas.height, maxY - minY + pad * 2)
        );
        ctx.restore();
      }
    }
  }

  function redrawCanvasWithShapes() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!annotationBaseDataUrl) {
      drawShapes(ctx, canvas, annotationShapes, selectedAnnotationId);
      return;
    }
    const img = new Image();
    img.src = annotationBaseDataUrl;
    img.onload = () => {
      const nextCanvas = canvasRef.current;
      if (!nextCanvas) return;
      const nextCtx = nextCanvas.getContext("2d");
      if (!nextCtx) return;
      nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
      nextCtx.drawImage(img, 0, 0, nextCanvas.width, nextCanvas.height);
      drawShapes(nextCtx, nextCanvas, annotationShapes, selectedAnnotationId);
    };
  }

  function handleUndoAnnotation() {
    if (annotationHistoryIndex <= 0) return;
    const nextIndex = annotationHistoryIndex - 1;
    const snapshot = annotationHistory[nextIndex];
    if (!snapshot) return;
    setAnnotationHistoryIndex(nextIndex);
    setAnnotationShapes(snapshot.map((s) => JSON.parse(JSON.stringify(s))));
    setSelectedAnnotationId(null);
  }

  function handleRedoAnnotation() {
    if (annotationHistoryIndex < 0) return;
    if (annotationHistoryIndex >= annotationHistory.length - 1) return;
    const nextIndex = annotationHistoryIndex + 1;
    const snapshot = annotationHistory[nextIndex];
    if (!snapshot) return;
    setAnnotationHistoryIndex(nextIndex);
    setAnnotationShapes(snapshot.map((s) => JSON.parse(JSON.stringify(s))));
    setSelectedAnnotationId(null);
  }

  function clearAnnotationCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyShapes([], { pushHistory: true });
    setSelectedAnnotationId(null);
  }

  function applyTextDraft() {
    if (!textDraft) return;
    const text = textDraft.text.trim();
    if (!text) {
      setTextDraft(null);
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    applyShapes(
      [
        ...annotationShapes,
        {
          id,
          kind: "text",
          x: textDraft.x,
          y: textDraft.y,
          text,
          color: strokeColor,
          size: strokeSize,
        },
      ],
      { pushHistory: true }
    );
    setSelectedAnnotationId(null);
    setTextDraft(null);
  }

  function deleteSelectedAnnotation() {
    if (!selectedAnnotationId) return;
    applyShapes(
      annotationShapes.filter((shape) => shape.id !== selectedAnnotationId),
      { pushHistory: true }
    );
    setSelectedAnnotationId(null);
  }

  async function exportMergedImage() {
    if (!selectedImage) return;
    const annotationCanvas = canvasRef.current;
    if (!annotationCanvas) return;

    setError(null);
    try {
      const baseImage = new Image();
      baseImage.crossOrigin = "anonymous";
      baseImage.src = selectedImage.image_url;
      await new Promise<void>((resolve, reject) => {
        baseImage.onload = () => resolve();
        baseImage.onerror = () => reject(new Error("Failed to load base image"));
      });

      const mergedCanvas = document.createElement("canvas");
      mergedCanvas.width = baseImage.naturalWidth || annotationCanvas.width;
      mergedCanvas.height = baseImage.naturalHeight || annotationCanvas.height;
      const mergedCtx = mergedCanvas.getContext("2d");
      if (!mergedCtx) return;

      mergedCtx.drawImage(baseImage, 0, 0, mergedCanvas.width, mergedCanvas.height);
      if (annotationBaseDataUrl) {
        const img = new Image();
        img.src = annotationBaseDataUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to render annotation base"));
        });
        mergedCtx.drawImage(img, 0, 0, mergedCanvas.width, mergedCanvas.height);
      }
      drawShapes(mergedCtx, mergedCanvas, annotationShapes, null);

      const url = mergedCanvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = `tradeshot-${selectedImage.id}.png`;
      link.click();
    } catch (err: any) {
      setError(err?.message ?? "Failed to export merged image.");
    }
  }

  async function saveAnnotation() {
    if (!selectedImage?.id) return;

    setSavingAnnotation(true);
    try {
      const payloadObject = {
        version: 2,
        // Keep editable shapes as source of truth.
        // If shapes exist, do not keep a baked overlay image.
        image: annotationShapes.length > 0 ? "" : annotationBaseDataUrl,
        shapes: annotationShapes,
      };
      writeLocalAnnotation(selectedImage.id, JSON.stringify(payloadObject));

      const { error: annotationError } = await supabase
        .from("screenshots")
        .update({ annotations: payloadObject })
        .eq("id", selectedImage.id);

      if (annotationError) {
        const msg = annotationError.message.toLowerCase();
        if (msg.includes("annotations")) {
          // New column missing: attempt legacy column.
          const payload = JSON.stringify(payloadObject);
          const legacy = await supabase
            .from("screenshots")
            .update({ annotation: payload })
            .eq("id", selectedImage.id);
          if (!legacy.error) {
            setError(null);
            setScreenshots((prev) =>
              prev.map((s) =>
                s.id === selectedImage.id
                  ? { ...s, annotations: payloadObject, annotation: payload }
                  : s
              )
            );
            setAllScreenshots((prev: any[]) =>
              prev.map((s) =>
                s.id === selectedImage.id
                  ? { ...s, annotations: payloadObject, annotation: payload }
                  : s
              )
            );
            return;
          }
        }
        if (msg.includes("annotation")) {
          // Column missing: keep working with local fallback without showing blocking error.
          setError(null);
          setScreenshots((prev) =>
            prev.map((s) =>
              s.id === selectedImage.id
                ? { ...s, annotations: payloadObject, annotation: payloadObject }
                : s
            )
          );
          setAllScreenshots((prev: any[]) =>
            prev.map((s) =>
              s.id === selectedImage.id
                ? { ...s, annotations: payloadObject, annotation: payloadObject }
                : s
            )
          );
          return;
        }
        setError(
          annotationError.message
        );
        return;
      }

      // Keep list data in sync without forcing a full refetch.
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === selectedImage.id
            ? { ...s, annotations: payloadObject, annotation: payloadObject }
            : s
        )
      );
      setAllScreenshots((prev: any[]) =>
        prev.map((s) =>
          s.id === selectedImage.id
            ? { ...s, annotations: payloadObject, annotation: payloadObject }
            : s
        )
      );
    } finally {
      setSavingAnnotation(false);
    }
  }

  async function moveToFolder(folderId: string) {
    if (!selectedIds.length) return;

    await supabase
      .from("screenshots")
      .update({ folder_id: folderId })
      .in("id", selectedIds);

    setSelectedIds([]);
    setShowMoveMenu(false);

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
                className="truncate text-sm"
              >
                📁 {folder.name}
              </span>

              <span
                className={`ml-auto text-xs ${
                  isActive ? "text-white/70" : "text-gray-400"
                }`}
              >
                {getFolderCount(folder.id)}
              </span>

              <div className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleShareFolder(folder);
                  }}
                  className={`text-sm ${
                    isActive ? "text-white/80 hover:text-white" : "text-gray-400 hover:text-gray-700"
                  }`}
                  title="Copy public link"
                >
                  🔗
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void renameFolder(folder.id, folder.name);
                  }}
                  className={`text-sm ${
                    isActive ? "text-white/80 hover:text-white" : "text-gray-400 hover:text-gray-700"
                  }`}
                >
                  ✏️
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderToDelete(folder.id);
                  }}
                  className={`text-sm ${
                    isActive ? "text-white/80 hover:text-red-200" : "text-gray-400 hover:text-red-600"
                  }`}
                >
                  ✕
                </button>
              </div>
            </div>

            {isExpanded && renderFolders(folder.id, level + 1)}
          </div>
        );
      });
  }

  function renderFolderOptions(parentId: string | null = null, level = 0) {
    return folders
      .filter((f: any) => f.parent_id === parentId)
      .map((folder: any) => (
        <div key={`move-${folder.id}`}>
          <button
            type="button"
            onClick={() => void moveToFolder(folder.id)}
            className="w-full rounded px-3 py-2 text-left text-sm text-gray-800 transition hover:bg-gray-100"
            style={{ paddingLeft: `${12 + level * 16}px` }}
          >
            📁 {folder.name}
          </button>

          {renderFolderOptions(folder.id, level + 1)}
        </div>
      ));
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

  function distancePointToSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(
      0,
      Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))
    );
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function findShapeAtPoint(x: number, y: number): string | null {
    for (let i = annotationShapes.length - 1; i >= 0; i--) {
      const shape = annotationShapes[i];
      if (shape.kind === "text") {
        const size = Math.max(14, 12 + shape.size * 2);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx) {
          ctx.font = `${size}px sans-serif`;
          const width = ctx.measureText(shape.text).width;
          if (x >= shape.x && x <= shape.x + width && y >= shape.y && y <= shape.y + size) {
            return shape.id;
          }
        }
      } else if (shape.kind === "arrow") {
        if (
          distancePointToSegment(x, y, shape.fromX, shape.fromY, shape.toX, shape.toY) <=
          Math.max(8, shape.size + 4)
        ) {
          return shape.id;
        }
      } else if (shape.kind === "highlight") {
        const left = Math.min(shape.x, shape.x + shape.width);
        const top = Math.min(shape.y, shape.y + shape.height);
        const right = Math.max(shape.x, shape.x + shape.width);
        const bottom = Math.max(shape.y, shape.y + shape.height);
        const inside = x >= left && x <= right && y >= top && y <= bottom;
        if (inside) return shape.id;
      } else if (shape.kind === "path") {
        for (let j = 1; j < shape.points.length; j++) {
          const p1 = shape.points[j - 1];
          const p2 = shape.points[j];
          if (
            distancePointToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <=
            Math.max(8, shape.size + 4)
          ) {
            return shape.id;
          }
        }
      }
    }
    return null;
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

  useEffect(() => {
    if (!selectedImage) return;
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const resize = () => {
      const width = Math.max(1, Math.floor(image.clientWidth));
      const height = Math.max(1, Math.floor(image.clientHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    resize();
    redrawCanvasWithShapes();

    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [
    selectedImage?.id,
    isPanelOpen,
    annotationBaseDataUrl,
    annotationShapes,
    selectedAnnotationId,
  ]);

  useEffect(() => {
    if (!selectedImage) return;
    const parsed = parseAnnotationValue(
      selectedImage.annotations ?? selectedImage.annotation
    );
    const baseDataUrl = parsed.shapes.length > 0 ? "" : parsed.image;
    const shapes = parsed.shapes;

    setAnnotationBaseDataUrl(baseDataUrl);
    setAnnotationShapes(shapes);
    setAnnotationHistory([shapes.map((s) => JSON.parse(JSON.stringify(s)))]);
    setAnnotationHistoryIndex(0);
    setSelectedAnnotationId(null);
    setHoveredAnnotationId(null);
    setIsDraggingAnnotation(false);
    setTextDraft(null);
  }, [selectedImage?.id]);

  useEffect(() => {
    if (!selectedImage) return;
    function handleDeleteKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selectedAnnotationId) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      deleteSelectedAnnotation();
    }
    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [selectedImage?.id, selectedAnnotationId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasEl = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const context = ctx;

    function getPoint(e: MouseEvent) {
      const rect = canvasEl.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    function handleMouseDown(e: MouseEvent) {
      const { x, y } = getPoint(e);
      if (tool === "text") {
        if (selectedAnnotationId !== null) {
          setSelectedAnnotationId(null);
        }
        setTextDraft({ x, y, text: "" });
        isDrawingRef.current = false;
        setIsDrawing(false);
        return;
      }

      if (tool === "select") {
        const hitId = findShapeAtPoint(x, y);
        setSelectedAnnotationId(hitId);
        setHoveredAnnotationId(hitId);
        if (hitId) {
          const selected = annotationShapes.find((s) => s.id === hitId) ?? null;
          if (selected) {
            dragStartShapeRef.current = JSON.parse(JSON.stringify(selected));
            dragStartPointRef.current = { x, y };
            isDraggingAnnotationRef.current = true;
            setIsDraggingAnnotation(true);
          }
        } else {
          dragStartShapeRef.current = null;
          isDraggingAnnotationRef.current = false;
          setIsDraggingAnnotation(false);
        }
        isDrawingRef.current = false;
        setIsDrawing(false);
        return;
      }

      if (selectedAnnotationId !== null) {
        setSelectedAnnotationId(null);
      }

      isDrawingRef.current = true;
      setIsDrawing(true);
      drawStartRef.current = { x, y };

      if (tool === "draw") {
        currentPathRef.current = [{ x, y }];
      }

    }

    function handleMouseMove(e: MouseEvent) {
      const { x, y } = getPoint(e);
      if (tool === "select" && isDraggingAnnotationRef.current && selectedAnnotationId) {
        const seed = dragStartShapeRef.current;
        if (!seed) return;
        const dx = x - dragStartPointRef.current.x;
        const dy = y - dragStartPointRef.current.y;
        setAnnotationShapes((prev) =>
          prev.map((shape) =>
            shape.id === selectedAnnotationId ? translateShape(seed, dx, dy) : shape
          )
        );
        return;
      }
      if (tool === "select") {
        const hitId = findShapeAtPoint(x, y);
        setHoveredAnnotationId((prev) => (prev === hitId ? prev : hitId));
        return;
      }

      if (!isDrawingRef.current) return;

      if (tool === "draw") {
        currentPathRef.current.push({ x, y });
        redrawCanvasWithShapes();
        context.strokeStyle = strokeColor;
        context.lineWidth = strokeSize;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(currentPathRef.current[0].x, currentPathRef.current[0].y);
        for (let i = 1; i < currentPathRef.current.length; i++) {
          context.lineTo(currentPathRef.current[i].x, currentPathRef.current[i].y);
        }
        context.stroke();
      }

      if (tool === "arrow") {
        redrawCanvasWithShapes();
        drawArrow(drawStartRef.current.x, drawStartRef.current.y, x, y);
      }

      if (tool === "highlight") {
        redrawCanvasWithShapes();
        const previewShape: Extract<AnnotationShape, { kind: "highlight" }> = {
          id: "preview",
          kind: "highlight",
          color: strokeColor,
          size: strokeSize,
          opacity: highlightOpacity,
          x: drawStartRef.current.x,
          y: drawStartRef.current.y,
          width: x - drawStartRef.current.x,
          height: y - drawStartRef.current.y,
        };
        drawHighlightShape(context, previewShape);
      }
    }

    function drawArrow(fromX: number, fromY: number, toX: number, toY: number) {
      const distance = Math.hypot(toX - fromX, toY - fromY);
      const headLength = Math.max(8, Math.min(24, distance * 0.2));
      const angle = Math.atan2(toY - fromY, toX - fromX);
      context.strokeStyle = strokeColor;
      context.lineWidth = strokeSize;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();

      context.beginPath();
      context.moveTo(toX, toY);
      context.lineTo(
        toX - headLength * Math.cos(angle - Math.PI / 6),
        toY - headLength * Math.sin(angle - Math.PI / 6)
      );
      context.lineTo(
        toX - headLength * Math.cos(angle + Math.PI / 6),
        toY - headLength * Math.sin(angle + Math.PI / 6)
      );
      context.lineTo(toX, toY);
      context.fillStyle = strokeColor;
      context.fill();
    }

    function handleMouseUp(e: MouseEvent) {
      if (tool === "select" && isDraggingAnnotationRef.current) {
        isDraggingAnnotationRef.current = false;
        setIsDraggingAnnotation(false);
        dragStartShapeRef.current = null;
        pushShapesHistory(annotationShapes);
        return;
      }

      if (!isDrawingRef.current) return;
      const { x, y } = getPoint(e);

      if (tool === "draw" && currentPathRef.current.length > 1) {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        applyShapes(
          [
            ...annotationShapes,
            {
              id,
              kind: "path",
              color: strokeColor,
              size: strokeSize,
              points: [...currentPathRef.current],
            },
          ],
          { pushHistory: true }
        );
      }

      if (tool === "arrow") {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        applyShapes(
          [
            ...annotationShapes,
            {
              id,
              kind: "arrow",
              color: strokeColor,
              size: strokeSize,
              fromX: drawStartRef.current.x,
              fromY: drawStartRef.current.y,
              toX: x,
              toY: y,
            },
          ],
          { pushHistory: true }
        );
      }

      if (tool === "highlight") {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const width = x - drawStartRef.current.x;
        const height = y - drawStartRef.current.y;
        if (Math.abs(width) > 2 && Math.abs(height) > 2) {
          applyShapes(
            [
              ...annotationShapes,
              {
                id,
                kind: "highlight",
                color: strokeColor,
                size: strokeSize,
                opacity: highlightOpacity,
                x: drawStartRef.current.x,
                y: drawStartRef.current.y,
                width,
                height,
              },
            ],
            { pushHistory: true }
          );
        }
      }

      isDrawingRef.current = false;
      setIsDrawing(false);
      currentPathRef.current = [];
    }

    canvasEl.addEventListener("mousedown", handleMouseDown);
    canvasEl.addEventListener("mousemove", handleMouseMove);
    canvasEl.addEventListener("mouseup", handleMouseUp);
    canvasEl.addEventListener("mouseleave", handleMouseUp);

    return () => {
      canvasEl.removeEventListener("mousedown", handleMouseDown);
      canvasEl.removeEventListener("mousemove", handleMouseMove);
      canvasEl.removeEventListener("mouseup", handleMouseUp);
      canvasEl.removeEventListener("mouseleave", handleMouseUp);
    };
  }, [
    tool,
    selectedImage?.id,
    strokeColor,
    strokeSize,
    highlightOpacity,
    selectedAnnotationId,
    annotationShapes,
    annotationHistory,
    annotationHistoryIndex,
  ]);

  useEffect(() => {
    function handleClickOutside() {
      setShowMoveMenu(false);
    }

    if (showMoveMenu) {
      window.addEventListener("click", handleClickOutside);
    }

    return () => {
      window.removeEventListener("click", handleClickOutside);
    };
  }, [showMoveMenu]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

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

                  <button
                    type="button"
                    onClick={() => setSelectedIds(filteredScreenshots.map((s) => s.id))}
                    className="text-sm text-gray-600 hover:text-gray-900"
                  >
                    Select All
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
                <div className="flex h-64 flex-col items-center justify-center text-center text-gray-500">
                  <p className="mb-2 text-sm">No screenshots</p>
                  <p className="text-xs text-gray-400">
                    Upload or drag screenshots to get started
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
          <div className="relative flex items-center gap-4 rounded-xl bg-gray-900 text-white px-6 py-3 shadow-lg">
            <span className="text-sm">{selectedIds.length} selected</span>
            {selectedIds.length === filteredScreenshots.length &&
              filteredScreenshots.length > 0 && (
                <span className="text-xs text-gray-300">(All)</span>
              )}

            <button
              type="button"
              onClick={() => void openBulkModal()}
              className="text-sm underline"
            >
              Add Attribute
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowMoveMenu((prev) => !prev);
              }}
              className="text-sm underline"
            >
              Move To ▾
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

          {showMoveMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-14 left-1/2 z-50 max-h-80 w-64 -translate-x-1/2 overflow-y-auto rounded-xl border border-gray-200 bg-white text-gray-800 shadow-lg"
            >
              <div className="space-y-1 p-2">{renderFolderOptions(null, 0)}</div>
            </div>
          )}
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

      {folderToDelete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <p className="mb-4 text-sm text-gray-900">Delete this folder?</p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFolderToDelete(null)}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void deleteFolder(folderToDelete)}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="animate-fade-in fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
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
                <div className="relative flex h-full min-h-0 w-full items-center justify-center p-2">
                  <div className="relative inline-block max-h-full max-w-full">
                    <img
                      ref={imageRef}
                      src={filteredScreenshots[selectedIndex!].image_url}
                      alt=""
                      draggable={false}
                      className="block max-h-[calc(100vh-24px)] max-w-[calc(100vw-460px)] cursor-default animate-[fadeIn_0.2s_ease-out] rounded-md object-contain shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <canvas
                      ref={canvasRef}
                      className={`absolute inset-0 h-full w-full ${
                        tool === "select"
                          ? isDraggingAnnotation
                            ? "cursor-grabbing"
                            : hoveredAnnotationId
                              ? "cursor-grab"
                              : "cursor-default"
                          : "cursor-crosshair"
                      }`}
                    />
                    {textDraft && (
                      <input
                        autoFocus
                        value={textDraft.text}
                        onChange={(e) =>
                          setTextDraft((prev) =>
                            prev ? { ...prev, text: e.target.value } : prev
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            applyTextDraft();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setTextDraft(null);
                          }
                        }}
                        placeholder="Type text and press Enter"
                        className="absolute z-20 w-56 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 shadow focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300"
                        style={{
                          left: Math.max(
                            0,
                            Math.min(
                              textDraft.x,
                              Math.max(0, (canvasRef.current?.width ?? 0) - 230)
                            )
                          ),
                          top: Math.max(
                            0,
                            Math.min(
                              textDraft.y,
                              Math.max(0, (canvasRef.current?.height ?? 0) - 36)
                            )
                          ),
                        }}
                      />
                    )}
                  </div>
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
                    <div className="mb-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setTool("select")}
                        className={`rounded border px-2 py-1 text-xs ${
                          tool === "select"
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                      >
                        Select
                      </button>

                      <button
                        type="button"
                        onClick={() => setTool("draw")}
                        className={`rounded border px-2 py-1 text-xs ${
                          tool === "draw"
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                      >
                        ✏️ Draw
                      </button>

                      <button
                        type="button"
                        onClick={() => setTool("arrow")}
                        className={`rounded border px-2 py-1 text-xs ${
                          tool === "arrow"
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                      >
                        ➡️ Arrow
                      </button>

                      <button
                        type="button"
                        onClick={() => setTool("text")}
                        className={`rounded border px-2 py-1 text-xs ${
                          tool === "text"
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                      >
                        T Text
                      </button>

                      <button
                        type="button"
                        onClick={() => setTool("highlight")}
                        className={`rounded border px-2 py-1 text-xs ${
                          tool === "highlight"
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 bg-white text-gray-700"
                        }`}
                      >
                        ▭ Highlighter
                      </button>

                      <label className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700">
                        Color
                        <input
                          type="color"
                          value={strokeColor}
                          onChange={(e) => setStrokeColor(e.target.value)}
                          className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                          title="Stroke color"
                        />
                      </label>

                      <label className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700">
                        Size
                        <input
                          type="range"
                          min={1}
                          max={12}
                          value={strokeSize}
                          onChange={(e) => setStrokeSize(Number(e.target.value))}
                        />
                        <span>{strokeSize}</span>
                      </label>

                      {tool === "highlight" && (
                        <label className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700">
                          Opacity
                          <input
                            type="range"
                            min={5}
                            max={80}
                            value={Math.round(highlightOpacity * 100)}
                            onChange={(e) =>
                              setHighlightOpacity(Number(e.target.value) / 100)
                            }
                          />
                          <span>{Math.round(highlightOpacity * 100)}%</span>
                        </label>
                      )}

                      <button
                        type="button"
                        onClick={handleUndoAnnotation}
                        disabled={annotationHistoryIndex <= 0}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Undo
                      </button>

                      <button
                        type="button"
                        onClick={handleRedoAnnotation}
                        disabled={
                          annotationHistoryIndex < 0 ||
                          annotationHistoryIndex >= annotationHistory.length - 1
                        }
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Redo
                      </button>

                      <button
                        type="button"
                        onClick={applyTextDraft}
                        disabled={!textDraft || !textDraft.text.trim()}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add text
                      </button>

                      <button
                        type="button"
                        onClick={clearAnnotationCanvas}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                      >
                        Clear
                      </button>

                      <button
                        type="button"
                        onClick={deleteSelectedAnnotation}
                        disabled={!selectedAnnotationId}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete selected
                      </button>

                      <button
                        type="button"
                        onClick={() => void exportMergedImage()}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                      >
                        Export merged
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          applyTextDraft();
                          void saveAnnotation();
                        }}
                        className="rounded border border-gray-900 bg-gray-900 px-2 py-1 text-xs text-white"
                        disabled={savingAnnotation}
                      >
                        {savingAnnotation ? "Saving..." : "Save"}
                      </button>
                    </div>
                    {tool === "select" && (
                      <p className="text-xs text-gray-500">
                        Hover to highlight, click to select, then drag to move.
                      </p>
                    )}

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

