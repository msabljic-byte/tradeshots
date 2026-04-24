"use client";

/**
 * Marketplace discovery (embedded in dashboard layout).
 * Lists public playbooks, search, filters, sort.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Flame, Mic, Pencil, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import SkeletonCard from "@/components/marketplace/SkeletonCard";
import { Logo } from "@/components/brand/Logo";

type MarketplaceFolder = {
  id: string;
  name: string;
  cover_url?: string | null;
  is_paid?: boolean | null;
  price?: number | null;
  share_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
type SortMode = "new" | "popular" | "most-imported" | "recently-updated";

export type MarketplacePlaybook = MarketplaceFolder;
export type MarketplaceAuthorProfile = {
  userId: string;
  username: string;
  avatarUrl: string;
};

export default function MarketplaceView({
  onOpenPlaybook,
  onOpenAuthorProfile,
}: {
  onOpenPlaybook?: (playbook: MarketplacePlaybook) => void;
  onOpenAuthorProfile?: (author: MarketplaceAuthorProfile) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("new");
  const [playbooks, setPlaybooks] = useState<MarketplaceFolder[]>([]);
  const [fallbackCovers, setFallbackCovers] = useState<Record<string, string>>({});
  const [screenshotCounts, setScreenshotCounts] = useState<Record<string, number>>({});
  const [likesCounts, setLikesCounts] = useState<Record<string, number>>({});
  const [importsCounts, setImportsCounts] = useState<Record<string, number>>({});
  const [creatorByFolder, setCreatorByFolder] = useState<
    Record<string, { name: string; avatarUrl: string }>
  >({});
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>("");
  const [selectedStrategyTypes, setSelectedStrategyTypes] = useState<string[]>([]);
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<string>("");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  const assetTypeOptions = ["Stocks", "Forex", "Crypto", "Options"];
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
          "id, name, cover_url, is_paid, price, share_id, is_public, created_at, updated_at, user_id, asset_types, timeframe, strategy_types, experience_level, has_annotations, has_notes, has_voice"
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

        const likesQuery = await supabase
          .from("playbook_likes")
          .select("playbook_id")
          .in("playbook_id", folderIds);
        if (!likesQuery.error) {
          const likesByFolder: Record<string, number> = {};
          for (const row of (likesQuery.data ?? []) as Array<{ playbook_id: string | null }>) {
            const fid = String(row.playbook_id ?? "").trim();
            if (!fid) continue;
            likesByFolder[fid] = (likesByFolder[fid] ?? 0) + 1;
          }
          if (!cancelled) setLikesCounts(likesByFolder);
        }

        const importsQuery = await supabase
          .from("user_playbooks")
          .select("source_folder_id")
          .in("source_folder_id", folderIds);
        if (!importsQuery.error) {
          const importsByFolder: Record<string, number> = {};
          for (const row of (importsQuery.data ?? []) as Array<{ source_folder_id: string | null }>) {
            const fid = String(row.source_folder_id ?? "").trim();
            if (!fid) continue;
            importsByFolder[fid] = (importsByFolder[fid] ?? 0) + 1;
          }
          if (!cancelled) setImportsCounts(importsByFolder);
        }
      }

      if (creatorIds.length > 0) {
        const creatorsQuery = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", creatorIds);

        if (!creatorsQuery.error) {
          const byId: Record<string, { name: string; avatarUrl: string }> = {};
          for (const row of (creatorsQuery.data ?? []) as Array<{
            id: string;
            username?: string | null;
            avatar_url?: string | null;
          }>) {
            const id = String(row.id ?? "").trim();
            if (!id) continue;
            byId[id] = {
              name: String(row.username ?? "").trim() || "Unknown",
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
      if (sortMode === "new") {
        const da = new Date(a.created_at ?? 0).getTime();
        const db = new Date(b.created_at ?? 0).getTime();
        return db - da;
      }
      if (sortMode === "popular") {
        const la = likesCounts[String(a.id)] ?? 0;
        const lb = likesCounts[String(b.id)] ?? 0;
        if (lb !== la) return lb - la;
        const da = new Date(a.created_at ?? 0).getTime();
        const db = new Date(b.created_at ?? 0).getTime();
        return db - da;
      }
      if (sortMode === "most-imported") {
        const ia = importsCounts[String(a.id)] ?? 0;
        const ib = importsCounts[String(b.id)] ?? 0;
        if (ib !== ia) return ib - ia;
        const da = new Date(a.created_at ?? 0).getTime();
        const db = new Date(b.created_at ?? 0).getTime();
        return db - da;
      }
      const ua = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const ub = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      return ub - ua;
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
    likesCounts,
    importsCounts,
  ]);

  const trendingPlaybooks = useMemo(() => {
    function recentActivityScore(updatedAt?: string | null, createdAt?: string | null) {
      const ts = new Date(updatedAt ?? createdAt ?? 0).getTime();
      if (!Number.isFinite(ts) || ts <= 0) return 0;
      const ageDays = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
      if (ageDays <= 1) return 5;
      if (ageDays <= 7) return 3;
      if (ageDays <= 30) return 1;
      return 0;
    }

    return [...playbooks]
      .map((p) => {
        const likes = likesCounts[String(p.id)] ?? 0;
        const imports = importsCounts[String(p.id)] ?? 0;
        const recent = recentActivityScore(p.updated_at, p.created_at);
        const trendingScore = likes + imports + recent;
        const ts = new Date(p.updated_at ?? p.created_at ?? 0).getTime();
        const isHot = Number.isFinite(ts) && ts > 0 && Date.now() - ts <= 1000 * 60 * 60 * 24;
        return { playbook: p, likes, imports, recent, trendingScore, isHot };
      })
      .sort((a, b) => {
        if (b.trendingScore !== a.trendingScore) return b.trendingScore - a.trendingScore;
        const au = new Date(a.playbook.updated_at ?? a.playbook.created_at ?? 0).getTime();
        const bu = new Date(b.playbook.updated_at ?? b.playbook.created_at ?? 0).getTime();
        return bu - au;
      })
      .slice(0, 5);
  }, [playbooks, likesCounts, importsCounts]);

  function toggleValue(setter: Dispatch<SetStateAction<string[]>>, value: string) {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  return (
    <div className="app-shell-content space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Logo variant="horizontal" sealSize="sm" />
          <h1 className="app-section-title">Marketplace</h1>
        </div>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="ui-input micro-btn rounded-md px-3 py-1.5 text-sm"
        >
          <option value="new">New</option>
          <option value="popular">Popular</option>
          <option value="most-imported">Most imported</option>
          <option value="recently-updated">Recently updated</option>
        </select>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300">Find a playbook that matches your process.</p>

      <div>
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search strategies..."
            className="ui-input w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none"
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

      {!loading && trendingPlaybooks.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Trending Playbooks</h2>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Likes + Imports + Recent Activity
            </p>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {trendingPlaybooks.map(({ playbook, likes, imports, trendingScore, isHot }) => {
              const cover = playbook.cover_url || fallbackCovers[String(playbook.id)] || "";
              const creator = creatorByFolder[String(playbook.id)] ?? { name: "Unknown", avatarUrl: "" };
              return (
                <button
                  key={`trending-${playbook.id}`}
                  type="button"
                  onClick={() => onOpenPlaybook?.(playbook)}
                  className="group min-w-[300px] max-w-[300px] overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="relative h-40 w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                    {cover ? (
                      <img
                        src={cover}
                        alt={`${playbook.name} cover`}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        draggable={false}
                      />
                    ) : null}
                    <span className="ui-badge ui-badge-overlay absolute right-2 top-2 px-2 py-0.5">
                      Score {trendingScore}
                    </span>
                  </div>
                  <div className="space-y-1 p-3">
                    <div className="flex items-center gap-1.5">
                      <p className="line-clamp-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                        {playbook.name || "Playbook"}
                      </p>
                      {isHot ? (
                        <span
                          className="inline-flex items-center text-orange-500"
                          title="Hot: active in last 24h"
                          aria-label="Hot playbook"
                        >
                          <Flame size={14} />
                        </span>
                      ) : null}
                    </div>
                    <p className="line-clamp-1 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {creator.name}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{imports} imports</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

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
            No matches yet.
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Refine your filters and try again.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((folder) => {
            const cover = folder.cover_url || fallbackCovers[String(folder.id)] || "";
            const creator = creatorByFolder[String(folder.id)] ?? { name: "Unknown", avatarUrl: "" };
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
                <div className="relative h-40 w-full overflow-hidden ui-media-placeholder">
                  {cover ? (
                    <img
                      src={cover}
                      alt={`${folder.name} cover`}
                      className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-110"
                      draggable={false}
                    />
                  ) : null}
                  <div className="ui-media-overlay pointer-events-none absolute inset-x-0 bottom-0 h-16" />
                  <span className="ui-badge ui-badge-overlay absolute right-2 top-2 px-2.5 py-0.5 opacity-90 transition-opacity duration-200 ease-out group-hover:opacity-100">
                    {folder.is_paid ? `€${Number(folder.price ?? 0).toFixed(0)}` : "Free"}
                  </span>
                  <p className="absolute bottom-2 left-3 right-3 line-clamp-2 text-base font-bold text-white drop-shadow">
                    {folder.name}
                  </p>
                </div>

                <div className="space-y-2 p-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const userId = String(folder.user_id ?? "").trim();
                        if (!userId || !onOpenAuthorProfile) return;
                        onOpenAuthorProfile({
                          userId,
                          username: creator.name,
                          avatarUrl: creator.avatarUrl,
                        });
                      }}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      {creator.avatarUrl ? (
                        <img
                          src={creator.avatarUrl}
                          alt={`${creator.name} avatar`}
                          className="w-8 h-8 rounded-full object-cover bg-gray-300 flex items-center justify-center text-xs font-medium"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full object-cover bg-gray-300 flex items-center justify-center text-xs font-medium">
                          {creator.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <p className="truncate text-xs uppercase tracking-wide text-gray-500 transition-colors hover:underline dark:text-gray-400">
                        {creator.name}
                      </p>
                    </button>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {screenshotCount} screenshots • {primaryAsset}
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
