"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  syncSharedPlaybookAndNotifyImporters,
  syncSharedPlaybookAndNotifyFromScreenshotId,
} from "@/lib/notifyPlaybookUpdate";
import {
  markScreenshotUpdated,
  markScreenshotsUpdated,
} from "@/lib/markScreenshotUpdated";
import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  toggleTheme,
  type ThemeMode,
} from "@/lib/theme";
import ScreenshotUploader from "@/components/upload/ScreenshotUploader";
import { createPortal } from "react-dom";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  CreditCard,
  Download,
  Folder,
  Globe,
  Lock,
  Link as LinkIcon,
  Image as ImageIcon,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Sparkles,
  Trash2,
  Upload,
  X,
  Mic,
  Play,
  Pause,
  Square as StopIcon,
  ArrowRight,
  Minus,
  MousePointer2,
  Type,
  Square,
  Palette,
  SlidersHorizontal,
  Undo2,
  Redo2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

type ScreenshotRow = {
  id: string;
  image_url: string;
  created_at: string;
  tags?: string[] | null;
  notes?: string | null;
  folder_id?: string | null;
  source_screenshot_id?: string | null;
  voice_memo_url?: string | null;
  voice_memo_path?: string | null;
  voice_memo_duration_ms?: number | null;
  voice_memo_mime_type?: string | null;
  voice_memo_size_bytes?: number | null;
  voice_memo_updated_at?: string | null;
  private_voice_memo_url?: string | null;
  private_voice_memo_path?: string | null;
  private_voice_memo_duration_ms?: number | null;
  private_voice_memo_mime_type?: string | null;
  private_voice_memo_size_bytes?: number | null;
  private_voice_memo_updated_at?: string | null;
  annotation?: unknown; // legacy
  annotations?: unknown; // structured JSON (preferred)
  /** True for rows just synced from a shared playbook (highlight in UI). */
  is_new?: boolean | null;
  /** True after notes, annotations, or attributes change (visible to importers after sync). */
  is_updated?: boolean | null;
};

type NotificationRow = {
  id: string;
  message?: string | null;
  type?: string | null;
  is_read?: boolean | null;
  created_at?: string | null;
  /** Author's shared root; importer maps via `user_playbooks` to `copy_folder_id`. */
  source_folder_id?: string | null;
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
      kind: "line";
      color: string;
      size: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
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

function isOptionalSchemaMissing(err: { message?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("could not find")
  );
}

function formatVoiceMemoDuration(durationMs: number | null | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type HTMLAudioWithSinkId = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

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

function getNotificationIcon(
  type: string | null | undefined
): ReactNode {
  // Subtle, consistent notification icon styling.
  const common = "w-4 h-4 text-gray-600 mt-0.5";
  switch (type) {
    case "import":
      return <Download className={common} />;
    case "update":
      return <RefreshCw className={common} />;
    case "payment":
      return <CreditCard className={common} />;
    default:
      return <Bell className={common} />;
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
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
  const [isAnnotationToolbarOpen, setIsAnnotationToolbarOpen] = useState(true);
  const [showStrokeSizePopover, setShowStrokeSizePopover] = useState(false);

  const [savedViews, setSavedViews] = useState<any[]>([]);
  const [viewName, setViewName] = useState("");
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const topLevelFolders = useMemo(
    () => (folders ?? []).filter((f: any) => f.parent_id == null),
    [folders]
  );
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [description, setDescription] = useState("");
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalFolder, setShareModalFolder] = useState<any | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [price, setPrice] = useState(0);
  const [shareSaving, setShareSaving] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const skipSidebarPersistRef = useRef(true);
  const prevActiveFolderIdRef = useRef<string | null>(null);
  const screenshotsGridRef = useRef<HTMLDivElement | null>(null);

  const [currentNote, setCurrentNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savedNoteToast, setSavedNoteToast] = useState(false);
  const [voiceMemoError, setVoiceMemoError] = useState<string | null>(null);
  const [savingVoiceMemo, setSavingVoiceMemo] = useState(false);
  const [isRecordingVoiceMemo, setIsRecordingVoiceMemo] = useState(false);
  const [isPlayingVoiceMemo, setIsPlayingVoiceMemo] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string>("");
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<string>("");
  const [attributes, setAttributes] = useState<any[]>([]);
  const [undoData, setUndoData] = useState<{
    attribute: any;
    index: number;
  } | null>(null);
  const [savingAttributes, setSavingAttributes] = useState(false);
  const [savedAttributesToast, setSavedAttributesToast] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastExiting, setToastExiting] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isMacPlatform, setIsMacPlatform] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<
    "select" | "draw" | "line" | "arrow" | "text" | "highlight"
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
  const [hoveredResizeHandleIndex, setHoveredResizeHandleIndex] = useState<number | null>(
    null
  );
  const [isDraggingAnnotation, setIsDraggingAnnotation] = useState(false);
  const [isResizingAnnotation, setIsResizingAnnotation] = useState(false);
  const [annotationBaseDataUrl, setAnnotationBaseDataUrl] = useState("");
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const drawStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingRef = useRef(false);
  const isDraggingAnnotationRef = useRef(false);
  const isResizingAnnotationRef = useRef(false);
  const resizeHandleIndexRef = useRef<number | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStartShapeRef = useRef<AnnotationShape | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const toastExitTimeoutRef = useRef<number | null>(null);
  const strokeSizePopoverRef = useRef<HTMLDivElement | null>(null);
  const annotationSaveTimeoutRef = useRef<number | null>(null);
  const noteSaveTimeoutRef = useRef<number | null>(null);
  const attributeSaveTimeoutRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingTickRef = useRef<number | null>(null);
  const lastAnnotationFingerprintRef = useRef("");
  const lastNoteByScreenshotRef = useRef<Record<string, string>>({});
  const lastAttributesByScreenshotRef = useRef<Record<string, string>>({});

  const multiSelectHint = isMacPlatform
      ? "⌘ to select • ⇧ to select range"
      : "Ctrl to select • Shift to select range";

  function handleImageLoaded(id: string) {
    setLoadedImages((prev) => ({ ...prev, [id]: true }));
  }

  function showToast(message: string) {
    setToast(message);
    setToastExiting(false);
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    if (toastExitTimeoutRef.current) {
      window.clearTimeout(toastExitTimeoutRef.current);
    }

    const TOAST_TOTAL_MS = 2000;
    const TOAST_OUT_START_MS = 1800;

    toastExitTimeoutRef.current = window.setTimeout(() => {
      setToastExiting(true);
    }, TOAST_OUT_START_MS);

    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
      toastExitTimeoutRef.current = null;
      setToastExiting(false);
    }, TOAST_TOTAL_MS);
  }

  useEffect(() => {
    const stored = getStoredTheme();
    if (stored) {
      setThemeMode(stored);
      applyTheme(stored);
      return;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: ThemeMode = prefersDark ? "dark" : "light";
    setThemeMode(initial);
    applyTheme(initial);
  }, []);

  function handleToggleTheme() {
    const next = toggleTheme(themeMode);
    setThemeMode(next);
    applyTheme(next);
    setStoredTheme(next);
  }

  async function loadNotifications() {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) {
      setNotifications([]);
      return;
    }

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      setNotifications([]);
      return;
    }

    setNotifications(data ?? []);
  }

  async function markAllNotificationsRead() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", auth.user.id);

    await loadNotifications();
  }

  /** "Playbook updated" rows include `source_folder_id` (author root) and we resolve the importer copy folder. */
  function canOpenPlaybookFromNotification(n: NotificationRow): boolean {
    return Boolean(n.source_folder_id && n.type === "update");
  }

  async function openPlaybookFromNotification(n: NotificationRow) {
    const sourceRoot = n.source_folder_id;
    if (!sourceRoot || n.type !== "update") return;

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    // Multiple imports of the same shared root create multiple rows; `.maybeSingle()` errors on that.
    const { data: linkRows, error } = await supabase
      .from("user_playbooks")
      .select("copy_folder_id")
      .eq("user_id", auth.user.id)
      .eq("source_folder_id", sourceRoot)
      .limit(1);

    if (error) {
      console.warn("user_playbooks (notification):", error.message);
      showToast("Could not open playbook.");
      return;
    }

    const copyId = linkRows?.[0]?.copy_folder_id as string | null | undefined;
    if (!copyId) {
      showToast("No imported copy found for this playbook.");
      return;
    }

    const { data: folderRows } = await supabase
      .from("folders")
      .select("id, parent_id")
      .eq("user_id", auth.user.id);

    const byId = new Map(
      (folderRows ?? []).map((f: { id: string; parent_id?: string | null }) => [
        String(f.id),
        f,
      ])
    );

    setExpandedFolders((prev) => {
      const next = new Set(prev);
      let cur: string | null = String(copyId);
      for (let guard = 0; guard < 48 && cur; guard++) {
        const f = byId.get(cur);
        if (!f?.parent_id || String(f.parent_id).length === 0) break;
        const pid = String(f.parent_id);
        next.add(pid);
        cur = pid;
      }
      return next;
    });

    setActiveFolderId(String(copyId));
    setNotificationsOpen(false);

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", n.id);
    await loadNotifications();

    window.setTimeout(() => {
      screenshotsGridRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }

  const unreadNotificationCount = notifications.filter((n) => !n.is_read).length;

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
      .select(
        "id, image_url, created_at, tags, notes, folder_id, source_screenshot_id, annotations, annotation, is_new, is_updated, voice_memo_url, voice_memo_path, voice_memo_duration_ms, voice_memo_mime_type, voice_memo_size_bytes, voice_memo_updated_at"
      )
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
        .select(
          "id, image_url, created_at, tags, notes, folder_id, source_screenshot_id, annotation, is_new, is_updated, voice_memo_url, voice_memo_path, voice_memo_duration_ms, voice_memo_mime_type, voice_memo_size_bytes, voice_memo_updated_at"
        )
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
        .select(
          "id, image_url, created_at, tags, notes, folder_id, source_screenshot_id, is_new, is_updated, voice_memo_url, voice_memo_path, voice_memo_duration_ms, voice_memo_mime_type, voice_memo_size_bytes, voice_memo_updated_at"
        )
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
      const allRows = (data ?? []) as ScreenshotRow[];
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
      const allIds = hydratedRows.map((row) => row.id);
      const privateMemoByScreenshot: Record<string, Partial<ScreenshotRow>> = {};
      if (allIds.length > 0) {
        const { data: privateRows, error: privateErr } = await supabase
          .from("screenshot_private_voice_memos")
          .select(
            "screenshot_id, voice_memo_url, voice_memo_path, voice_memo_duration_ms, voice_memo_mime_type, voice_memo_size_bytes, updated_at"
          )
          .in("screenshot_id", allIds);
        if (!privateErr && privateRows) {
          for (const row of privateRows as Record<string, unknown>[]) {
            const sid = String(row.screenshot_id ?? "");
            if (!sid) continue;
            privateMemoByScreenshot[sid] = {
              private_voice_memo_url: (row.voice_memo_url as string | null) ?? null,
              private_voice_memo_path: (row.voice_memo_path as string | null) ?? null,
              private_voice_memo_duration_ms:
                (row.voice_memo_duration_ms as number | null) ?? null,
              private_voice_memo_mime_type:
                (row.voice_memo_mime_type as string | null) ?? null,
              private_voice_memo_size_bytes:
                (row.voice_memo_size_bytes as number | null) ?? null,
              private_voice_memo_updated_at: (row.updated_at as string | null) ?? null,
            };
          }
        } else if (privateErr && !isOptionalSchemaMissing(privateErr)) {
          console.warn("screenshot_private_voice_memos:", privateErr.message);
        }
      }

      const hydratedWithPrivate = hydratedRows.map((row) => ({
        ...row,
        ...(privateMemoByScreenshot[row.id] ?? {}),
      }));
      setAllScreenshots(hydratedWithPrivate);

      const screenshotRows = (activeFolderId
        ? hydratedWithPrivate.filter((s) => s.folder_id === activeFolderId)
        : hydratedWithPrivate) as ScreenshotRow[];
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

  const fetchScreenshotsRef = useRef(fetchScreenshots);
  useEffect(() => {
    fetchScreenshotsRef.current = fetchScreenshots;
  });

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

  async function savePlaybookDescription(
    folderId: string,
    nextDescription: string
  ) {
    const { error: updErr } = await supabase
      .from("folders")
      .update({ description: nextDescription })
      .eq("id", folderId);

    if (updErr) {
      const msg = updErr.message.toLowerCase();
      if (msg.includes("description") || msg.includes("column")) {
        setError(
          "Add the description column: run `alter table public.folders add column if not exists description text;` in Supabase."
        );
      } else {
        setError(updErr.message);
      }
      return;
    }

    setError(null);
    await fetchFolders();
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
    return folders.some(
      (f: any) =>
        f.parent_id != null && String(f.parent_id) === String(folderId)
    );
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

  function openShareModal(folder: any) {
    setShareModalFolder(folder);
    setIsPaid(Boolean(folder?.is_paid));
    setPrice(Number(folder?.price ?? 0));
    setShareModalOpen(true);
  }

  function closeShareModal() {
    setShareModalOpen(false);
    setShareModalFolder(null);
    setShareSaving(false);
  }

  async function makePublic(folder: any, nextIsPaid: boolean, nextPrice: number): Promise<boolean> {
    const finalPrice = nextIsPaid ? nextPrice : 0;
    let shareId = String(folder?.share_id ?? "");

    // Preserve existing share_id (keep it stable). Only generate if missing.
    if (!shareId) {
      shareId = generateShareId();
      const { error: shareError } = await supabase
        .from("folders")
        .update({
          share_id: shareId,
          is_public: true,
          is_paid: nextIsPaid,
          price: finalPrice,
        })
        .eq("id", folder.id);

      if (shareError) {
        setError(
          shareError.message.toLowerCase().includes("share_id")
            ? "folders.share_id column is missing. Please run DB migration to enable sharing."
            : shareError.message
        );
        return false;
      }

      await fetchFolders();
      return true;
    }

    const { error: shareError } = await supabase
      .from("folders")
      .update({
        is_public: true,
        is_paid: nextIsPaid,
        price: finalPrice,
      })
      .eq("id", folder.id);

    if (shareError) {
      setError(shareError.message);
      return false;
    }

    await fetchFolders();
    return true;
  }

  async function makePrivate(folder: any): Promise<boolean> {
    const { error } = await supabase
      .from("folders")
      .update({
        share_id: null,
        is_public: false,
        is_paid: false,
        price: 0,
      })
      .eq("id", folder.id);

    if (error) {
      setError(
        error.message.toLowerCase().includes("share_id")
          ? "folders.share_id column is missing. Please run DB migration to enable sharing."
          : error.message
      );
      return false;
    }

    await fetchFolders();
    return true;
  }

  async function saveShareSettings() {
    if (!shareModalFolder) return;

    if (isPaid && (!Number.isFinite(price) || price <= 0)) {
      showToast("Price must be greater than 0.");
      return;
    }

    setShareSaving(true);
    try {
      const ok = await makePublic(shareModalFolder, isPaid, price);
      if (ok) showToast("Playbook is now public.");
      closeShareModal();
    } catch {
      setShareSaving(false);
    }
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
      await loadNotifications();
    }

    loadDashboardData().finally(() => {
      setCheckingSession(false);
    });
  }, [router, fetchAllAttributes]);

  useEffect(() => {
    if (checkingSession) return;

    async function run() {
      const prev = prevActiveFolderIdRef.current;
      const next = activeFolderId;

      // Clear highlight flags when leaving a folder (not on open), so NEW/UPDATED stay visible while viewing.
      if (prev != null && prev !== next) {
        const { error } = await supabase
          .from("screenshots")
          .update({ is_new: false, is_updated: false })
          .eq("folder_id", prev);

        if (error) {
          const m = error.message.toLowerCase();
          if (
            !m.includes("is_new") &&
            !m.includes("is_updated") &&
            !m.includes("column") &&
            !m.includes("schema cache")
          ) {
            console.warn("clear is_new / is_updated on folder leave:", error.message);
          }
        }
      }

      prevActiveFolderIdRef.current = next;

      await fetchScreenshots();
    }

    void run();
  }, [activeFolderId, checkingSession]);

  // Refetch when the tab regains focus so importer copies pick up server-side UPDATED/NEW without a manual reload.
  useEffect(() => {
    if (checkingSession) return;
    function onVisibility() {
      if (document.visibilityState === "visible") {
        void fetchScreenshotsRef.current();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [checkingSession]);

  // Refresh grid when this user's screenshot rows change (requires `screenshots` in the supabase_realtime publication).
  useEffect(() => {
    if (checkingSession) return;
    let cancelled = false;
    const channelRef: { current: ReturnType<typeof supabase.channel> | null } = {
      current: null,
    };

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user || cancelled) return;

      const ch = supabase
        .channel(`dashboard-screenshots-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "screenshots",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void fetchScreenshotsRef.current();
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR") {
            console.warn(
              "screenshots realtime subscription failed (add table to supabase_realtime publication if needed)"
            );
          }
        });

      channelRef.current = ch;
      if (cancelled) {
        void supabase.removeChannel(ch);
        channelRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
      }
    };
  }, [checkingSession]);

  useEffect(() => {
    fetchSavedViews();
  }, []);

  useEffect(() => {
    fetchFolders();
  }, []);

  useEffect(() => {
    if (!activeFolderId) {
      setDescription("");
      setEditingDescription(false);
      return;
    }
    const f = folders.find((x: any) => String(x.id) === String(activeFolderId));
    setDescription(String(f?.description ?? ""));
  }, [activeFolderId, folders]);

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
      if (!target?.closest(".notification-container")) {
        setNotificationsOpen(false);
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
      setVoiceMemoError(null);
      setIsPlayingVoiceMemo(false);
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
    setVoiceMemoError(null);
  }, [
    selectedIndex,
    screenshots,
    tagFilter,
    filters,
    attributesByScreenshot,
  ]);

  useEffect(() => {
    if (!audioPlaybackRef.current) return;
    audioPlaybackRef.current.pause();
    audioPlaybackRef.current.currentTime = 0;
    setIsPlayingVoiceMemo(false);
  }, [selectedIndex]);

  useEffect(() => {
    void refreshAudioDevices();
    if (!navigator.mediaDevices?.addEventListener) return;
    const onDeviceChange = () => {
      void refreshAudioDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void applySelectedOutputDevice(audioPlaybackRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutputDeviceId, selectedIndex]);

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

  async function handleSaveNote(screenshotId: string, noteValue: string) {
    if (!screenshotId) return;
    setSavingNote(true);
    setError(null);
    try {
      const shot = screenshots.find((s) => s.id === screenshotId);
      if (!shot) return;

      const { error: saveError } = await supabase
        .from("screenshots")
        .update({ notes: noteValue, is_updated: true })
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
                notes: noteValue,
                is_updated: true,
              }
            : s
        )
      );

      await syncSharedPlaybookAndNotifyFromScreenshotId(supabase, shot.id);

      setSavedNoteToast(true);
      setTimeout(() => setSavedNoteToast(false), 1200);
    } finally {
      setSavingNote(false);
    }
  }

  async function readVoiceMemoDurationMs(blob: Blob): Promise<number | null> {
    return new Promise((resolve) => {
      const audio = document.createElement("audio");
      const objectUrl = URL.createObjectURL(blob);
      audio.preload = "metadata";
      audio.src = objectUrl;
      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : NaN;
        URL.revokeObjectURL(objectUrl);
        resolve(Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
    });
  }

  async function refreshAudioDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      setInputDevices(inputs);
      setOutputDevices(outputs);

      if (inputs.length > 0 && !inputs.some((d) => d.deviceId === selectedInputDeviceId)) {
        setSelectedInputDeviceId(inputs[0].deviceId);
      }
      if (outputs.length > 0 && !outputs.some((d) => d.deviceId === selectedOutputDeviceId)) {
        setSelectedOutputDeviceId(outputs[0].deviceId);
      }
    } catch (err) {
      console.warn("enumerateDevices:", err);
    }
  }

  async function applySelectedOutputDevice(audio: HTMLAudioElement | null): Promise<void> {
    if (!audio || !selectedOutputDeviceId) return;
    const withSink = audio as HTMLAudioWithSinkId;
    if (typeof withSink.setSinkId !== "function") return;
    try {
      await withSink.setSinkId(selectedOutputDeviceId);
    } catch (err) {
      console.warn("setSinkId:", err);
      setVoiceMemoError("This browser blocked changing playback output.");
    }
  }

  async function uploadVoiceMemoBlob(
    screenshot: ScreenshotRow,
    blob: Blob,
    mode: "source" | "private"
  ) {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      throw new Error(authErr?.message ?? "User not found.");
    }
    const userId = authData.user.id;
    const durationMs = await readVoiceMemoDurationMs(blob);
    const pathPrefix = mode === "private" ? "private" : "source";
    const extension = blob.type.includes("ogg")
      ? "ogg"
      : blob.type.includes("mp4")
        ? "m4a"
        : "webm";
    const filePath = `${pathPrefix}/${userId}/${screenshot.id}/${Date.now()}.${extension}`;
    const previousPath =
      mode === "private" ? screenshot.private_voice_memo_path : screenshot.voice_memo_path;

    const uploadRes = await supabase.storage
      .from("voice-memos")
      .upload(filePath, blob, { contentType: blob.type || "audio/webm", upsert: false });
    if (uploadRes.error) throw new Error(uploadRes.error.message);
    const publicUrl = supabase.storage.from("voice-memos").getPublicUrl(filePath).data.publicUrl;

    if (mode === "source") {
      const { error: saveErr } = await supabase
        .from("screenshots")
        .update({
          voice_memo_url: publicUrl,
          voice_memo_path: filePath,
          voice_memo_duration_ms: durationMs,
          voice_memo_mime_type: blob.type || null,
          voice_memo_size_bytes: blob.size,
          voice_memo_updated_at: new Date().toISOString(),
          is_updated: true,
        })
        .eq("id", screenshot.id);
      if (saveErr) throw new Error(saveErr.message);
    } else {
      const { error: upsertErr } = await supabase
        .from("screenshot_private_voice_memos")
        .upsert(
          {
            screenshot_id: screenshot.id,
            user_id: userId,
            voice_memo_url: publicUrl,
            voice_memo_path: filePath,
            voice_memo_duration_ms: durationMs,
            voice_memo_mime_type: blob.type || null,
            voice_memo_size_bytes: blob.size,
          },
          { onConflict: "screenshot_id,user_id" }
        );
      if (upsertErr) throw new Error(upsertErr.message);
    }

    if (previousPath && previousPath !== filePath) {
      const { error: removeErr } = await supabase.storage
        .from("voice-memos")
        .remove([previousPath]);
      if (removeErr) {
        console.warn("voice memo remove old:", removeErr.message);
      }
    }

    const patch =
      mode === "private"
        ? {
            private_voice_memo_url: publicUrl,
            private_voice_memo_path: filePath,
            private_voice_memo_duration_ms: durationMs,
            private_voice_memo_mime_type: blob.type || null,
            private_voice_memo_size_bytes: blob.size,
            private_voice_memo_updated_at: new Date().toISOString(),
          }
        : {
            voice_memo_url: publicUrl,
            voice_memo_path: filePath,
            voice_memo_duration_ms: durationMs,
            voice_memo_mime_type: blob.type || null,
            voice_memo_size_bytes: blob.size,
            voice_memo_updated_at: new Date().toISOString(),
            is_updated: true,
          };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === screenshot.id ? { ...s, ...patch } : s))
    );
    setAllScreenshots((prev: ScreenshotRow[]) =>
      prev.map((s) => (s.id === screenshot.id ? { ...s, ...patch } : s))
    );

    if (mode === "source") {
      await syncSharedPlaybookAndNotifyFromScreenshotId(supabase, screenshot.id);
    }
  }

  async function deleteVoiceMemo(
    screenshot: ScreenshotRow,
    mode: "source" | "private"
  ): Promise<void> {
    const path = mode === "private" ? screenshot.private_voice_memo_path : screenshot.voice_memo_path;
    if (path) {
      const { error: removeErr } = await supabase.storage.from("voice-memos").remove([path]);
      if (removeErr) console.warn("voice memo delete:", removeErr.message);
    }

    if (mode === "source") {
      const { error: clearErr } = await supabase
        .from("screenshots")
        .update({
          voice_memo_url: null,
          voice_memo_path: null,
          voice_memo_duration_ms: null,
          voice_memo_mime_type: null,
          voice_memo_size_bytes: null,
          voice_memo_updated_at: null,
          is_updated: true,
        })
        .eq("id", screenshot.id);
      if (clearErr) throw new Error(clearErr.message);
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === screenshot.id
            ? {
                ...s,
                voice_memo_url: null,
                voice_memo_path: null,
                voice_memo_duration_ms: null,
                voice_memo_mime_type: null,
                voice_memo_size_bytes: null,
                voice_memo_updated_at: null,
                is_updated: true,
              }
            : s
        )
      );
      setAllScreenshots((prev: ScreenshotRow[]) =>
        prev.map((s) =>
          s.id === screenshot.id
            ? {
                ...s,
                voice_memo_url: null,
                voice_memo_path: null,
                voice_memo_duration_ms: null,
                voice_memo_mime_type: null,
                voice_memo_size_bytes: null,
                voice_memo_updated_at: null,
                is_updated: true,
              }
            : s
        )
      );
      await syncSharedPlaybookAndNotifyFromScreenshotId(supabase, screenshot.id);
      return;
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) throw new Error(authErr?.message ?? "User not found.");
    const { error: delErr } = await supabase
      .from("screenshot_private_voice_memos")
      .delete()
      .eq("screenshot_id", screenshot.id)
      .eq("user_id", authData.user.id);
    if (delErr) throw new Error(delErr.message);

    setScreenshots((prev) =>
      prev.map((s) =>
        s.id === screenshot.id
          ? {
              ...s,
              private_voice_memo_url: null,
              private_voice_memo_path: null,
              private_voice_memo_duration_ms: null,
              private_voice_memo_mime_type: null,
              private_voice_memo_size_bytes: null,
              private_voice_memo_updated_at: null,
            }
          : s
      )
    );
    setAllScreenshots((prev: ScreenshotRow[]) =>
      prev.map((s) =>
        s.id === screenshot.id
          ? {
              ...s,
              private_voice_memo_url: null,
              private_voice_memo_path: null,
              private_voice_memo_duration_ms: null,
              private_voice_memo_mime_type: null,
              private_voice_memo_size_bytes: null,
              private_voice_memo_updated_at: null,
            }
          : s
      )
    );
  }

  async function startVoiceMemoRecording(mode: "source" | "private") {
    if (!selectedImage?.id) return;
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      setVoiceMemoError("Voice recording is not supported by this browser.");
      return;
    }
    setVoiceMemoError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedInputDeviceId
          ? { deviceId: { exact: selectedInputDeviceId } }
          : true,
      });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        recordingChunksRef.current = [];
        setIsRecordingVoiceMemo(false);
        if (recordingTickRef.current) {
          window.clearInterval(recordingTickRef.current);
          recordingTickRef.current = null;
        }
        recordingStartedAtRef.current = null;
        setRecordingElapsedMs(0);
        if (blob.size > 0) {
          setSavingVoiceMemo(true);
          void uploadVoiceMemoBlob(selectedImage, blob, mode)
            .catch((err: unknown) => {
              setVoiceMemoError(err instanceof Error ? err.message : "Failed to save voice memo.");
            })
            .finally(() => setSavingVoiceMemo(false));
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      };
      recorder.start();
      setIsRecordingVoiceMemo(true);
      recordingStartedAtRef.current = Date.now();
      setRecordingElapsedMs(0);
      if (recordingTickRef.current) {
        window.clearInterval(recordingTickRef.current);
      }
      recordingTickRef.current = window.setInterval(() => {
        if (!recordingStartedAtRef.current) return;
        setRecordingElapsedMs(Date.now() - recordingStartedAtRef.current);
      }, 200);
      void refreshAudioDevices();
    } catch (err) {
      setVoiceMemoError(err instanceof Error ? err.message : "Microphone permission denied.");
      setIsRecordingVoiceMemo(false);
    }
  }

  function stopVoiceMemoRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function saveAttributes(
    attrList: any[],
    options?: { showToast?: boolean; screenshotId?: string }
  ) {
    const screenshotId = options?.screenshotId;
    if (!screenshotId) return;

    setSavingAttributes(true);
    setError(null);

    const showToast = options?.showToast !== false;

    try {
      const screenshot = screenshots.find((s) => s.id === screenshotId);
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
        await markScreenshotUpdated(supabase, screenshot.id);
        setScreenshots((prev) =>
          prev.map((s) =>
            s.id === screenshot.id ? { ...s, is_updated: true } : s
          )
        );
        setAllScreenshots((prev: any[]) =>
          prev.map((s) =>
            s.id === screenshot.id ? { ...s, is_updated: true } : s
          )
        );
        await fetchAllAttributes();
        await refreshTradeAttributesIndex();
        await syncSharedPlaybookAndNotifyFromScreenshotId(
          supabase,
          screenshot.id
        );
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

      await markScreenshotUpdated(supabase, screenshot.id);
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === screenshot.id ? { ...s, is_updated: true } : s
        )
      );
      setAllScreenshots((prev: any[]) =>
        prev.map((s) =>
          s.id === screenshot.id ? { ...s, is_updated: true } : s
        )
      );
      await fetchAllAttributes();
      await refreshTradeAttributesIndex();
      await syncSharedPlaybookAndNotifyFromScreenshotId(
        supabase,
        screenshot.id
      );
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

        await markScreenshotsUpdated(
          supabase,
          bulkTargetIds.map((id) => String(id))
        );
        setScreenshots((prev) =>
          prev.map((s) =>
            bulkTargetIds.includes(s.id) ? { ...s, is_updated: true } : s
          )
        );
        setAllScreenshots((prev: any[]) =>
          prev.map((s) =>
            bulkTargetIds.includes(s.id) ? { ...s, is_updated: true } : s
          )
        );

        const bulkFolderIds = new Set<string>();
        for (const sid of bulkTargetIds) {
          const row = allScreenshots.find((s: any) => String(s.id) === String(sid));
          if (row?.folder_id) bulkFolderIds.add(String(row.folder_id));
        }
        for (const fid of bulkFolderIds) {
          await syncSharedPlaybookAndNotifyImporters(supabase, fid);
        }

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

    if (!selectedImage?.id) return;
    await saveAttributes(attributes, { screenshotId: selectedImage.id });
  }

  async function handleDeleteAttribute(index: number) {
    const removed = attributes[index];

    const updated = attributes.filter((_, i) => i !== index);
    setAttributes(updated);

    setUndoData({
      attribute: removed,
      index,
    });

    setTimeout(() => {
      setUndoData(null);
    }, 5000);
  }

  async function handleUndo() {
    if (!undoData) return;

    const restored = [...attributes];
    restored.splice(undoData.index, 0, undoData.attribute);

    setAttributes(restored);

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
  const isImportedScreenshot = Boolean(selectedImage?.source_screenshot_id);
  const effectiveVoiceMemoUrl =
    selectedImage?.private_voice_memo_url ?? selectedImage?.voice_memo_url ?? null;
  const effectiveVoiceMemoDuration = selectedImage?.private_voice_memo_duration_ms
    ?? selectedImage?.voice_memo_duration_ms
    ?? null;
  const hasPrivateMemo = Boolean(selectedImage?.private_voice_memo_url);
  const canRecordSourceMemo = Boolean(selectedImage && !isImportedScreenshot);
  const canRecordPrivateMemo = Boolean(selectedImage && isImportedScreenshot);
  const panelWidth = isPanelOpen ? 380 : 48;
  const annotationToolbarWidth = isAnnotationToolbarOpen ? 68 : 44;
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

    await markScreenshotsUpdated(
      supabase,
      selectedIds.map((id) => String(id))
    );
    setScreenshots((prev) =>
      prev.map((s) =>
        selectedIds.includes(s.id) ? { ...s, is_updated: true } : s
      )
    );
    setAllScreenshots((prev: any[]) =>
      prev.map((s) =>
        selectedIds.includes(s.id) ? { ...s, is_updated: true } : s
      )
    );

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
    if (shape.kind === "line") {
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

  function getShapeBounds(shape: AnnotationShape): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    if (shape.kind === "path") {
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    }
    if (shape.kind === "arrow" || shape.kind === "line") {
      return {
        minX: Math.min(shape.fromX, shape.toX),
        minY: Math.min(shape.fromY, shape.toY),
        maxX: Math.max(shape.fromX, shape.toX),
        maxY: Math.max(shape.fromY, shape.toY),
      };
    }
    if (shape.kind === "text") {
      const fontSize = Math.max(14, 12 + shape.size * 2);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      let textWidth = fontSize;
      if (ctx) {
        ctx.font = `${fontSize}px sans-serif`;
        textWidth = Math.max(fontSize, ctx.measureText(shape.text).width);
      }
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + textWidth,
        maxY: shape.y + fontSize,
      };
    }
    return {
      minX: Math.min(shape.x, shape.x + shape.width),
      minY: Math.min(shape.y, shape.y + shape.height),
      maxX: Math.max(shape.x, shape.x + shape.width),
      maxY: Math.max(shape.y, shape.y + shape.height),
    };
  }

  function getResizeHandleAtPoint(
    shape: AnnotationShape,
    x: number,
    y: number
  ): number | null {
    const bounds = getShapeBounds(shape);
    const corners: Array<{ x: number; y: number }> = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.maxY },
    ];
    const threshold = 8;
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      if (Math.hypot(x - c.x, y - c.y) <= threshold) {
        return i;
      }
    }
    return null;
  }

  function resizeCursorFromHandle(handleIndex: number | null): string {
    if (handleIndex === 0 || handleIndex === 3) return "cursor-nwse-resize";
    if (handleIndex === 1 || handleIndex === 2) return "cursor-nesw-resize";
    return "cursor-default";
  }

  function resizeShapeFromHandle(
    shape: AnnotationShape,
    handleIndex: number,
    pointerX: number,
    pointerY: number
  ): AnnotationShape {
    const { minX, minY, maxX, maxY } = getShapeBounds(shape);
    const oldWidth = Math.max(1, maxX - minX);
    const oldHeight = Math.max(1, maxY - minY);

    const corners: Array<{ x: number; y: number }> = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY },
    ];
    const oppositeIndex = handleIndex === 0 ? 3 : handleIndex === 1 ? 2 : handleIndex === 2 ? 1 : 0;
    const anchor = corners[oppositeIndex];
    const nextMinX = Math.min(anchor.x, pointerX);
    const nextMinY = Math.min(anchor.y, pointerY);
    const nextMaxX = Math.max(anchor.x, pointerX);
    const nextMaxY = Math.max(anchor.y, pointerY);
    const nextWidth = Math.max(1, nextMaxX - nextMinX);
    const nextHeight = Math.max(1, nextMaxY - nextMinY);
    const sx = nextWidth / oldWidth;
    const sy = nextHeight / oldHeight;

    const scalePoint = (px: number, py: number) => ({
      x: nextMinX + (px - minX) * sx,
      y: nextMinY + (py - minY) * sy,
    });

    if (shape.kind === "path") {
      return {
        ...shape,
        points: shape.points.map((p) => scalePoint(p.x, p.y)),
      };
    }
    if (shape.kind === "line") {
      const from = scalePoint(shape.fromX, shape.fromY);
      const to = scalePoint(shape.toX, shape.toY);
      return {
        ...shape,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      };
    }
    if (shape.kind === "arrow") {
      const from = scalePoint(shape.fromX, shape.fromY);
      const to = scalePoint(shape.toX, shape.toY);
      return {
        ...shape,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      };
    }
    if (shape.kind === "text") {
      const p = scalePoint(shape.x, shape.y);
      const sizeScale = Math.max(0.4, Math.min(4, (sx + sy) / 2));
      return {
        ...shape,
        x: p.x,
        y: p.y,
        size: Math.max(1, Math.round(shape.size * sizeScale)),
      };
    }
    return {
      ...shape,
      x: nextMinX,
      y: nextMinY,
      width: nextWidth,
      height: nextHeight,
    };
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

  function drawLineShape(
    ctx: CanvasRenderingContext2D,
    shape: Extract<AnnotationShape, { kind: "line" }>
  ) {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(shape.fromX, shape.fromY);
    ctx.lineTo(shape.toX, shape.toY);
    ctx.stroke();
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
      } else if (shape.kind === "line") {
        drawLineShape(ctx, shape);
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
        } else if (shape.kind === "line") {
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
        } else if (shape.kind === "line") {
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

  async function saveAnnotation(
    screenshotId: string,
    shapes: AnnotationShape[],
    baseDataUrl: string
  ) {
    if (!screenshotId) return;

    setSavingAnnotation(true);
    try {
      const payloadObject = {
        version: 2,
        // Keep editable shapes as source of truth.
        // If shapes exist, do not keep a baked overlay image.
        image: shapes.length > 0 ? "" : baseDataUrl,
        shapes,
      };
      writeLocalAnnotation(screenshotId, JSON.stringify(payloadObject));

      const { error: annotationError } = await supabase
        .from("screenshots")
        .update({ annotations: payloadObject, is_updated: true })
        .eq("id", screenshotId);

      if (annotationError) {
        const msg = annotationError.message.toLowerCase();
        if (msg.includes("annotations")) {
          // New column missing: attempt legacy column.
          const payload = JSON.stringify(payloadObject);
          const legacy = await supabase
            .from("screenshots")
            .update({ annotation: payload, is_updated: true })
            .eq("id", screenshotId);
          if (!legacy.error) {
            setError(null);
            setScreenshots((prev) =>
              prev.map((s) =>
                s.id === screenshotId
                  ? {
                      ...s,
                      annotations: payloadObject,
                      annotation: payload,
                      is_updated: true,
                    }
                  : s
              )
            );
            setAllScreenshots((prev: any[]) =>
              prev.map((s) =>
                s.id === screenshotId
                  ? {
                      ...s,
                      annotations: payloadObject,
                      annotation: payload,
                      is_updated: true,
                    }
                  : s
              )
            );
            await syncSharedPlaybookAndNotifyFromScreenshotId(
              supabase,
              screenshotId
            );
            return;
          }
        }
        if (msg.includes("annotation")) {
          // Column missing: keep working with local fallback without showing blocking error.
          setError(null);
          setScreenshots((prev) =>
            prev.map((s) =>
              s.id === screenshotId
                ? {
                    ...s,
                    annotations: payloadObject,
                    annotation: payloadObject,
                    is_updated: true,
                  }
                : s
            )
          );
          setAllScreenshots((prev: any[]) =>
            prev.map((s) =>
              s.id === screenshotId
                ? {
                    ...s,
                    annotations: payloadObject,
                    annotation: payloadObject,
                    is_updated: true,
                  }
                : s
            )
          );
          await syncSharedPlaybookAndNotifyFromScreenshotId(
            supabase,
            screenshotId
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
          s.id === screenshotId
            ? {
                ...s,
                annotations: payloadObject,
                annotation: payloadObject,
                is_updated: true,
              }
            : s
        )
      );
      setAllScreenshots((prev: any[]) =>
        prev.map((s) =>
          s.id === screenshotId
            ? {
                ...s,
                annotations: payloadObject,
                annotation: payloadObject,
                is_updated: true,
              }
            : s
        )
      );

      await syncSharedPlaybookAndNotifyFromScreenshotId(
        supabase,
        screenshotId
      );
    } finally {
      setSavingAnnotation(false);
    }
  }

  async function moveToFolder(folderId: string) {
    if (!selectedIds.length) return;

    const { error: moveError } = await supabase
      .from("screenshots")
      .update({ folder_id: folderId })
      .in("id", selectedIds);

    if (moveError) {
      setError(moveError.message);
      return;
    }

    setSelectedIds([]);
    setShowMoveMenu(false);

    await fetchScreenshots();
    // DB trigger may also sync + notify; debounced notify skips duplicates within 30s.
    await syncSharedPlaybookAndNotifyImporters(supabase, String(folderId));
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

  const newScreenshotCountByFolderId = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of allScreenshots as ScreenshotRow[]) {
      if (s.is_new !== true) continue;
      const fid = s.folder_id;
      if (fid == null || fid === "") continue;
      const k = String(fid);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [allScreenshots]);

  function folderMatchesParent(f: { parent_id?: string | null }, parentId: string | null) {
    if (parentId == null) {
      return f.parent_id == null;
    }
    return f.parent_id === parentId;
  }

  function renderFolders(parentId: string | null = null, level = 0) {
    return folders
      .filter((f: any) => folderMatchesParent(f, parentId))
      .map((folder: any) => {
        const isExpanded = expandedFolders.has(String(folder.id));
        const isActive = activeFolderId === folder.id;
        const newInFolder =
          newScreenshotCountByFolderId.get(String(folder.id)) ?? 0;

        return (
          <div key={folder.id}>
            <div
              className={`
                group flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2
                transition-all duration-150 ease-in-out select-none
                ${isActive ? "bg-gray-200 text-gray-900 font-semibold" : "text-gray-700 hover:bg-gray-100"}
                ${draggedScreenshotId.length > 0 ? "hover:bg-blue-100" : ""}
                ${hoverFolderId === folder.id ? "bg-blue-100" : ""}
              `}
              style={{ paddingLeft: `${level * 8}px` }}
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

                const { error: moveError } = await supabase
                  .from("screenshots")
                  .update({ folder_id: folder.id })
                  .in("id", draggedScreenshotId);

                if (moveError) {
                  setError(moveError.message);
                  return;
                }

                setDraggedScreenshotId([]);
                setHoverFolderId(null);
                setSelectedIds([]);
                await fetchScreenshots();
                await syncSharedPlaybookAndNotifyImporters(
                  supabase,
                  String(folder.id)
                );
              }}
            >
              {hasChildren(String(folder.id)) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(String(folder.id));
                  }}
                  className="text-gray-600 transition-colors duration-150 hover:text-black cursor-pointer"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" aria-hidden />
                  ) : (
                    <ChevronRight className="w-4 h-4" aria-hidden />
                  )}
                </button>
              ) : (
                <span className="w-4" />
              )}

              <span
                onClick={() => setActiveFolderId(folder.id)}
                className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm ${
                  isActive ? "font-semibold" : "font-medium"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Folder className="w-4 h-4 shrink-0 text-gray-600" aria-hidden />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </span>
                {folder.is_imported ? (
                  <span
                    className={`shrink-0 align-middle text-[10px] font-semibold uppercase tracking-wide ${
                      "rounded bg-amber-100 px-1 py-0.5 text-amber-900"
                    }`}
                  >
                    Imported
                  </span>
                ) : null}
                {newInFolder > 0 ? (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${
                      isActive ? "bg-blue-500" : "bg-blue-600"
                    }`}
                  >
                    {newInFolder} new
                  </span>
                ) : null}
              </span>

              <span
                className={`ml-auto text-xs ${
                  isActive ? "text-gray-500" : "text-gray-400"
                }`}
              >
                {getFolderCount(folder.id)}
              </span>

              <div className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                {folder.share_id ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const url = `${window.location.origin}/playbook/${folder.share_id}`;
                        void navigator.clipboard.writeText(url);
                        showToast("Link copied");
                      }}
                      className="text-sm text-gray-600 transition-colors duration-150 hover:text-black"
                      title="Copy link"
                    >
                      <LinkIcon className="w-4 h-4" aria-hidden />
                    </button>

                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const ok = await makePrivate(folder);
                        if (ok) showToast("Sharing disabled");
                      }}
                      className="text-sm text-gray-600 transition-colors duration-150 hover:text-black"
                      title="Make private"
                    >
                      <Lock className="w-4 h-4" aria-hidden />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openShareModal(folder);
                      }}
                      className="text-sm text-gray-600 transition-colors duration-150 hover:text-black"
                      title="Edit pricing"
                    >
                      <CreditCard className="w-4 h-4" aria-hidden />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                      onClick={(e) => {
                      e.stopPropagation();
                        openShareModal(folder);
                    }}
                    className="text-sm text-gray-600 transition-colors duration-150 hover:text-black"
                    title="Make public"
                  >
                    <Globe className="w-4 h-4" aria-hidden />
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void renameFolder(folder.id, folder.name);
                  }}
                  className="text-sm text-gray-600 transition-colors duration-150 hover:text-black"
                >
                  <Pencil className="w-4 h-4" aria-hidden />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderToDelete(folder.id);
                  }}
                  className="text-sm text-gray-600 transition-colors duration-150 hover:text-black"
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
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
      .filter((f: any) => folderMatchesParent(f, parentId))
      .map((folder: any) => (
        <div key={`move-${folder.id}`}>
          <button
            type="button"
            onClick={() => void moveToFolder(folder.id)}
            className="w-full rounded px-3 py-2 text-left text-sm text-gray-800 transition-all duration-150 ease-in-out hover:bg-gray-100 cursor-pointer"
            style={{ paddingLeft: `${12 + level * 16}px` }}
          >
            <Folder className="w-4 h-4 mr-2 inline-block text-gray-600" aria-hidden />
            {folder.name}
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
      } else if (shape.kind === "line") {
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
    setHoveredResizeHandleIndex(null);
    setIsDraggingAnnotation(false);
    setIsResizingAnnotation(false);
    setTextDraft(null);
    lastAnnotationFingerprintRef.current = `${selectedImage.id}:${JSON.stringify(
      shapes
    )}:${baseDataUrl}`;
  }, [selectedImage?.id, selectedImage?.annotations, selectedImage?.annotation]);

  useEffect(() => {
    if (!selectedImage?.id) return;
    const fingerprint = `${selectedImage.id}:${JSON.stringify(annotationShapes)}:${annotationBaseDataUrl}`;
    if (fingerprint === lastAnnotationFingerprintRef.current) return;
    if (annotationSaveTimeoutRef.current) {
      window.clearTimeout(annotationSaveTimeoutRef.current);
    }
    annotationSaveTimeoutRef.current = window.setTimeout(() => {
      lastAnnotationFingerprintRef.current = fingerprint;
      void saveAnnotation(selectedImage.id, annotationShapes, annotationBaseDataUrl);
    }, 350);
    return () => {
      if (annotationSaveTimeoutRef.current) {
        window.clearTimeout(annotationSaveTimeoutRef.current);
      }
    };
  }, [selectedImage?.id, annotationShapes, annotationBaseDataUrl]);

  useEffect(() => {
    if (!selectedImage?.id) return;
    const nextNote = currentNote ?? "";
    const previous = lastNoteByScreenshotRef.current[selectedImage.id];
    if (previous === undefined) {
      lastNoteByScreenshotRef.current[selectedImage.id] = nextNote;
      return;
    }
    if (previous === nextNote) return;
    if (noteSaveTimeoutRef.current) {
      window.clearTimeout(noteSaveTimeoutRef.current);
    }
    noteSaveTimeoutRef.current = window.setTimeout(() => {
      lastNoteByScreenshotRef.current[selectedImage.id] = nextNote;
      void handleSaveNote(selectedImage.id, nextNote);
    }, 450);
    return () => {
      if (noteSaveTimeoutRef.current) {
        window.clearTimeout(noteSaveTimeoutRef.current);
      }
    };
  }, [selectedImage?.id, currentNote]);

  useEffect(() => {
    if (!selectedImage?.id) return;
    if (bulkTargetIds.length > 0) return;
    const serialized = JSON.stringify(attributes ?? []);
    const previous = lastAttributesByScreenshotRef.current[selectedImage.id];
    if (previous === undefined) {
      lastAttributesByScreenshotRef.current[selectedImage.id] = serialized;
      return;
    }
    if (previous === serialized) return;
    if (attributeSaveTimeoutRef.current) {
      window.clearTimeout(attributeSaveTimeoutRef.current);
    }
    attributeSaveTimeoutRef.current = window.setTimeout(() => {
      lastAttributesByScreenshotRef.current[selectedImage.id] = serialized;
      void saveAttributes(attributes, {
        screenshotId: selectedImage.id,
        showToast: false,
      });
    }, 500);
    return () => {
      if (attributeSaveTimeoutRef.current) {
        window.clearTimeout(attributeSaveTimeoutRef.current);
      }
    };
  }, [selectedImage?.id, attributes, bulkTargetIds.length]);

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
    if (!selectedAnnotationId) {
      setHoveredResizeHandleIndex(null);
    }
  }, [selectedAnnotationId]);

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
        return;
      }

      if (tool === "select") {
        if (selectedAnnotationId) {
          const selectedShape = annotationShapes.find((s) => s.id === selectedAnnotationId);
          if (selectedShape) {
            const resizeHandle = getResizeHandleAtPoint(selectedShape, x, y);
            if (resizeHandle !== null) {
              dragStartShapeRef.current = JSON.parse(JSON.stringify(selectedShape));
              resizeHandleIndexRef.current = resizeHandle;
              isResizingAnnotationRef.current = true;
              setIsResizingAnnotation(true);
              setHoveredResizeHandleIndex(resizeHandle);
              isDrawingRef.current = false;
              return;
            }
          }
        }
        const hitId = findShapeAtPoint(x, y);
        setSelectedAnnotationId(hitId);
        setHoveredAnnotationId(hitId);
        setHoveredResizeHandleIndex(null);
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
        return;
      }

      if (selectedAnnotationId !== null) {
        setSelectedAnnotationId(null);
      }

      isDrawingRef.current = true;
      drawStartRef.current = { x, y };

      if (tool === "draw") {
        currentPathRef.current = [{ x, y }];
      }

    }

    function handleMouseMove(e: MouseEvent) {
      const { x, y } = getPoint(e);
      if (
        tool === "select" &&
        isResizingAnnotationRef.current &&
        selectedAnnotationId &&
        resizeHandleIndexRef.current !== null
      ) {
        const seed = dragStartShapeRef.current;
        if (!seed) return;
        const handleIndex = resizeHandleIndexRef.current;
        setAnnotationShapes((prev) =>
          prev.map((shape) =>
            shape.id === selectedAnnotationId
              ? resizeShapeFromHandle(seed, handleIndex, x, y)
              : shape
          )
        );
        return;
      }
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
        if (selectedAnnotationId) {
          const selectedShape = annotationShapes.find((s) => s.id === selectedAnnotationId);
          if (selectedShape) {
            const handle = getResizeHandleAtPoint(selectedShape, x, y);
            setHoveredResizeHandleIndex((prev) => (prev === handle ? prev : handle));
          } else {
            setHoveredResizeHandleIndex(null);
          }
        } else {
          setHoveredResizeHandleIndex(null);
        }
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

      if (tool === "line") {
        redrawCanvasWithShapes();
        context.strokeStyle = strokeColor;
        context.lineWidth = strokeSize;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(drawStartRef.current.x, drawStartRef.current.y);
        context.lineTo(x, y);
        context.stroke();
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
      if (tool === "select" && isResizingAnnotationRef.current) {
        isResizingAnnotationRef.current = false;
        setIsResizingAnnotation(false);
        resizeHandleIndexRef.current = null;
        dragStartShapeRef.current = null;
        pushShapesHistory(annotationShapes);
        return;
      }
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

      if (tool === "line") {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        applyShapes(
          [
            ...annotationShapes,
            {
              id,
              kind: "line",
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
    hoveredResizeHandleIndex,
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
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (strokeSizePopoverRef.current?.contains(target)) return;
      setShowStrokeSizePopover(false);
    }
    if (!showStrokeSizePopover) return;
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [showStrokeSizePopover]);

  useEffect(() => {
    if (!isAnnotationToolbarOpen) {
      setShowStrokeSizePopover(false);
    }
  }, [isAnnotationToolbarOpen]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
      if (toastExitTimeoutRef.current) {
        window.clearTimeout(toastExitTimeoutRef.current);
      }
      if (annotationSaveTimeoutRef.current) {
        window.clearTimeout(annotationSaveTimeoutRef.current);
      }
      if (noteSaveTimeoutRef.current) {
        window.clearTimeout(noteSaveTimeoutRef.current);
      }
      if (attributeSaveTimeoutRef.current) {
        window.clearTimeout(attributeSaveTimeoutRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause();
      }
      if (recordingTickRef.current) {
        window.clearInterval(recordingTickRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebarWidth");
      if (saved != null && saved !== "") {
        const n = Number(saved);
        if (!Number.isNaN(n)) {
          setSidebarWidth(Math.min(500, Math.max(200, n)));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (skipSidebarPersistRef.current) {
      skipSidebarPersistRef.current = false;
      return;
    }
    try {
      localStorage.setItem("sidebarWidth", String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  return (
    <div className="flex h-screen bg-background">
      <div
        style={{ width: sidebarWidth }}
        className="relative box-border flex min-w-0 shrink-0 flex-col border-r border-gray-200 bg-white p-4"
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
          className="mb-4 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-all duration-150 ease-in-out hover:bg-gray-100 cursor-pointer"
        >
          <Plus className="w-4 h-4 mr-2 inline-block" aria-hidden />
          New Folder
        </button>

        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setActiveFolderId(null)}
            className={`
              w-full rounded-lg px-3 py-2 text-left text-sm
              transition-all duration-150
              ${activeFolderId === null
                ? "bg-gray-900 text-white hover:bg-gray-800"
                : "text-gray-700 hover:bg-gray-100"
              }
            `}
          >
            All Screenshots
          </button>

          {topLevelFolders.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-6 text-center">
              <div className="mb-2 text-2xl" aria-hidden>
                <Folder className="mx-auto w-5 h-5 text-gray-600" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-gray-900">
                Create your first playbook
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Use “New Folder” or import a shared playbook to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">{renderFolders(null, 0)}</div>
          )}
        </div>

        {activeFolderId && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Playbook description
            </p>
            <div className="mt-2">
              {editingDescription ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={async () => {
                    setEditingDescription(false);
                    if (!activeFolderId) return;
                    await savePlaybookDescription(activeFolderId, description);
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-500 transition focus:outline-none focus:ring-2 focus:ring-gray-300"
                  placeholder="Add description..."
                  rows={3}
                  autoFocus
                />
              ) : (
                <p
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditingDescription(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setEditingDescription(true);
                    }
                  }}
                  className="cursor-pointer rounded-md p-1 text-sm text-gray-500 hover:bg-surface-muted"
                >
                  {description || "Add description..."}
                </p>
              )}
            </div>
          </div>
        )}

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = sidebarWidth;

            function onMouseMove(ev: MouseEvent) {
              const next = startWidth + (ev.clientX - startX);
              setSidebarWidth(Math.min(500, Math.max(200, next)));
            }

            function onMouseUp() {
              window.removeEventListener("mousemove", onMouseMove);
              window.removeEventListener("mouseup", onMouseUp);
            }

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
          }}
          className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-gray-100"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-default bg-surface px-6 py-3">
          <div className="w-full max-w-md">
            <button
              type="button"
              onClick={() => setIsCommandOpen(true)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-500 transition-all duration-150 ease-in-out hover:bg-gray-100 cursor-pointer"
            >
              <span>Search or jump to…</span>
              <span className="text-xs text-gray-400">Ctrl + K</span>
            </button>
          </div>

          <div className="ml-4 flex min-w-[44px] items-center justify-end gap-2">
            <div className="notification-container relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setNotificationsOpen((v) => !v);
                }}
                aria-expanded={notificationsOpen}
                aria-haspopup="menu"
                className="relative flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-base text-gray-600 shadow-sm transition-all duration-150 ease-in-out hover:bg-gray-100 hover:text-black cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <Bell className="w-5 h-5" aria-hidden />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-[1.125rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-tight text-white">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-default bg-surface shadow-lg animate-dropdown-in transition-all duration-150 ease-in-out">
                  <div className="border-b border-gray-100 p-3 text-sm font-medium text-gray-900">
                    Notifications
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-3 py-4 text-center">
                        <div className="mx-auto mb-2 text-xl" aria-hidden>
                          <Sparkles className="w-5 h-5 mx-auto text-gray-600" />
                        </div>
                        <p className="text-sm font-semibold text-gray-900">
                          You're all caught up
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          No new playbook updates right now.
                        </p>
                      </div>
                    ) : (
                      notifications.map((n) => {
                        const openable = canOpenPlaybookFromNotification(n);
                        return (
                          <div
                            key={n.id}
                            className={`border-b border-gray-100 last:border-b-0 ${
                              openable
                                ? "cursor-pointer transition-all duration-150 ease-in-out hover:bg-gray-100"
                                : ""
                            }`}
                          >
                            <button
                              type="button"
                              disabled={!openable}
                              onClick={() => {
                                if (openable) void openPlaybookFromNotification(n);
                              }}
                              className={`w-full p-3 text-left text-sm ${
                                n.is_read
                                  ? "text-gray-500"
                                  : "font-medium text-gray-900"
                              } ${
                                openable
                                  ? "cursor-pointer transition-all duration-150 ease-in-out hover:bg-gray-100"
                                  : "cursor-default"
                              } disabled:cursor-default disabled:opacity-60`}
                            >
                              <div className="flex items-start gap-2">
                                <span
                                  className="shrink-0"
                                  aria-hidden
                                >
                                  {getNotificationIcon(n.type)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  {n.message ?? n.type ?? "Notification"}
                                </span>
                                {openable && (
                                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-blue-600">
                                    Open
                                    <ChevronRight className="w-4 h-4" aria-hidden />
                                  </span>
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void markAllNotificationsRead();
                    }}
                    className="w-full border-t border-gray-100 p-2 text-sm text-gray-600 transition-all duration-150 ease-in-out hover:bg-gray-100 cursor-pointer"
                  >
                    Mark all as read
                  </button>
                </div>
              )}
            </div>

            <div className="profile-menu relative">
              <button
                type="button"
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                aria-expanded={isProfileOpen}
                aria-haspopup="menu"
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-xs font-semibold text-gray-700 shadow-sm transition-all duration-150 ease-in-out hover:bg-gray-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                {profileInitials}
              </button>

              {isProfileOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-xl border border-default bg-surface p-2 shadow-lg animate-dropdown-in transition-all duration-150 ease-in-out">
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
                  <div className="mx-2 mb-1 mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {themeMode === "dark" ? "Dark mode" : "Light mode"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {themeMode === "dark" ? "Switch to light" : "Switch to dark"}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={themeMode === "dark"}
                        onClick={handleToggleTheme}
                        aria-label={
                          themeMode === "dark"
                            ? "Switch to light mode"
                            : "Switch to dark mode"
                        }
                        className={`relative inline-flex h-9 w-16 shrink-0 items-center overflow-hidden rounded-full border p-1 transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                          themeMode === "dark"
                            ? "border-[#0f1b3d] bg-[#050f2b]"
                            : "border-gray-300 bg-gray-200"
                        }`}
                      >
                        <span
                          className={`absolute left-2 transition-opacity duration-150 ${
                            themeMode === "dark" ? "opacity-50" : "opacity-90"
                          }`}
                          aria-hidden
                        >
                          <Sun className="h-4 w-4 text-gray-400" />
                        </span>
                        <span
                          className={`absolute right-2 transition-opacity duration-150 ${
                            themeMode === "dark" ? "opacity-95" : "opacity-60"
                          }`}
                          aria-hidden
                        >
                          <Moon
                            className={`h-4 w-4 ${
                              themeMode === "dark" ? "text-gray-100" : "text-gray-500"
                            }`}
                          />
                        </span>
                        <span
                          className={`absolute left-1 top-1 inline-block h-7 w-7 transform rounded-full shadow-md transition-transform duration-200 ease-out ${
                            themeMode === "dark"
                              ? "translate-x-7 bg-[#2f3c6b]"
                              : "translate-x-0 bg-white"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={signingOut}
                    className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm text-red-600 transition-all duration-150 ease-in-out hover:bg-gray-100 cursor-pointer disabled:opacity-60"
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
                <h2 className="text-lg font-semibold text-gray-900">Your Screenshots</h2>
              </div>

              <div className="mb-6">
                <ScreenshotUploader
                  folderId={activeFolderId}
                  onUploadComplete={fetchScreenshots}
                />
              </div>

              {screenshots.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="mb-2" aria-hidden>
                    <Upload className="w-5 h-5 mx-auto text-gray-600" />
                  </div>
                  <p className="text-lg font-medium text-gray-900">No screenshots</p>
                  <p className="mt-2 text-sm text-gray-600">
                    Drag & drop screenshots to get started
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
                    className="btn btn-primary"
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
                          <Pencil className="w-4 h-4" aria-hidden />
                        </button>

                        <button
                          type="button"
                          onClick={() => void deleteView(view.id)}
                          className="rounded p-1.5 text-gray-600 transition hover:bg-gray-200 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
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
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition-all duration-150 ease-in-out hover:bg-gray-100 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 mr-2 inline-block" aria-hidden />
                    Add Filter
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
                        <X className="w-4 h-4" aria-hidden />
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
                      className="w-full max-w-md cursor-default rounded-xl border border-gray-200 bg-white p-4 shadow-xl animate-dropdown-in transition-all duration-150 ease-in-out"
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
                                className="cursor-pointer rounded px-3 py-2 text-sm text-gray-900 transition-all duration-150 ease-in-out hover:bg-gray-100"
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
                              className="cursor-pointer rounded px-3 py-2 text-sm text-gray-900 transition-all duration-150 ease-in-out hover:bg-gray-100"
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
                  <p className="mb-2 text-sm font-medium text-gray-900">
                    No screenshots found
                  </p>
                  <p className="text-xs text-gray-500">
                    Try clearing filters, or drag & drop screenshots to get started.
                  </p>
                </div>
              ) : (
                <div
                  ref={screenshotsGridRef}
                  className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                >
                  {filteredScreenshots.map((shot, index) => {
                    const highlightNew = shot.is_new === true;
                    const highlightUpdated =
                      shot.is_updated === true && !highlightNew;

                    return (
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
                      className={`group relative flex h-full flex-col overflow-hidden rounded-xl border shadow-sm transition-all duration-150 ease-in-out hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-md ${
                        highlightNew
                          ? "border-blue-400/75 bg-gradient-to-b from-blue-500/15 to-transparent shadow-[0_0_0_1px_rgba(59,130,246,0.12)] animate-card-highlight-new"
                          : highlightUpdated
                            ? "border-amber-400/75 bg-gradient-to-b from-amber-500/15 to-transparent shadow-[0_0_0_1px_rgba(245,158,11,0.12)] animate-card-highlight-updated"
                            : "border-default bg-surface hover:bg-surface-muted"
                      } cursor-pointer ${
                        selectedIds.includes(shot.id)
                          ? "ring-2 ring-gray-900 scale-[0.98]"
                          : ""
                      }`}
                    >
                      {selectedIds.includes(shot.id) && (
                        <div className="absolute top-2 left-2 rounded bg-surface p-1 shadow">
                          <Check className="w-4 h-4 text-green-600" aria-hidden />
                        </div>
                      )}
                      <div
                        className={`relative h-48 w-full overflow-hidden ${
                          highlightNew
                            ? "bg-blue-100/40"
                            : highlightUpdated
                              ? "bg-amber-100/40"
                              : "bg-gray-100"
                        }`}
                      >
                        {shot.is_new === true ? (
                          <span
                            className="pointer-events-none absolute left-2 top-2 z-10 animate-new-pulse rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm"
                            aria-label="New"
                          >
                            NEW
                          </span>
                        ) : shot.is_updated === true ? (
                          <span
                            className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm"
                            aria-label="Updated"
                          >
                            UPDATED
                          </span>
                        ) : null}
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
                                className="rounded-full bg-surface-muted px-2 py-1 text-xs text-foreground"
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
                    );
                  })}
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
          <div className="relative flex items-center gap-4 rounded-xl border border-gray-200 bg-white text-gray-900 px-6 py-3 shadow-lg">
            <span className="text-sm">{selectedIds.length} selected</span>
            {selectedIds.length === filteredScreenshots.length &&
              filteredScreenshots.length > 0 && (
                <span className="text-xs text-gray-500">(All)</span>
              )}

            <button
              type="button"
              onClick={() => void openBulkModal()}
              className="btn btn-subtle"
            >
              Add Attribute
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowMoveMenu((prev) => !prev);
              }}
              className="btn btn-subtle"
            >
              Move To ▾
            </button>

            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="btn btn-primary"
            >
              Delete
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedIds([]);
                setLastSelectedIndex(null);
              }}
              className="btn btn-subtle"
            >
              Clear
            </button>
          </div>

          {showMoveMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-14 left-1/2 z-50 max-h-80 w-64 -translate-x-1/2 overflow-y-auto rounded-xl border border-gray-200 bg-white text-gray-800 shadow-lg animate-dropdown-in transition-all duration-150 ease-in-out"
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
                className="btn btn-primary"
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
                className="btn btn-primary"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && shareModalFolder && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
          onClick={() => closeShareModal()}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-4 text-sm font-semibold text-gray-900">
              {shareModalFolder?.share_id ? "Edit pricing" : "Share playbook"}
            </p>

            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="shareType"
                  checked={!isPaid}
                  onChange={() => setIsPaid(false)}
                  className="h-4 w-4 cursor-pointer"
                />
                <span className="text-sm text-gray-700">Free</span>
              </label>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="shareType"
                  checked={isPaid}
                  onChange={() => setIsPaid(true)}
                  className="h-4 w-4 cursor-pointer"
                />
                <span className="text-sm text-gray-700">Paid</span>
              </label>
            </div>

            {isPaid && (
              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Price (EUR)
                </label>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  placeholder="Enter price (e.g. 29)"
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-gray-300"
                />
                {price <= 0 && (
                  <p className="mt-1 text-xs text-red-600">
                    Price must be greater than 0.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeShareModal()}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                disabled={shareSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveShareSettings()}
                className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={shareSaving || (isPaid && price <= 0)}
              >
                {shareSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg ${
            toastExiting ? "animate-toast-out" : "animate-toast-in"
          }`}
        >
          {toast}
        </div>
      )}

      {false && (
        <div
          className={`fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-200 relative group ${
            modalEntered ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Close when clicking background */}
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
              <ChevronLeft className="w-5 h-5" aria-hidden />
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
                <ChevronRight className="w-5 h-5" aria-hidden />
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
            <X className="w-5 h-5" aria-hidden />
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
                      className="block cursor-default animate-[fadeIn_0.2s_ease-out] rounded-md object-contain shadow-lg"
                      style={{
                        maxHeight: "calc(100vh - 24px)",
                        maxWidth: `calc(100vw - ${panelWidth + annotationToolbarWidth + 48}px)`,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <canvas
                      ref={canvasRef}
                      className={`absolute inset-0 h-full w-full ${
                        tool === "select"
                          ? isResizingAnnotation
                            ? resizeCursorFromHandle(hoveredResizeHandleIndex)
                            : isDraggingAnnotation
                            ? "cursor-grabbing"
                            : hoveredResizeHandleIndex !== null
                              ? resizeCursorFromHandle(hoveredResizeHandleIndex)
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

              <div
                className={`box-border flex h-full shrink-0 flex-col items-center border-l border-default bg-surface-muted py-3 transition-all duration-300 ${
                  isAnnotationToolbarOpen ? "w-[68px]" : "w-[44px]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setIsAnnotationToolbarOpen((prev) => !prev)}
                  title={isAnnotationToolbarOpen ? "Collapse toolbar" : "Expand toolbar"}
                  aria-label={isAnnotationToolbarOpen ? "Collapse toolbar" : "Expand toolbar"}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30"
                >
                  {isAnnotationToolbarOpen ? (
                    <PanelRightClose className="h-4 w-4" aria-hidden />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" aria-hidden />
                  )}
                </button>

                {isAnnotationToolbarOpen && (
                  <div className="mt-2 flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
                    <button
                      type="button"
                      title="Select"
                      aria-label="Select"
                      onClick={() => setTool("select")}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 ${
                        tool === "select"
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <MousePointer2 className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Draw"
                      aria-label="Draw"
                      onClick={() => setTool("draw")}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 ${
                        tool === "draw"
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Line"
                      aria-label="Line"
                      onClick={() => setTool("line")}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 ${
                        tool === "line"
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Arrow"
                      aria-label="Arrow"
                      onClick={() => setTool("arrow")}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 ${
                        tool === "arrow"
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Text"
                      aria-label="Text"
                      onClick={() => setTool("text")}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 ${
                        tool === "text"
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <Type className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Rectangle"
                      aria-label="Rectangle"
                      onClick={() => setTool("highlight")}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 ${
                        tool === "highlight"
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <Square className="h-4 w-4" aria-hidden />
                    </button>
                    <label
                      title="Color"
                      aria-label="Color"
                      className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 focus-within:ring-2 focus-within:ring-gray-400/30"
                    >
                      <Palette className="absolute h-4 w-4 opacity-70" aria-hidden />
                      <input
                        type="color"
                        value={strokeColor}
                        onChange={(e) => setStrokeColor(e.target.value)}
                        className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0 opacity-0"
                      />
                    </label>
                    <div ref={strokeSizePopoverRef} className="relative">
                      <button
                        type="button"
                        title={`Size (${strokeSize})`}
                        aria-label="Size"
                        onClick={() => setShowStrokeSizePopover((prev) => !prev)}
                        className="relative flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30"
                      >
                        <SlidersHorizontal className="h-4 w-4 opacity-70" aria-hidden />
                      </button>
                      {showStrokeSizePopover && (
                        <div className="absolute left-[42px] top-1/2 z-30 w-44 -translate-y-1/2 rounded-md border border-gray-300 bg-white p-2 shadow-lg">
                          <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                            <span>Size</span>
                            <span className="font-medium text-gray-900">{strokeSize}</span>
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={12}
                            value={strokeSize}
                            onChange={(e) => setStrokeSize(Number(e.target.value))}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      title="Undo"
                      aria-label="Undo"
                      onClick={handleUndoAnnotation}
                      disabled={annotationHistoryIndex <= 0}
                      className="mt-1 flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-50"
                    >
                      <Undo2 className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Redo"
                      aria-label="Redo"
                      onClick={handleRedoAnnotation}
                      disabled={
                        annotationHistoryIndex < 0 ||
                        annotationHistoryIndex >= annotationHistory.length - 1
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-50"
                    >
                      <Redo2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}

                {!isAnnotationToolbarOpen && (
                  <div className="mt-2 flex w-full flex-1 flex-col items-center gap-2">
                    <div
                      title={`Active tool: ${tool === "highlight" ? "Rectangle" : tool}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-900 bg-gray-900 text-white shadow-sm"
                    >
                      {tool === "select" && <MousePointer2 className="h-4 w-4" aria-hidden />}
                      {tool === "draw" && <Pencil className="h-4 w-4" aria-hidden />}
                      {tool === "line" && <Minus className="h-4 w-4" aria-hidden />}
                      {tool === "arrow" && <ArrowRight className="h-4 w-4" aria-hidden />}
                      {tool === "text" && <Type className="h-4 w-4" aria-hidden />}
                      {tool === "highlight" && <Square className="h-4 w-4" aria-hidden />}
                    </div>
                    <button
                      type="button"
                      title="Undo"
                      aria-label="Undo"
                      onClick={handleUndoAnnotation}
                      disabled={annotationHistoryIndex <= 0}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-50"
                    >
                      <Undo2 className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Redo"
                      aria-label="Redo"
                      onClick={handleRedoAnnotation}
                      disabled={
                        annotationHistoryIndex < 0 ||
                        annotationHistoryIndex >= annotationHistory.length - 1
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-50"
                    >
                      <Redo2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )}

                {showStrokeSizePopover && !isAnnotationToolbarOpen && (
                  <div className="mt-2 text-[10px] text-gray-500">{`Size ${strokeSize}`}</div>
                )}
              </div>

              {/* RIGHT: PANEL — only this column scrolls when content is tall */}
              <div
                className={`box-border flex h-full min-h-0 ${isPanelOpen ? "w-[380px]" : "w-[48px]"} shrink-0 flex-col overflow-y-auto border-l border-default bg-surface-muted p-4 transition-all duration-300`}
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
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-white/0 text-gray-600 transition-all duration-150 ease-in-out hover:bg-gray-100 hover:text-gray-900 cursor-pointer"
                  >
                    {isPanelOpen ? (
                      <ChevronRight className="w-4 h-4" aria-hidden />
                    ) : (
                      <ChevronLeft className="w-4 h-4" aria-hidden />
                    )}
                  </button>
                </div>

                {isPanelOpen && (
                  <div className="space-y-6">
                    <div className="mb-2 space-y-2 rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Tool</span>
                        <span className="font-medium text-gray-900">
                          {tool === "highlight" ? "Rectangle" : tool}
                        </span>
                      </div>
                      {savingAnnotation && (
                        <div className="text-[11px] text-gray-500">Saving annotations...</div>
                      )}
                      <div className="flex items-center justify-between">
                        <span>Size</span>
                        <span className="font-medium text-gray-900">{strokeSize}</span>
                      </div>
                      {tool === "highlight" && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span>Opacity</span>
                            <span className="font-medium text-gray-900">
                              {Math.round(highlightOpacity * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={5}
                            max={80}
                            value={Math.round(highlightOpacity * 100)}
                            onChange={(e) =>
                              setHighlightOpacity(Number(e.target.value) / 100)
                            }
                            className="w-full"
                          />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
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
                          className="btn btn-subtle"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={deleteSelectedAnnotation}
                          disabled={!selectedAnnotationId}
                          className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60"
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
                      </div>
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
                              <Trash2 className="w-4 h-4" aria-hidden />
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

                      {savedAttributesToast && (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-green-700">
                          <Check className="w-4 h-4" aria-hidden />
                          Saved
                        </div>
                      )}
                      {savingAttributes && (
                        <div className="mt-2 text-xs text-gray-500">Saving attributes...</div>
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

                      {savedNoteToast && (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-green-700">
                          <Check className="w-4 h-4" aria-hidden />
                          Saved
                        </div>
                      )}
                      {savingNote && (
                        <div className="mt-2 text-xs text-gray-500">Saving note...</div>
                      )}

                      <div className="mt-5 border-t border-gray-200 pt-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Voice Memo
                          </p>
                          {(hasPrivateMemo || selectedImage?.voice_memo_url) && (
                            <span className="text-[11px] text-gray-500">
                              {hasPrivateMemo ? "Private memo" : "Source memo"}
                              {formatVoiceMemoDuration(effectiveVoiceMemoDuration)
                                ? ` • ${formatVoiceMemoDuration(effectiveVoiceMemoDuration)}`
                                : ""}
                            </span>
                          )}
                        </div>
                        {isRecordingVoiceMemo && (
                          <p className="mt-1 text-[11px] text-red-500">
                            Recording... {formatVoiceMemoDuration(recordingElapsedMs) ?? "0:00"}
                          </p>
                        )}

                        {effectiveVoiceMemoUrl && (
                          <audio
                            ref={audioPlaybackRef}
                            src={effectiveVoiceMemoUrl}
                            className="voice-memo-audio mt-2 w-full"
                            controls
                            onPlay={() => setIsPlayingVoiceMemo(true)}
                            onPause={() => setIsPlayingVoiceMemo(false)}
                            onEnded={() => setIsPlayingVoiceMemo(false)}
                          />
                        )}

                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <label className="text-[11px] text-gray-500">
                            Recording source
                            <select
                              value={selectedInputDeviceId}
                              onChange={(e) => setSelectedInputDeviceId(e.target.value)}
                              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800"
                            >
                              {inputDevices.length === 0 && (
                                <option value="">Default microphone</option>
                              )}
                              {inputDevices.map((device, idx) => (
                                <option key={device.deviceId || `in-${idx}`} value={device.deviceId}>
                                  {device.label || `Microphone ${idx + 1}`}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="text-[11px] text-gray-500">
                            Playback output
                            <select
                              value={selectedOutputDeviceId}
                              onChange={(e) => setSelectedOutputDeviceId(e.target.value)}
                              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800"
                            >
                              {outputDevices.length === 0 && (
                                <option value="">Default output</option>
                              )}
                              {outputDevices.map((device, idx) => (
                                <option key={device.deviceId || `out-${idx}`} value={device.deviceId}>
                                  {device.label || `Output ${idx + 1}`}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {canRecordSourceMemo && (
                            <button
                              type="button"
                              onClick={() =>
                                isRecordingVoiceMemo
                                  ? stopVoiceMemoRecording()
                                  : void startVoiceMemoRecording("source")
                              }
                              disabled={savingVoiceMemo}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                            >
                              {isRecordingVoiceMemo ? (
                                <>
                                  <StopIcon className="h-3.5 w-3.5" aria-hidden />
                                  Stop
                                </>
                              ) : (
                                <>
                                  <Mic className="h-3.5 w-3.5" aria-hidden />
                                  Record
                                </>
                              )}
                            </button>
                          )}

                          {canRecordPrivateMemo && (
                            <button
                              type="button"
                              onClick={() =>
                                isRecordingVoiceMemo
                                  ? stopVoiceMemoRecording()
                                  : void startVoiceMemoRecording("private")
                              }
                              disabled={savingVoiceMemo}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                            >
                              {isRecordingVoiceMemo ? (
                                <>
                                  <StopIcon className="h-3.5 w-3.5" aria-hidden />
                                  Stop private
                                </>
                              ) : (
                                <>
                                  <Mic className="h-3.5 w-3.5" aria-hidden />
                                  {hasPrivateMemo ? "Replace private" : "Record private"}
                                </>
                              )}
                            </button>
                          )}

                          {effectiveVoiceMemoUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                const audio = audioPlaybackRef.current;
                                if (!audio) return;
                                if (isPlayingVoiceMemo) {
                                  audio.pause();
                                } else {
                                  void applySelectedOutputDevice(audio);
                                  void audio.play();
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                            >
                              {isPlayingVoiceMemo ? (
                                <>
                                  <Pause className="h-3.5 w-3.5" aria-hidden />
                                  Pause
                                </>
                              ) : (
                                <>
                                  <Play className="h-3.5 w-3.5" aria-hidden />
                                  Play
                                </>
                              )}
                            </button>
                          )}

                          {(canRecordSourceMemo && selectedImage?.voice_memo_url) && (
                            <button
                              type="button"
                              disabled={savingVoiceMemo}
                              onClick={() => {
                                if (!selectedImage) return;
                                setSavingVoiceMemo(true);
                                void deleteVoiceMemo(selectedImage, "source")
                                  .catch((err: unknown) =>
                                    setVoiceMemoError(
                                      err instanceof Error
                                        ? err.message
                                        : "Failed to delete voice memo."
                                    )
                                  )
                                  .finally(() => setSavingVoiceMemo(false));
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              Delete source
                            </button>
                          )}

                          {(canRecordPrivateMemo && selectedImage?.private_voice_memo_url) && (
                            <button
                              type="button"
                              disabled={savingVoiceMemo}
                              onClick={() => {
                                if (!selectedImage) return;
                                setSavingVoiceMemo(true);
                                void deleteVoiceMemo(selectedImage, "private")
                                  .catch((err: unknown) =>
                                    setVoiceMemoError(
                                      err instanceof Error
                                        ? err.message
                                        : "Failed to delete private memo."
                                    )
                                  )
                                  .finally(() => setSavingVoiceMemo(false));
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              Delete private
                            </button>
                          )}
                        </div>

                        {isImportedScreenshot && selectedImage?.voice_memo_url && (
                          <p className="mt-2 text-xs text-gray-500">
                            Source memo is play-only. You can keep a private memo for your imported
                            copy.
                          </p>
                        )}
                        {savingVoiceMemo && (
                          <p className="mt-2 text-xs text-gray-500">Saving voice memo...</p>
                        )}
                        {voiceMemoError && (
                          <p className="mt-2 text-xs text-red-600">{voiceMemoError}</p>
                        )}
                      </div>
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
              className="fixed top-4 z-[2147483646] flex h-9 w-9 items-center justify-center rounded-md bg-black/30 p-2 text-white shadow-lg transition-all duration-150 ease-in-out hover:bg-gray-100 hover:text-gray-900 cursor-pointer"
              style={{
                right: `clamp(1rem, calc(${panelWidth + annotationToolbarWidth}px + 1rem), calc(100vw - 3rem))`,
              }}
            >
              <X className="w-5 h-5" aria-hidden />
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
                  flex h-9 w-9 items-center justify-center rounded-md
                  bg-black/30 p-2 text-white shadow-lg
                  opacity-0 transition-all duration-200 hover:bg-gray-100 hover:text-gray-900
                  group-hover:opacity-100
                "
              >
                <ChevronLeft className="w-5 h-5" aria-hidden />
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
                    flex h-9 w-9 items-center justify-center rounded-md
                    bg-black/30 p-2 text-white shadow-lg
                    opacity-0 transition-all duration-200 hover:bg-gray-100 hover:text-gray-900
                    group-hover:opacity-100
                  "
                  style={{
                    right: `clamp(1rem, calc(${panelWidth + annotationToolbarWidth}px + 1rem), calc(100vw - 3rem))`,
                  }}
                >
                  <ChevronRight className="w-5 h-5" aria-hidden />
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
            className="w-full max-w-xl rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden animate-dropdown-in transition-all duration-150 ease-in-out"
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
                    <span className="inline-flex items-center gap-2">
                      <Search className="w-4 h-4 text-gray-600" aria-hidden />
                      {view.name}
                    </span>
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
                    <ImageIcon
                      className="mr-2 inline-block w-4 h-4 text-gray-600"
                      aria-hidden
                    />
                    {preview}
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

