"use client";

/**
 * Marketplace discovery page:
 * - Lists public playbooks (`folders.is_public = true`)
 * - Supports search + pricing filters + sort
 * - Uses `folders.cover_url` when present, otherwise first screenshot in folder
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

type MarketplaceFolder = {
  id: string;
  name: string;
  cover_url?: string | null;
  is_paid?: boolean | null;
  price?: number | null;
  share_id?: string | null;
  created_at?: string | null;
};

type PriceFilter = "all" | "free" | "paid";
type SortMode = "newest" | "price-asc" | "price-desc";
type AttributeKey = "direction" | "type" | "session";

function formatPrice(folder: MarketplaceFolder): string {
  if (!folder.is_paid) return "Free";
  const value = Number(folder.price ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "Paid";
  return `EUR ${value.toFixed(0)}`;
}

export default function MarketplacePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [playbooks, setPlaybooks] = useState<MarketplaceFolder[]>([]);
  const [fallbackCovers, setFallbackCovers] = useState<Record<string, string>>({});
  const [playbookAttributes, setPlaybookAttributes] = useState<
    Record<string, Record<AttributeKey, string[]>>
  >({});
  const [selectedDirection, setSelectedDirection] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<string[]>([]);

  const directionOptions = ["Long", "Short"];
  const typeOptions = ["Breakout", "Range"];
  const sessionOptions = ["NY", "London"];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      const folderQuery = await supabase
        .from("folders")
        .select("id, name, cover_url, is_paid, price, share_id, is_public, created_at")
        .eq("is_public", true)
        .not("share_id", "is", null)
        .order("created_at", { ascending: false });

      if (folderQuery.error) {
        setError(folderQuery.error.message);
        setLoading(false);
        return;
      }

      const rows = ((folderQuery.data ?? []) as MarketplaceFolder[]).filter(
        (f) => String(f.share_id ?? "").trim().length > 0
      );

      if (cancelled) return;
      setPlaybooks(rows);

      const folderIds = rows.map((f) => String(f.id));

      if (folderIds.length > 0) {
        const shotsQuery = await supabase
          .from("screenshots")
          .select("id, folder_id, image_url, created_at")
          .in("folder_id", folderIds)
          .order("created_at", { ascending: true });

        if (!shotsQuery.error) {
          const byFolder: Record<string, string> = {};
          const screenshotIds: string[] = [];
          const screenshotFolderMap: Record<string, string> = {};
          for (const row of (shotsQuery.data ?? []) as Array<{
            id: string | null;
            folder_id: string | null;
            image_url: string | null;
          }>) {
            const sid = row.id ? String(row.id) : "";
            const fid = row.folder_id ? String(row.folder_id) : "";
            const url = row.image_url ? String(row.image_url) : "";
            if (sid && fid) {
              screenshotIds.push(sid);
              screenshotFolderMap[sid] = fid;
            }
            if (!fid || !url) continue;
            if (!byFolder[fid]) byFolder[fid] = url;
          }
          if (!cancelled) setFallbackCovers(byFolder);

          if (screenshotIds.length > 0) {
            const attrsQuery = await supabase
              .from("trade_attributes")
              .select("screenshot_id, key, value")
              .in("screenshot_id", screenshotIds);
            if (!attrsQuery.error) {
              const index: Record<string, Record<AttributeKey, Set<string>>> = {};
              for (const row of (attrsQuery.data ?? []) as Array<{
                screenshot_id: string | null;
                key: string | null;
                value: string | null;
              }>) {
                const sid = row.screenshot_id ? String(row.screenshot_id) : "";
                const fid = screenshotFolderMap[sid];
                if (!fid) continue;
                const key = String(row.key ?? "").trim().toLowerCase() as AttributeKey;
                const value = String(row.value ?? "").trim();
                if (!value) continue;
                if (key !== "direction" && key !== "type" && key !== "session") continue;
                if (!index[fid]) {
                  index[fid] = {
                    direction: new Set<string>(),
                    type: new Set<string>(),
                    session: new Set<string>(),
                  };
                }
                index[fid][key].add(value.toLowerCase());
              }

              const finalIndex: Record<string, Record<AttributeKey, string[]>> = {};
              for (const [fid, values] of Object.entries(index)) {
                finalIndex[fid] = {
                  direction: Array.from(values.direction),
                  type: Array.from(values.type),
                  session: Array.from(values.session),
                };
              }
              if (!cancelled) setPlaybookAttributes(finalIndex);
            }
          }
        }
      }

      if (!cancelled) setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...playbooks];

    if (q) {
      rows = rows.filter((p) => String(p.name ?? "").toLowerCase().includes(q));
    }

    if (priceFilter === "free") {
      rows = rows.filter((p) => !p.is_paid);
    } else if (priceFilter === "paid") {
      rows = rows.filter((p) => Boolean(p.is_paid));
    }

    rows = rows.filter((p) => {
      const attrs = playbookAttributes[String(p.id)] ?? {
        direction: [],
        type: [],
        session: [],
      };
      const passDirection =
        selectedDirection.length === 0 ||
        selectedDirection.some((v) => attrs.direction.includes(v.toLowerCase()));
      const passType =
        selectedType.length === 0 ||
        selectedType.some((v) => attrs.type.includes(v.toLowerCase()));
      const passSession =
        selectedSession.length === 0 ||
        selectedSession.some((v) => attrs.session.includes(v.toLowerCase()));
      return passDirection && passType && passSession;
    });

    rows.sort((a, b) => {
      if (sortMode === "newest") {
        const da = new Date(a.created_at ?? 0).getTime();
        const db = new Date(b.created_at ?? 0).getTime();
        return db - da;
      }
      const pa = Number(a.price ?? 0);
      const pb = Number(b.price ?? 0);
      return sortMode === "price-asc" ? pa - pb : pb - pa;
    });

    return rows;
  }, [
    playbooks,
    search,
    priceFilter,
    sortMode,
    playbookAttributes,
    selectedDirection,
    selectedType,
    selectedSession,
  ]);

  function toggleValue(setter: Dispatch<SetStateAction<string[]>>, value: string) {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Marketplace</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Discover public playbooks and import the ones you like.
        </p>

        <div className="mt-6">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search strategies..."
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-gray-500"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPriceFilter("all")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              priceFilter === "all"
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setPriceFilter("free")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              priceFilter === "free"
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Free
          </button>
          <button
            type="button"
            onClick={() => setPriceFilter("paid")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              priceFilter === "paid"
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Paid
          </button>

          <details className="relative">
            <summary className="list-none rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 cursor-pointer">
              Attributes
            </summary>
            <div className="absolute left-0 top-9 z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Direction</p>
              <div className="mb-3 space-y-1">
                {directionOptions.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={selectedDirection.includes(opt)}
                      onChange={() => toggleValue(setSelectedDirection, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>

              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Type</p>
              <div className="mb-3 space-y-1">
                {typeOptions.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={selectedType.includes(opt)}
                      onChange={() => toggleValue(setSelectedType, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>

              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Session</p>
              <div className="space-y-1">
                {sessionOptions.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={selectedSession.includes(opt)}
                      onChange={() => toggleValue(setSelectedSession, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          </details>

          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="ml-auto rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <option value="newest">Newest</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {selectedDirection.map((value) => (
            <button
              key={`direction-${value}`}
              type="button"
              onClick={() => setSelectedDirection((prev) => prev.filter((v) => v !== value))}
              className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs px-2 py-1 rounded-md"
            >
              Direction: {value} ×
            </button>
          ))}
          {selectedType.map((value) => (
            <button
              key={`type-${value}`}
              type="button"
              onClick={() => setSelectedType((prev) => prev.filter((v) => v !== value))}
              className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs px-2 py-1 rounded-md"
            >
              Type: {value} ×
            </button>
          ))}
          {selectedSession.map((value) => (
            <button
              key={`session-${value}`}
              type="button"
              onClick={() => setSelectedSession((prev) => prev.filter((v) => v !== value))}
              className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs px-2 py-1 rounded-md"
            >
              Session: {value} ×
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-10 text-sm text-gray-500 dark:text-gray-400">Loading playbooks...</div>
        ) : error ? (
          <div className="mt-10 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center dark:border-gray-700 dark:bg-gray-900">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Nothing found
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Adjust filters and search to discover more playbooks.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((folder) => {
              const cover = folder.cover_url || fallbackCovers[String(folder.id)] || "";
              return (
                <Link
                  key={folder.id}
                  href={`/playbook/${encodeURIComponent(String(folder.share_id ?? ""))}`}
                  className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-1 hover:scale-[1.01] hover:shadow-lg dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="relative h-40 w-full bg-gray-100 dark:bg-gray-800">
                    {cover ? (
                      <img
                        src={cover}
                        alt={`${folder.name} cover`}
                        className="h-full w-full object-cover transition-all duration-200 ease-in-out group-hover:scale-[1.04]"
                        draggable={false}
                      />
                    ) : null}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                    <span className="absolute right-2 top-2 rounded-full bg-black/75 px-2.5 py-0.5 text-xs font-medium text-white">
                      {folder.is_paid ? `€${Number(folder.price ?? 0).toFixed(0)}` : "Free"}
                    </span>
                    <p className="absolute bottom-2 left-3 right-3 line-clamp-2 text-sm font-semibold text-white drop-shadow">
                      {folder.name}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

