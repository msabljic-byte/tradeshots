"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

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
  annotation?: unknown; // legacy
  annotations?: unknown; // structured
  attributes?: Array<{ name: string; value: string }>;
};

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

  useEffect(() => {
    if (!screenshot) return;
    // follow requested behavior: structured data becomes annotations state
    setOverlayImageUrl(parsed.image);
    setAnnotations(parsed.shapes ?? []);
  }, [screenshot?.id, parsed.image, parsed.shapes]);

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

  return (
    <div className="fixed inset-0 z-50 flex bg-black/40 backdrop-blur-sm transition-opacity duration-150 ease-in-out">
      <div
        className="absolute inset-0 z-0 cursor-pointer"
        onClick={() => setIndex(null)}
      />

      <div
        className="relative z-10 flex min-h-0 min-w-0 h-full w-full overflow-hidden rounded-2xl border border-default bg-surface shadow-xl animate-[fadeIn_0.2s_ease-out_both]"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={() => setIndex(null)}
          aria-label="Close modal"
          className="absolute right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-md bg-black/30 p-2 text-white transition-all duration-150 ease-in-out hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-white/30"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>

        {/* LEFT: image + annotation canvas */}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
          <div className="relative flex h-full min-h-0 w-full items-center justify-center p-4">
            <div className="relative inline-block max-h-full max-w-full">
              <img
                ref={imgRef}
                src={screenshot.image_url}
                alt=""
                draggable={false}
                className="block max-h-[calc(100vh-24px)] max-w-[calc(100vw-460px)] w-auto object-contain"
              />
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </div>
          </div>

          {canPrev && (
            <button
              type="button"
              onClick={() => setIndex((i) => (i === null ? 0 : i - 1))}
              className="absolute left-4 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-md bg-black/30 p-2 text-white transition-all duration-150 ease-in-out hover:bg-gray-100 hover:text-gray-900"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden />
            </button>
          )}
          {canNext && (
            <button
              type="button"
              onClick={() => setIndex((i) => (i === null ? 0 : i + 1))}
              className="absolute right-4 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-md bg-black/30 p-2 text-white transition-all duration-150 ease-in-out hover:bg-gray-100 hover:text-gray-900"
            >
              <ChevronRight className="w-5 h-5" aria-hidden />
            </button>
          )}
        </div>

        {/* RIGHT: read-only details */}
        <div className="w-[380px] shrink-0 overflow-y-auto border-l border-default bg-surface-muted p-6">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Details
            </p>
          </div>

          <div className="space-y-2">
            {screenshot.tags && screenshot.tags.length > 0 && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">Tags:</span> {screenshot.tags.join(", ")}
              </div>
            )}
            {screenshot.notes && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">Notes:</span> {screenshot.notes}
              </div>
            )}
          </div>

          <div className="mt-4 space-y-1">
            {(screenshot.attributes ?? []).map((attr, i) => (
              <div key={i} className="text-sm text-gray-700">
                <span className="font-medium">{attr.name}:</span> {attr.value}
              </div>
            ))}
            {(!screenshot.attributes || screenshot.attributes.length === 0) && (
              <div className="text-sm text-gray-500">No attributes yet</div>
            )}
          </div>

          {/* read-only: no editing UI */}
          {!readOnly && (
            <div className="mt-6 text-sm text-gray-600">
              Editing is not implemented in this component.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

