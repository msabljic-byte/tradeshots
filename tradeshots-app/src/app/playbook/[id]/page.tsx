"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ScreenshotModal from "@/components/ScreenshotModal";

type ScreenshotRow = {
  id: string;
  image_url: string;
  created_at: string;
  notes?: string | null;
  tags?: string[] | null;
  annotation?: unknown;
  annotations?: unknown;
  attributes?: Array<{ name: string; value: string }>;
};

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

function getLocalAnnotation(screenshotId: string): string | null {
  const existing = readLocalAnnotations();
  return existing[screenshotId] ?? null;
}

function parseTradeAttributeRow(
  row: Record<string, unknown>
): { key: string; value: string } | null {
  const rawKey =
    row.key ?? row["key"] ?? row.attr_key ?? row.attribute_key ?? row.field ?? row.name;
  const rawValue =
    row.value ??
    row["value"] ??
    row.attr_value ??
    row.attribute_value ??
    row.val;
  if (rawKey == null || rawValue == null) return null;
  const key = String(rawKey).trim();
  const value = String(rawValue).trim();
  if (!key || !value) return null;
  return { key, value };
}

export default function PublicPlaybookPage() {
  const params = useParams<{ id: string }>();
  const shareId = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<any | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      if (!shareId) {
        setError("Not found");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const folderQuery = await supabase
        .from("folders")
        .select("*")
        .eq("share_id", shareId)
        .single();

      if (folderQuery.error || !folderQuery.data) {
        const lower = (folderQuery.error?.message ?? "").toLowerCase();
        setError(
          lower.includes("share_id")
            ? "Sharing is not enabled yet. Please add folders.share_id column."
            : "Not found"
        );
        setFolder(null);
        setScreenshots([]);
        setLoading(false);
        return;
      }

      setFolder(folderQuery.data);

      const shotsQuery = await supabase
        .from("screenshots")
        .select("*")
        .eq("folder_id", folderQuery.data.id)
        .order("created_at", { ascending: false });

      const shots = (shotsQuery.data ?? []) as ScreenshotRow[];
      const hydratedShots = shots.map((s) => {
        const local = getLocalAnnotation(s.id);
        if (!local) return s;
        return { ...s, annotations: local };
      });
      setScreenshots(hydratedShots);

      if (shots.length > 0) {
        const ids = shots.map((s) => s.id);
        const { data: attrData } = await supabase
          .from("trade_attributes")
          .select("*")
          .in("screenshot_id", ids);

        const byShot: Record<string, Array<{ name: string; value: string }>> =
          {};
        for (const row of (attrData ?? []) as Record<string, unknown>[]) {
          const parsed = parseTradeAttributeRow(row);
          const sid = row.screenshot_id != null ? String(row.screenshot_id) : "";
          if (!sid || !parsed) continue;
          if (!byShot[sid]) byShot[sid] = [];
          byShot[sid].push({ name: parsed.key, value: parsed.value });
        }

        setScreenshots((prev) =>
          prev.map((s) => ({ ...s, attributes: byShot[s.id] ?? [] }))
        );
      }

      setLoading(false);
    }

    void load();
  }, [shareId]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-600">Loading shared playbook...</div>
    );
  }

  if (!folder) {
    return <div className="p-6 text-sm text-gray-700">{error ?? "Not found"}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="relative">
          <div className="absolute right-0 top-0 text-xs text-gray-400">
            Powered by Tradeshots
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">{folder.name}</h1>
          <p className="mt-1 text-sm text-gray-500">Shared playbook</p>
          <p className="mt-1 text-xs text-gray-400">
            by {folder.owner_email || "Trader"}
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {screenshots.length === 0 ? (
          <div className="py-20 text-center text-gray-500">
            <p className="text-sm">No screenshots in this playbook</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {screenshots.map((shot, index) => (
              <button
                key={shot.id}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className="group cursor-pointer overflow-hidden rounded-xl bg-white shadow-sm transition hover:shadow-md"
              >
                <img
                  src={shot.image_url}
                  alt=""
                  draggable={false}
                  className="h-40 w-full object-cover transition-transform group-hover:scale-[1.02]"
                />
              </button>
            ))}
          </div>
        )}

        {selectedIndex !== null && (
          <ScreenshotModal
            screenshots={screenshots}
            index={selectedIndex}
            setIndex={setSelectedIndex}
            readOnly={true}
          />
        )}
      </div>
    </div>
  );
}

