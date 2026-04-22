"use client";

/**
 * Full-screen modal to browse screenshots: base image + overlay (flattened data URL or vector shapes),
 * keyboard navigation (Esc, arrows), and a read-only side panel (tags, notes, voice memo, trade attributes).
 * Editing is intentionally not implemented here (see dashboard annotation editor for authoring).
 *
 * Each `useEffect` is prefixed with `// useEffect:` (sync state, canvas draw, keyboard).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";

export type AnnotationShape =
  | {
      id?: string;
      kind?: "path";
      type?: "draw";
      color: string;
      size?: number;
      width?: number;
      points: Array<{ x: number; y: number }>;
    }
  | {
      id?: string;
      kind?: "arrow";
      type?: "arrow";
      color: string;
      size?: number;
      width?: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }
  | {
      id?: string;
      kind?: "text";
      type?: "text";
      color: string;
      size?: number;
      x: number;
      y: number;
      text: string;
    }
  | {
      id?: string;
      kind?: "highlight";
      type?: "highlight";
      color: string;
      size?: number;
      opacity?: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

type ScreenshotLike = {
  id: string;
  image_url: string;
  created_at?: string;
  tags?: string[] | null;
  notes?: string | null;
  source_screenshot_id?: string | null;
  voice_memo_url?: string | null;
  voice_memo_duration_ms?: number | null;
  private_voice_memo_url?: string | null;
  private_voice_memo_duration_ms?: number | null;
  annotation?: unknown; // legacy
  annotations?: unknown; // structured
  attributes?: Array<{ name: string; value: string }>;
};

function formatVoiceDuration(durationMs: number | null | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const sec = Math.round(durationMs / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Accepts legacy string blobs, `{ image, shapes }`, or shape arrays; used for shared playbook + modal display. */
function parseAnnotationValue(raw: unknown): {
  image: string;
  shapes: AnnotationShape[];
} {
  if (raw == null) return { image: "", shapes: [] };

  if (Array.isArray(raw)) {
    return { image: "", shapes: raw as AnnotationShape[] };
  }

  // direct data URL
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return { image: "", shapes: [] };
    if (value.startsWith("data:image/")) return { image: value, shapes: [] };
    try {
      const parsed = JSON.parse(value);
      return parseAnnotationValue(parsed);
    } catch {
      return { image: value, shapes: [] };
    }
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    // payload shape: { image, shapes }
    const image = typeof obj.image === "string" ? obj.image : "";
    const shapesRaw = Array.isArray(obj.shapes) ? (obj.shapes as AnnotationShape[]) : [];
    const shapes = shapesRaw.map((shape) => {
      if (shape && (shape as any).kind === "highlight") {
        const opacity =
          typeof (shape as any).opacity === "number"
            ? Math.max(0.05, Math.min(1, (shape as any).opacity))
            : 0.18;
        return { ...(shape as any), opacity } as AnnotationShape;
      }
      return shape;
    });

    // sometimes nested
    if (!image && !shapes.length && typeof obj.annotations === "string") {
      return parseAnnotationValue(obj.annotations);
    }
    if (!image && !shapes.length && Array.isArray(obj.annotations)) {
      return { image: "", shapes: obj.annotations as AnnotationShape[] };
    }

    return { image, shapes };
  }

  return { image: "", shapes: [] };
}

export default function ScreenshotModal({
  screenshots,
  index,
  setIndex,
  readOnly = false,
}: {
  screenshots: ScreenshotLike[];
  index: number | null;
  setIndex: Dispatch<SetStateAction<number | null>>;
  readOnly?: boolean;
}) {
  const screenshot = index !== null ? screenshots[index] : null;

  const [overlayImageUrl, setOverlayImageUrl] = useState("");
  const [annotations, setAnnotations] = useState<AnnotationShape[]>([]);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const parsed = useMemo(() => {
    if (!screenshot) return { image: "", shapes: [] as AnnotationShape[] };
    return parseAnnotationValue(screenshot.annotations ?? screenshot.annotation);
  }, [screenshot]);

  // useEffect: when the active screenshot changes, push parsed overlay URL + vector shapes into React state.
  useEffect(() => {
    if (!screenshot) return;
    // follow requested behavior: structured data becomes annotations state
    setOverlayImageUrl(parsed.image);
    setAnnotations(parsed.shapes ?? []);
  }, [screenshot?.id, parsed.image, parsed.shapes]);

  // useEffect: size canvas to image, draw raster overlay (if any) then vector annotations; listen for window resize.
  useEffect(() => {
    if (!screenshot) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const width = Math.max(1, Math.floor(img.clientWidth));
      const height = Math.max(1, Math.floor(img.clientHeight));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    resize();

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (overlayImageUrl) {
        const overlay = new Image();
        overlay.src = overlayImageUrl;
        overlay.onload = () => {
          ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
          drawAnnotations();
        };
        overlay.onerror = () => {
          drawAnnotations();
        };
        return;
      }

      drawAnnotations();
    };

    const drawAnnotations = () => {
      for (const a of annotations) {
        const kind = (a as any).kind ?? (a as any).type;

        if (kind === "path" || kind === "draw") {
          const pts = (a as any).points ?? [];
          if (pts.length < 2) continue;
          ctx.strokeStyle = (a as any).color ?? "#ef4444";
          ctx.lineWidth = (a as any).size ?? (a as any).width ?? 2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        } else if (kind === "arrow") {
          const fromX = (a as any).fromX;
          const fromY = (a as any).fromY;
          const toX = (a as any).toX;
          const toY = (a as any).toY;
          const color = (a as any).color ?? "#ef4444";
          const width = (a as any).size ?? (a as any).width ?? 2;

          const distance = Math.hypot(toX - fromX, toY - fromY);
          const headLength = Math.max(8, Math.min(24, distance * 0.2));
          const angle = Math.atan2(toY - fromY, toX - fromX);

          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(toX, toY);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(toX, toY);
          ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
          ctx.lineTo(toX, toY);
          ctx.fillStyle = color;
          ctx.fill();
        } else if (kind === "text") {
          ctx.fillStyle = (a as any).color ?? "#ef4444";
          const size = Math.max(14, 12 + ((a as any).size ?? 2) * 2);
          ctx.font = `${size}px sans-serif`;
          ctx.textBaseline = "top";
          ctx.fillText((a as any).text ?? "", (a as any).x, (a as any).y);
        } else if (kind === "highlight") {
          const x = (a as any).width >= 0 ? (a as any).x : (a as any).x + (a as any).width;
          const y = (a as any).height >= 0 ? (a as any).y : (a as any).y + (a as any).height;
          const w = Math.abs((a as any).width ?? 0);
          const h = Math.abs((a as any).height ?? 0);
          if (w < 1 || h < 1) continue;

          const color = (a as any).color ?? "#ef4444";
          const opacity = typeof (a as any).opacity === "number" ? (a as any).opacity : 0.18;

          ctx.save();
          ctx.fillStyle = color;
          ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = Math.max(1, (a as any).size ?? 2);
          ctx.strokeRect(x, y, w, h);
          ctx.restore();
        }
      }
    };

    draw();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshot?.id, overlayImageUrl, annotations]);

  // useEffect: keyboard — Esc closes modal; Left/Right move selection within `screenshots`.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setIndex(null);
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => {
          if (i === null) return 0;
          return Math.max(0, i - 1);
        });
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => {
          if (i === null) return 0;
          return Math.min(screenshots.length - 1, i + 1);
        });
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [setIndex, screenshots.length]);

  if (!screenshot || index === null) return null;

  const canPrev = index > 0;
  const canNext = index < screenshots.length - 1;
  const effectiveVoiceMemoUrl =
    screenshot.private_voice_memo_url ?? screenshot.voice_memo_url ?? null;
  const effectiveDuration =
    screenshot.private_voice_memo_duration_ms ?? screenshot.voice_memo_duration_ms ?? null;
  const hasPrivateMemo = Boolean(screenshot.private_voice_memo_url);
  const hasAnyDetails =
    Boolean(screenshot.tags && screenshot.tags.length > 0) ||
    Boolean(screenshot.notes) ||
    Boolean(effectiveVoiceMemoUrl) ||
    Boolean(screenshot.attributes && screenshot.attributes.length > 0);

  const modalContent = (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <div
        className="absolute inset-0 z-0 cursor-pointer"
        onClick={() => setIndex(null)}
      />

      <motion.div
        className="group relative z-10 flex h-[96dvh] min-h-0 min-w-0 w-[98vw] max-w-none overflow-hidden rounded-xl bg-gray-900 shadow-2xl"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={() => setIndex(null)}
          aria-label="Close modal"
          className="micro-btn absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-md bg-black/30 p-2 text-white transition-all duration-150 ease-in-out hover:bg-white hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-white/30"
        >
          <X size={20} aria-hidden />
        </button>

        <div className="absolute left-0 right-0 top-0 z-20 group">
          <div className="flex items-center justify-between bg-black/40 px-4 py-2 text-white backdrop-blur-sm">
          <div className="w-5" />

          <div className="text-sm opacity-80">
            {index + 1} / {screenshots.length}
          </div>

          <div className="w-5" />
          </div>
        </div>

        <div className="flex h-full w-full pt-10">
          {/* LEFT: image + annotation canvas */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
            <div className="group relative flex h-full min-h-0 flex-1 items-center justify-center bg-black p-6">
              <div className="relative inline-block max-h-full max-w-full">
                <img
                  ref={imgRef}
                  src={screenshot.image_url}
                  alt=""
                  draggable={false}
                  className="block max-h-[90%] max-w-[95%] w-auto object-contain transition-transform duration-200 ease-out group-hover:scale-[1.01]"
                />
                <canvas
                  ref={canvasRef}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
              </div>
            </div>

            {canPrev ? (
              <button
                type="button"
                onClick={() => setIndex((i) => (i === null ? 0 : Math.max(0, i - 1)))}
                className="micro-btn absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white opacity-0 transition-all duration-150 group-hover:opacity-100 hover:opacity-100"
                aria-label="Previous screenshot"
              >
                <ChevronLeft size={20} />
              </button>
            ) : null}

            {canNext ? (
              <button
                type="button"
                onClick={() =>
                  setIndex((i) => (i === null ? 0 : Math.min(screenshots.length - 1, i + 1)))
                }
                className="micro-btn absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white opacity-0 transition-all duration-150 group-hover:opacity-100 hover:opacity-100"
                aria-label="Next screenshot"
              >
                <ChevronRight size={20} />
              </button>
            ) : null}
          </div>

          {/* RIGHT: read-only details */}
          <div className="w-[300px] shrink-0 overflow-y-auto scroll-smooth space-y-6 border-l border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Screenshot Details
              </p>
            </div>

            {!hasAnyDetails ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                No details available for this screenshot yet.
              </div>
            ) : null}

            <div className="space-y-4">
              {screenshot.tags && screenshot.tags.length > 0 ? (
                <section className="space-y-2 rounded-xl bg-gray-50 p-4 shadow-sm dark:bg-gray-800">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {screenshot.tags.map((tag) => (
                      <span
                        key={tag}
                        className="micro-pill rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-2 rounded-xl bg-gray-50 p-4 shadow-sm dark:bg-gray-800">
                <p className="text-lg font-medium text-gray-800 dark:text-gray-200">Notes</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {screenshot.notes || "No notes"}
                </p>
              </section>

              {effectiveVoiceMemoUrl ? (
                <section className="space-y-2 rounded-xl bg-gray-50 p-4 shadow-sm dark:bg-gray-800">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Voice Memo
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {hasPrivateMemo ? "Private" : "Source"}
                    {formatVoiceDuration(effectiveDuration)
                      ? ` • ${formatVoiceDuration(effectiveDuration)}`
                      : ""}
                  </p>
                  <audio controls src={effectiveVoiceMemoUrl} className="voice-memo-audio w-full" />
                  {readOnly && screenshot.source_screenshot_id ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Playback only in shared/imported view.
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="space-y-2 rounded-xl bg-gray-50 p-4 shadow-sm dark:bg-gray-800">
                <p className="text-lg font-medium text-gray-800 dark:text-gray-200">Attributes</p>
                <div className="flex flex-wrap gap-2">
                  {screenshot.attributes && screenshot.attributes.length > 0 ? (
                    screenshot.attributes.map((attr, i) => (
                      <span
                        key={`${attr.name}-${i}`}
                        className="micro-pill rounded-full bg-gray-200 px-2 py-1 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                      >
                        {attr.name}: {attr.value}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-700 dark:text-gray-300">No attributes</span>
                  )}
                </div>
              </section>
            </div>

            {/* read-only: no editing UI */}
            {!readOnly && (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                Editing is not implemented in this component.
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
}

