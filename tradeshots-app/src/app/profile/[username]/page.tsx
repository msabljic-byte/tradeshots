"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { FolderOpen } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  username: string;
  avatar_url?: string | null;
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

export default function AuthorProfilePage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const usernameParam = String(params?.username ?? "").trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [playbooks, setPlaybooks] = useState<ProfilePlaybook[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadProfileView() {
      if (!usernameParam) {
        if (!cancelled) {
          setError("Profile not found");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      let profileQuery = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .eq("username", usernameParam)
        .limit(1);

      if (!profileQuery.error && (!profileQuery.data || profileQuery.data.length === 0)) {
        profileQuery = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .ilike("username", usernameParam)
          .limit(1);
      }

      if (profileQuery.error || !profileQuery.data?.[0]) {
        if (!cancelled) {
          setProfile(null);
          setPlaybooks([]);
          setError("Profile not found");
          setLoading(false);
        }
        return;
      }

      const profileRow = profileQuery.data[0] as ProfileRow;
      if (cancelled) return;
      setProfile(profileRow);

      const foldersQuery = await supabase
        .from("folders")
        .select("id, name, share_id, cover_url, is_paid, price, asset_types")
        .eq("user_id", profileRow.id)
        .eq("is_public", true)
        .not("share_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(24);

      if (foldersQuery.error) {
        if (!cancelled) {
          setPlaybooks([]);
          setLoading(false);
        }
        return;
      }

      const folders = ((foldersQuery.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => ({
          id: String(row.id ?? ""),
          name: String(row.name ?? "").trim() || "Playbook",
          share_id: String(row.share_id ?? "").trim(),
          cover_url: String(row.cover_url ?? "").trim(),
          is_paid: Boolean(row.is_paid),
          price: typeof row.price === "number" ? row.price : null,
          asset_types: Array.isArray(row.asset_types) ? (row.asset_types as string[]) : [],
        }))
        .filter((row) => row.id && row.share_id);

      if (folders.length === 0) {
        if (!cancelled) {
          setPlaybooks([]);
          setLoading(false);
        }
        return;
      }

      const folderIds = folders.map((folder) => folder.id);
      const shotsQuery = await supabase
        .from("screenshots")
        .select("folder_id, image_url, created_at")
        .in("folder_id", folderIds)
        .order("created_at", { ascending: true });

      const byFolderCover: Record<string, string> = {};
      const byFolderCount: Record<string, number> = {};
      if (!shotsQuery.error) {
        for (const row of (shotsQuery.data ?? []) as Array<Record<string, unknown>>) {
          const folderId = String(row.folder_id ?? "").trim();
          const imageUrl = String(row.image_url ?? "").trim();
          if (!folderId || !imageUrl) continue;
          if (!byFolderCover[folderId]) byFolderCover[folderId] = imageUrl;
          byFolderCount[folderId] = (byFolderCount[folderId] ?? 0) + 1;
        }
      }

      const normalized: ProfilePlaybook[] = folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        share_id: folder.share_id,
        cover_url: folder.cover_url,
        is_paid: folder.is_paid,
        price: folder.price,
        asset_types: folder.asset_types,
        screenshotCount: byFolderCount[folder.id] ?? 0,
        displayCover: folder.cover_url || byFolderCover[folder.id] || "",
      }));

      if (!cancelled) {
        setPlaybooks(normalized);
        setLoading(false);
      }
    }

    void loadProfileView();
    return () => {
      cancelled = true;
    };
  }, [usernameParam]);

  useEffect(() => {
    let cancelled = false;
    async function loadFollowState() {
      const followingId = String(profile?.id ?? "").trim();
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
  }, [profile?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadFollowCounts() {
      const userId = String(profile?.id ?? "").trim();
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
  }, [profile?.id]);

  async function toggleFollow() {
    if (!profile || followPending) return;
    const followingId = String(profile.id ?? "").trim();
    if (!followingId) return;
    const { data: auth } = await supabase.auth.getUser();
    const followerId = String(auth.user?.id ?? "").trim();
    if (!followerId) {
      router.push(`/login?next=${encodeURIComponent(`/profile/${usernameParam}`)}`);
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

  if (loading) {
    return <div className="mx-auto max-w-6xl p-6 text-sm text-gray-700 dark:text-gray-300">Loading profile...</div>;
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <p className="text-sm text-gray-700 dark:text-gray-300">{error ?? "Profile not found"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        {profile.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt={`${profile.username} avatar`}
            width={32}
            height={32}
            loading="lazy"
            className="h-8 w-8 rounded-full bg-gray-300 object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-8 h-8 rounded-full object-cover bg-gray-300 flex items-center justify-center text-xs font-medium">
            {profile.username.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{profile.username}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {playbooks.length} public playbooks
            {" • "}
            {followersCount} followers
            {" • "}
            {followingCount} following
          </p>
        </div>
        <button
          type="button"
          onClick={() => void toggleFollow()}
          disabled={followPending}
          className={`ml-auto rounded-md border px-3 py-1.5 text-sm transition-all duration-150 ease-in-out disabled:cursor-not-allowed disabled:opacity-60 ${
            isFollowing
              ? "border-black bg-black text-white hover:opacity-90"
              : "border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
          }`}
        >
          {isFollowing ? "Following" : "Follow"}
        </button>
      </div>

      {playbooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-10 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-col items-center justify-center text-center">
            <FolderOpen size={28} className="text-gray-500 dark:text-gray-400" aria-hidden />
            <p className="mt-3 text-base font-medium text-gray-900 dark:text-gray-100">
              Create your first playbook
            </p>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="mt-4 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-all duration-150 ease-in-out hover:opacity-90"
            >
              Upload screenshot
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
                onClick={() => router.push(`/playbook/${encodeURIComponent(item.share_id)}`)}
                className="group micro-card overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="relative h-40 w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
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
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                  <span className="absolute right-2 top-2 rounded-full bg-black/75 px-2.5 py-0.5 text-xs font-medium text-white opacity-90 transition-opacity duration-200 ease-out group-hover:opacity-100">
                    {item.is_paid ? `€${Number(item.price ?? 0).toFixed(0)}` : "Free"}
                  </span>
                  <p className="absolute bottom-2 left-3 right-3 line-clamp-2 text-base font-bold text-white drop-shadow">
                    {item.name}
                  </p>
                </div>

                <div className="space-y-2 p-4">
                  <p className="line-clamp-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {item.name || "Playbook"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {item.screenshotCount} screenshots • {primaryAsset}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {profile.username}
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

