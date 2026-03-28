"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

/** PostgREST / Supabase when table or column is not in the project yet */
function isOptionalSchemaMissing(err: { message?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("could not find")
  );
}

/** Next name if `baseName` is already used: "(Copy)", then "(Copy 2)", … */
function nextAvailablePlaybookName(baseName: string, existingNames: Set<string>): string {
  const trimmed = baseName.trim();
  const root = trimmed.length > 0 ? trimmed : "Playbook";
  if (!existingNames.has(root)) return root;
  let n = 1;
  while (n < 10_000) {
    const candidate =
      n === 1 ? `${root} (Copy)` : `${root} (Copy ${n})`;
    if (!existingNames.has(candidate)) return candidate;
    n += 1;
  }
  return `${root} (Copy ${Date.now()})`;
}

export default function PublicPlaybookPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const shareId = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<any | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 3200);
  }

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  async function importPlaybook() {
    if (!folder) return;

    if (folder.is_paid && !hasAccess) {
      showToast("Please purchase first");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      showToast("Please log in first");
      return;
    }

    const userId = auth.user.id;
    const sourceFolderId = folder.id as string;

    setImporting(true);
    try {
      const { data: nameRows, error: namesErr } = await supabase
        .from("folders")
        .select("name")
        .eq("user_id", userId);

      if (namesErr) {
        showToast(namesErr.message);
        return;
      }

      const existingNames = new Set(
        (nameRows ?? [])
          .map((r: { name: string | null }) => String(r.name ?? "").trim())
          .filter((n) => n.length > 0)
      );

      const importName = nextAvailablePlaybookName(
        String(folder.name ?? ""),
        existingNames
      );

      const { data: newFolder, error: folderError } = await supabase
        .from("folders")
        .insert({
          name: importName,
          description: folder.description ?? null,
          user_id: userId,
          share_id: null,
          parent_id: null,
        })
        .select()
        .single();

      if (folderError || !newFolder) {
        showToast(folderError?.message ?? "Could not create folder");
        return;
      }

      const { error: importedFlagErr } = await supabase
        .from("folders")
        .update({ is_imported: true })
        .eq("id", newFolder.id);
      if (importedFlagErr && !isOptionalSchemaMissing(importedFlagErr)) {
        console.warn("folders.is_imported:", importedFlagErr.message);
      }

      const { data: sourceScreenshots, error: shotsErr } = await supabase
        .from("screenshots")
        .select("*")
        .eq("folder_id", sourceFolderId);

      if (shotsErr) {
        showToast(shotsErr.message);
        return;
      }

      const rows = sourceScreenshots ?? [];
      const sourceIds = rows.map((s: { id: string }) => s.id);

      const attrByShot: Record<string, Array<{ key: string; value: string }>> =
        {};
      if (sourceIds.length > 0) {
        const { data: attrRows } = await supabase
          .from("trade_attributes")
          .select("*")
          .in("screenshot_id", sourceIds);

        for (const row of (attrRows ?? []) as Record<string, unknown>[]) {
          const parsed = parseTradeAttributeRow(row);
          const sid =
            row.screenshot_id != null ? String(row.screenshot_id) : "";
          if (!sid || !parsed) continue;
          if (!attrByShot[sid]) attrByShot[sid] = [];
          attrByShot[sid].push({ key: parsed.key, value: parsed.value });
        }
      }

      for (const s of rows as Record<string, unknown>[]) {
        const sid = String(s.id);
        const insertPayload: Record<string, unknown> = {
          folder_id: newFolder.id,
          user_id: userId,
          image_url: s.image_url,
          notes: s.notes ?? null,
          tags: s.tags ?? null,
        };
        if (s.annotations != null) insertPayload.annotations = s.annotations;
        else if (s.annotation != null) insertPayload.annotation = s.annotation;

        const { data: newShot, error: insErr } = await supabase
          .from("screenshots")
          .insert(insertPayload)
          .select()
          .single();

        if (insErr || !newShot) {
          showToast(insErr?.message ?? "Failed to copy a screenshot");
          return;
        }

        const attrs = attrByShot[sid] ?? [];
        if (attrs.length > 0) {
          const { error: attrInsErr } = await supabase
            .from("trade_attributes")
            .insert(
              attrs.map((a) => ({
                screenshot_id: newShot.id,
                user_id: userId,
                key: a.key,
                value: a.value,
              }))
            );
          if (attrInsErr) {
            showToast(attrInsErr.message);
            return;
          }
        }
      }

      const { error: linkErr } = await supabase.from("user_playbooks").insert({
        user_id: userId,
        source_folder_id: sourceFolderId,
      });
      if (linkErr && !isOptionalSchemaMissing(linkErr)) {
        console.warn("user_playbooks insert:", linkErr.message);
      }

      const { error: notifErr } = await supabase.from("notifications").insert({
        user_id: userId,
        type: "import",
        message: `Playbook "${importName}" imported`,
      });
      if (notifErr && !isOptionalSchemaMissing(notifErr)) {
        console.warn("notifications insert:", notifErr.message);
      }

      showToast("Playbook imported ✓");
      router.push("/dashboard");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    if (!folder) return;
    if (!folder.is_paid) {
      setHasAccess(true);
    } else {
      setHasAccess(false);
    }
  }, [folder]);

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

  if (!hasAccess || !isUnlocked) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center">
          <div className="absolute right-6 top-10 text-xs text-gray-400">
            Powered by Tradeshots
          </div>

          <h1 className="text-3xl font-semibold text-gray-900">{folder.name}</h1>

          {folder.description && (
            <p className="mx-auto mt-4 max-w-2xl text-gray-600">{folder.description}</p>
          )}

          <div className="mt-6 flex justify-center gap-6 text-sm text-gray-500">
            <span>{screenshots.length} screenshots</span>
            <span>Annotated trades</span>
          </div>

          {screenshots.length > 0 && (
            <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
              {screenshots.slice(0, 6).map((s) => (
                <div key={s.id} className="relative overflow-hidden rounded-lg">
                  <img
                    src={s.image_url}
                    alt=""
                    className="h-40 w-full object-cover blur-[2px]"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-black/5" />
                </div>
              ))}
            </div>
          )}

          {folder.is_paid && !hasAccess ? (
            <button
              type="button"
              onClick={() => {
                setHasAccess(true);
              }}
              className="mt-10 rounded-lg bg-green-600 px-6 py-2 text-white transition hover:bg-green-700"
            >
              Buy for €{folder.price ?? 19}
            </button>
          ) : (
            <div className="mt-10 flex flex-col items-center gap-3">
              <button
                type="button"
                disabled={importing}
                onClick={() => void importPlaybook()}
                className="rounded-lg bg-gray-900 px-6 py-2 text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? "Importing…" : "Import Playbook"}
              </button>
              <button
                type="button"
                onClick={() => setIsUnlocked(true)}
                className="text-sm text-gray-600 underline-offset-4 transition hover:text-gray-900 hover:underline"
              >
                View full playbook
              </button>
            </div>
          )}
        </div>

        {toast && (
          <div className="animate-fade-in fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>
    );
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
          {folder.description && (
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              {folder.description}
            </p>
          )}
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

        {toast && (
          <div className="animate-fade-in fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

