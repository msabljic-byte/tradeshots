"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { FolderOpen } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { MarketplacePlaybook } from "@/components/marketplace/MarketplaceView";

export type ProfileIdentity = {
  userId: string;
  username: string;
  avatarUrl: string;
};

type ProfilePlaybook = {
  id: string;
  name: string;
  share_id: string;
  cover_url?: string | null;
  is_paid?: boolean | null;
  price?: number | null;
  asset_types?: string[] | null;
  screenshotCount: number;
  displayCover: string;
};

export default function ProfileView({
  profile,
  onBack,
  onOpenPlaybook,
}: {
  profile: ProfileIdentity | null;
  onBack?: () => void;
  onOpenPlaybook?: (playbook: MarketplacePlaybook) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [resolvedProfile, setResolvedProfile] = useState<ProfileIdentity | null>(profile);
  const [playbooks, setPlaybooks] = useState<ProfilePlaybook[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  useEffect(() => {
    setResolvedProfile(profile);
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const username = String(profile?.username ?? "").trim();
      if (!username) {
        if (!cancelled) {
          setPlaybooks([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      let profileQuery = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .eq("username", username)
        .limit(1);
      if (!profileQuery.error && (!profileQuery.data || profileQuery.data.length === 0)) {
        profileQuery = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .ilike("username", username)
          .limit(1);
      }
      const row = profileQuery.data?.[0] as
        | { id?: string | null; username?: string | null; avatar_url?: string | null }
        | undefined;
      const userId = String(row?.id ?? "").trim();
      if (!userId) {
        if (!cancelled) {
          setPlaybooks([]);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setResolvedProfile({
          userId,
          username: String(row?.username ?? "").trim() || username,
          avatarUrl: String(row?.avatar_url ?? "").trim(),
        });
      }

      const foldersQuery = await supabase
        .from("folders")
        .select("id, name, share_id, cover_url, is_paid, price, asset_types")
        .eq("user_id", userId)
        .eq("is_public", true)
        .not("share_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);
      const folders = ((foldersQuery.data ?? []) as Array<Record<string, unknown>>)
        .map((item) => ({
          id: String(item.id ?? ""),
          name: String(item.name ?? "").trim() || "Playbook",
          share_id: String(item.share_id ?? "").trim(),
          cover_url: String(item.cover_url ?? "").trim(),
          is_paid: Boolean(item.is_paid),
          price: typeof item.price === "number" ? item.price : null,
          asset_types: Array.isArray(item.asset_types) ? (item.asset_types as string[]) : [],
        }))
        .filter((item) => item.id && item.share_id);

      if (folders.length === 0) {
        if (!cancelled) {
          setPlaybooks([]);
          setLoading(false);
        }
        return;
      }

      const folderIds = folders.map((item) => item.id);
      const shotsQuery = await supabase
        .from("screenshots")
        .select("folder_id, image_url, created_at")
        .in("folder_id", folderIds)
        .order("created_at", { ascending: true });
      const byFolderCover: Record<string, string> = {};
      const byFolderCount: Record<string, number> = {};
      if (!shotsQuery.error) {
        for (const rowItem of (shotsQuery.data ?? []) as Array<Record<string, unknown>>) {
          const folderId = String(rowItem.folder_id ?? "").trim();
          const imageUrl = String(rowItem.image_url ?? "").trim();
          if (!folderId || !imageUrl) continue;
          if (!byFolderCover[folderId]) byFolderCover[folderId] = imageUrl;
          byFolderCount[folderId] = (byFolderCount[folderId] ?? 0) + 1;
        }
      }

      if (!cancelled) {
        setPlaybooks(
          folders.map((item) => ({
            ...item,
            screenshotCount: byFolderCount[item.id] ?? 0,
            displayCover: item.cover_url || byFolderCover[item.id] || "",
          }))
        );
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profile?.username]);

  useEffect(() => {
    let cancelled = false;
    async function loadFollowState() {
      const followingId = String(resolvedProfile?.userId ?? "").trim();
      if (!followingId) {
        if (!cancelled) setIsFollowing(false);
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const followerId = String(auth.user?.id ?? "").trim();
      if (!followerId || followerId === followingId) {
        if (!cancelled) setIsFollowing(false);
        return;
      }
      const query = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", followerId)
        .eq("following_id", followingId)
        .limit(1);
      if (!cancelled) setIsFollowing(Boolean(query.data?.[0]?.id));
    }
    void loadFollowState();
    return () => {
      cancelled = true;
    };
  }, [resolvedProfile?.userId]);

  useEffect(() => {
    let cancelled = false;
    async function loadFollowCounts() {
      const userId = String(resolvedProfile?.userId ?? "").trim();
      if (!userId) {
        if (!cancelled) {
          setFollowersCount(0);
          setFollowingCount(0);
        }
        return;
      }
      const [followersRes, followingRes] = await Promise.all([
        supabase
          .from("follows")
          .select("*", { count: "exact", head: true })
          .eq("following_id", userId),
        supabase
          .from("follows")
          .select("*", { count: "exact", head: true })
          .eq("follower_id", userId),
      ]);
      if (cancelled) return;
      setFollowersCount(typeof followersRes.count === "number" ? followersRes.count : 0);
      setFollowingCount(typeof followingRes.count === "number" ? followingRes.count : 0);
    }
    void loadFollowCounts();
    return () => {
      cancelled = true;
    };
  }, [resolvedProfile?.userId]);

  async function toggleFollow() {
    if (followPending) return;
    const followingId = String(resolvedProfile?.userId ?? "").trim();
    if (!followingId) return;

    const { data: auth } = await supabase.auth.getUser();
    const followerId = String(auth.user?.id ?? "").trim();
    if (!followerId) {
      const username = String(resolvedProfile?.username ?? "").trim();
      const next = username ? `/profile/${encodeURIComponent(username)}` : "/dashboard";
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    if (followerId === followingId) return;

    const wasFollowing = isFollowing;
    setFollowPending(true);
    setIsFollowing(!wasFollowing);
    setFollowersCount((prev) => Math.max(0, prev + (wasFollowing ? -1 : 1)));
    try {
      if (wasFollowing) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", followerId)
          .eq("following_id", followingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("follows").insert({
          follower_id: followerId,
          following_id: followingId,
        });
        if (error) throw error;
      }
    } catch {
      setIsFollowing(wasFollowing);
      setFollowersCount((prev) => Math.max(0, prev + (wasFollowing ? 1 : -1)));
    } finally {
      setFollowPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="micro-btn rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-all duration-150 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Back to Marketplace
        </button>
      </div>
      <div className="flex items-center gap-3">
        {resolvedProfile?.avatarUrl ? (
          <Image
            src={resolvedProfile.avatarUrl}
            alt={`${resolvedProfile.username} avatar`}
            width={32}
            height={32}
            loading="lazy"
            className="h-8 w-8 rounded-full bg-gray-300 object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-8 h-8 rounded-full object-cover bg-gray-300 flex items-center justify-center text-xs font-medium">
            {String(resolvedProfile?.username ?? "U").charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {resolvedProfile?.username ?? "Profile"}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {playbooks.length} public playbooks
            {" • "}
            {followersCount} followers
            {" • "}
            {followingCount} following
          </p>
        </div>
        {resolvedProfile?.userId ? (
          <button
            type="button"
            onClick={() => void toggleFollow()}
            disabled={followPending}
            className={`btn btn-secondary disabled:cursor-not-allowed disabled:opacity-60 ${
              isFollowing
                ? "opacity-80"
                : ""
            }`}
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-700 dark:text-gray-300">Loading profile...</div>
      ) : playbooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-10 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-col items-center justify-center text-center">
            <FolderOpen size={28} className="text-gray-500 dark:text-gray-400" aria-hidden />
            <p className="mt-3 text-base font-medium text-gray-900 dark:text-gray-100">
              Nothing saved yet.
            </p>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="mt-4 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-all duration-150 ease-in-out hover:opacity-90"
            >
              Begin your record
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {playbooks.map((item) => {
            const primaryAsset =
              Array.isArray(item.asset_types) && item.asset_types.length > 0
                ? item.asset_types[0]
                : "General";
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (onOpenPlaybook) {
                    onOpenPlaybook(item as MarketplacePlaybook);
                    return;
                  }
                  router.push(`/playbook/${encodeURIComponent(item.share_id)}`);
                }}
                className="group micro-card overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="relative h-40 w-full overflow-hidden ui-media-placeholder">
                  {item.displayCover ? (
                    <Image
                      src={item.displayCover}
                      alt={`${item.name} cover`}
                      fill
                      sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw"
                      loading="lazy"
                      className="object-cover transition-transform duration-200 ease-out group-hover:scale-110"
                      draggable={false}
                    />
                  ) : null}
                  <div className="ui-media-overlay pointer-events-none absolute inset-x-0 bottom-0 h-16" />
                  <span className="absolute right-2 top-2 rounded-full bg-black/75 px-2.5 py-0.5 text-xs font-medium text-white opacity-90 transition-opacity duration-200 ease-out group-hover:opacity-100">
                    {item.is_paid ? `€${Number(item.price ?? 0).toFixed(0)}` : "Free"}
                  </span>
                  <p className="absolute bottom-2 left-3 right-3 line-clamp-2 text-base font-bold text-white drop-shadow">
                    {item.name}
                  </p>
                </div>
                <div className="space-y-2 p-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {item.screenshotCount} screenshots • {primaryAsset}
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

