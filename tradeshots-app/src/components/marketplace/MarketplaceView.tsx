"use client";

/**
 * Marketplace discovery (embedded in dashboard layout).
 * Lists public playbooks, search, filters, sort.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Mic, Pencil, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import SkeletonCard from "@/components/marketplace/SkeletonCard";

type MarketplaceFolder = {
  id: string;
  name: string;
  cover_url?: string | null;
  is_paid?: boolean | null;
  price?: number | null;
  share_id?: string | null;
  created_at?: string | null;
  asset_types?: string[] | null;
  timeframe?: string | null;
  strategy_types?: string[] | null;
  experience_level?: string | null;
  has_annotations?: boolean | null;
  has_notes?: boolean | null;
  has_voice?: boolean | null;
  user_id?: string | null;
};

type PriceFilter = "all" | "free" | "paid";
type SortMode = "newest" | "price-asc" | "price-desc";

export type MarketplacePlaybook = MarketplaceFolder;

export default function MarketplaceView({
  onOpenPlaybook,
}: {
  onOpenPlaybook?: (playbook: MarketplacePlaybook) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [playbooks, setPlaybooks] = useState<MarketplaceFolder[]>([]);
  const [fallbackCovers, setFallbackCovers] = useState<Record<string, string>>({});
  const [screenshotCounts, setScreenshotCounts] = useState<Record<string, number>>({});
  const [creatorByFolder, setCreatorByFolder] = useState<
    Record<string, { name: string; avatarUrl: string }>
  >({});
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>("");
  const [selectedStrategyTypes, setSelectedStrategyTypes] = useState<string[]>([]);
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<string>("");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  const assetTypeOptions = ["Stocks", "Futures", "Forex", "Crypto", "Options"];
  const timeframeOptions = ["Scalping", "Intraday", "Swing", "Position"];
  const strategyTypeOptions = ["Breakout", "Reversal", "Trend", "Range", "Momentum"];
  const experienceLevelOptions = ["Beginner", "Intermediate", "Advanced"];
  const featureOptions = ["Has Annotations", "Has Notes", "Has Voice"];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      let folderQuery = await supabase
        .from("folders")
        .select(
          "id, name, cover_url, is_paid, price, share_id, is_public, created_at, user_id, asset_types, timeframe, strategy_types, experience_level, has_annotations, has_notes, has_voice"
        )
        .eq("is_public", true)
        .not("share_id", "is", null)
        .order("created_at", { ascending: false });

      if (folderQuery.error) {
        const retry = await supabase
          .from("folders")
          .select("id, name, cover_url, is_paid, price, share_id, is_public, created_at, user_id")
          .eq("is_public", true)
          .not("share_id", "is", null)
          .order("created_at", { ascending: false });
        folderQuery = retry as typeof folderQuery;
      }

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
      const creatorIds = Array.from(
        new Set(
          rows
            .map((f) => String(f.user_id ?? "").trim())
            .filter((id) => id.length > 0)
        )
      );

      if (folderIds.length > 0) {
        const shotsQuery = await supabase
          .from("screenshots")
          .select("folder_id, image_url, created_at")
          .in("folder_id", folderIds)
          .order("created_at", { ascending: true });

        if (!shotsQuery.error) {
          const byFolder: Record<string, string> = {};
          const countByFolder: Record<string, number> = {};
          for (const row of (shotsQuery.data ?? []) as Array<{
            folder_id: string | null;
            image_url: string | null;
          }>) {
            const fid = row.folder_id ? String(row.folder_id) : "";
            const url = row.image_url ? String(row.image_url) : "";
            if (!fid || !url) continue;
            if (!byFolder[fid]) byFolder[fid] = url;
            countByFolder[fid] = (countByFolder[fid] ?? 0) + 1;
          }
          if (!cancelled) {
            setFallbackCovers(byFolder);
            setScreenshotCounts(countByFolder);
          }
        }
      }

      if (creatorIds.length > 0) {
        const creatorsQuery = await supabase
          .from("users")
          .select("id, name, avatar_url, email")
          .in("id", creatorIds);

        if (!creatorsQuery.error) {
          const byId: Record<string, { name: string; avatarUrl: string }> = {};
          for (const row of (creatorsQuery.data ?? []) as Array<{
            id: string;
            name?: string | null;
            avatar_url?: string | null;
            email?: string | null;
          }>) {
            const id = String(row.id ?? "").trim();
            if (!id) continue;
            byId[id] = {
              name: String(row.name ?? "").trim() || String(row.email ?? "").trim() || "Trader",
              avatarUrl: String(row.avatar_url ?? "").trim(),
            };
          }
          const byFolder: Record<string, { name: string; avatarUrl: string }> = {};
          for (const folder of rows) {
            const uid = String(folder.user_id ?? "").trim();
            if (!uid || !byId[uid]) continue;
            byFolder[String(folder.id)] = byId[uid];
          }
          if (!cancelled) setCreatorByFolder(byFolder);
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
      const folderAssets = Array.isArray(p.asset_types) ? p.asset_types : [];
      const folderStrategies = Array.isArray(p.strategy_types) ? p.strategy_types : [];
      const passAsset =
        selectedAssetTypes.length === 0 ||
        selectedAssetTypes.some((v) => folderAssets.includes(v));
      const passTimeframe = selectedTimeframe.length === 0 || p.timeframe === selectedTimeframe;
      const passStrategy =
        selectedStrategyTypes.length === 0 ||
        selectedStrategyTypes.some((v) => folderStrategies.includes(v));
      const passExperience =
        selectedExperienceLevel.length === 0 || p.experience_level === selectedExperienceLevel;
      const passFeatures = selectedFeatures.every((feature) => {
        if (feature === "Has Annotations") return Boolean(p.has_annotations);
        if (feature === "Has Notes") return Boolean(p.has_notes);
        if (feature === "Has Voice") return Boolean(p.has_voice);
        return true;
      });
      return passAsset && passTimeframe && passStrategy && passExperience && passFeatures;
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
    selectedAssetTypes,
    selectedTimeframe,
    selectedStrategyTypes,
    selectedExperienceLevel,
    selectedFeatures,
  ]);

  function toggleValue(setter: Dispatch<SetStateAction<string[]>>, value: string) {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Marketplace</h1>
        <p className="text-sm text-gray-700 dark:text-gray-300">
        Discover public playbooks and import the ones you like.
        </p>
      </div>

      <div>
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search strategies..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-gray-500"
          />
        </label>
      </div>

      <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPriceFilter("all")}
          className={`micro-btn rounded-md px-3 py-1.5 text-sm font-medium ${
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
          className={`micro-btn rounded-md px-3 py-1.5 text-sm font-medium ${
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
          className={`micro-btn rounded-md px-3 py-1.5 text-sm font-medium ${
            priceFilter === "paid"
              ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          Paid
        </button>

        <details className="relative">
          <summary className="micro-btn list-none cursor-pointer rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
            Filters
          </summary>
          <div className="absolute left-0 top-9 z-20 w-[22rem] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Asset Type</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {assetTypeOptions.map((opt) => {
                const selected = selectedAssetTypes.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleValue(setSelectedAssetTypes, opt)}
                    className={`micro-pill rounded-full px-2.5 py-1 text-sm font-medium ${
                      selected
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Timeframe</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {timeframeOptions.map((opt) => {
                const selected = selectedTimeframe === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSelectedTimeframe(selected ? "" : opt)}
                    className={`micro-pill rounded-full px-2.5 py-1 text-sm font-medium ${
                      selected
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Strategy Type</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {strategyTypeOptions.map((opt) => {
                const selected = selectedStrategyTypes.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleValue(setSelectedStrategyTypes, opt)}
                    className={`micro-pill rounded-full px-2.5 py-1 text-sm font-medium ${
                      selected
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Experience Level</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {experienceLevelOptions.map((opt) => {
                const selected = selectedExperienceLevel === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSelectedExperienceLevel(selected ? "" : opt)}
                    className={`micro-pill rounded-full px-2.5 py-1 text-sm font-medium ${
                      selected
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Features</p>
            <div className="flex flex-wrap gap-2">
              {featureOptions.map((opt) => {
                const selected = selectedFeatures.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleValue(setSelectedFeatures, opt)}
                    className={`micro-pill rounded-full px-2.5 py-1 text-sm font-medium ${
                      selected
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        </details>

        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="micro-btn ml-auto rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        >
          <option value="newest">Newest</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {selectedAssetTypes.map((value) => (
          <button
            key={`asset-${value}`}
            type="button"
            onClick={() => setSelectedAssetTypes((prev) => prev.filter((v) => v !== value))}
            className="micro-pill rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            Asset: {value} ×
          </button>
        ))}
        {selectedTimeframe ? (
          <button
            key={`timeframe-${selectedTimeframe}`}
            type="button"
            onClick={() => setSelectedTimeframe("")}
            className="micro-pill rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            Timeframe: {selectedTimeframe} ×
          </button>
        ) : null}
        {selectedStrategyTypes.map((value) => (
          <button
            key={`strategy-${value}`}
            type="button"
            onClick={() => setSelectedStrategyTypes((prev) => prev.filter((v) => v !== value))}
            className="micro-pill rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            Strategy: {value} ×
          </button>
        ))}
        {selectedExperienceLevel ? (
          <button
            key={`experience-${selectedExperienceLevel}`}
            type="button"
            onClick={() => setSelectedExperienceLevel("")}
            className="micro-pill rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            Experience: {selectedExperienceLevel} ×
          </button>
        ) : null}
        {selectedFeatures.map((value) => (
          <button
            key={`feature-${value}`}
            type="button"
            onClick={() => setSelectedFeatures((prev) => prev.filter((v) => v !== value))}
            className="micro-pill rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            {value} ×
          </button>
        ))}
      </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 10 }, (_, i) => (
            <SkeletonCard key={`marketplace-skeleton-${i}`} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="space-y-2 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            No results found — adjust filters
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Adjust filters and search to discover more playbooks.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((folder) => {
            const cover = folder.cover_url || fallbackCovers[String(folder.id)] || "";
            const creator = creatorByFolder[String(folder.id)] ?? { name: "Trader", avatarUrl: "" };
            const screenshotCount = screenshotCounts[String(folder.id)] ?? 0;
            const primaryAsset = Array.isArray(folder.asset_types) && folder.asset_types.length > 0
              ? folder.asset_types[0]
              : "General";
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onOpenPlaybook?.(folder)}
                className="group micro-card overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="relative h-40 w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                  {cover ? (
                    <img
                      src={cover}
                      alt={`${folder.name} cover`}
                      className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-110"
                      draggable={false}
                    />
                  ) : null}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                  <span className="absolute right-2 top-2 rounded-full bg-black/75 px-2.5 py-0.5 text-xs font-medium text-white opacity-90 transition-opacity duration-200 ease-out group-hover:opacity-100">
                    {folder.is_paid ? `€${Number(folder.price ?? 0).toFixed(0)}` : "Free"}
                  </span>
                  <p className="absolute bottom-2 left-3 right-3 line-clamp-2 text-base font-bold text-white drop-shadow">
                    {folder.name}
                  </p>
                </div>

                <div className="space-y-2 p-4">
                  <p className="line-clamp-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {folder.name || "Playbook"}
                  </p>

                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {screenshotCount} screenshots • {primaryAsset}
                  </p>

                  <div className="flex gap-1 text-xs text-gray-500 dark:text-gray-400">
                    {folder.has_annotations ? <span title="Annotations">✏️</span> : null}
                    {folder.has_voice ? <span title="Voice">🎤</span> : null}
                  </div>

                  <p className="truncate text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    by {creator.name}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
