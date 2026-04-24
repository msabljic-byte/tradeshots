"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import { Download, FileText, Heart, MessageCircle, Mic, Pencil } from "lucide-react";
import ScreenshotModal from "@/components/ScreenshotModal";

export type SelectedPlaybook = {
  id?: string;
  name?: string | null;
  share_id?: string | null;
  cover_url?: string | null;
  updated_at?: string | null;
  is_paid?: boolean | null;
  price?: number | null;
  asset_types?: string[] | null;
  timeframe?: string | null;
  strategy_types?: string[] | null;
  experience_level?: string | null;
  has_annotations?: boolean | null;
  has_notes?: boolean | null;
  has_voice?: boolean | null;
};

export type PlaybookAuthorProfile = {
  userId: string;
  username: string;
  avatarUrl: string;
};

type PreviewScreenshot = {
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
  annotation?: unknown;
  annotations?: unknown;
  attributes?: Array<{ name: string; value: string }>;
};

type PlaybookComment = {
  id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at?: string;
  username: string;
  userInitial: string;
  avatarUrl: string;
  isAuthor: boolean;
  replies: PlaybookComment[];
};

type AuthorPlaybook = {
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

function parseTradeAttributeRow(
  row: Record<string, unknown>
): { key: string; value: string } | null {
  const rawKey =
    row.key ?? row["key"] ?? row.attr_key ?? row.attribute_key ?? row.field ?? row.name;
  const rawValue =
    row.value ?? row["value"] ?? row.attr_value ?? row.attribute_value ?? row.val;
  if (rawKey == null || rawValue == null) return null;
  const key = String(rawKey).trim();
  const value = String(rawValue).trim();
  if (!key || !value) return null;
  return { key, value };
}

export default function PlaybookPreviewView({
  playbook,
  onBack,
  onOpenAuthorProfile,
}: {
  playbook: SelectedPlaybook | null;
  onBack: () => void;
  onOpenAuthorProfile?: (author: PlaybookAuthorProfile) => void;
}) {
  const router = useRouter();
  console.log(playbook);
  const shareId = String(playbook?.share_id ?? "").trim();
  const playbookId = String(playbook?.id ?? "").trim();
  const [coverUrl, setCoverUrl] = useState<string>("");
  const [previewScreenshots, setPreviewScreenshots] = useState<PreviewScreenshot[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [ownedCopyFolderId, setOwnedCopyFolderId] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState("Unknown");
  const [authorUsername, setAuthorUsername] = useState("");
  const [authorAvatarUrl, setAuthorAvatarUrl] = useState("");
  const [resolvedPlaybook, setResolvedPlaybook] = useState<SelectedPlaybook | null>(playbook);
  const [likesCount, setLikesCount] = useState(0);
  const [importsCount, setImportsCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [likeBouncing, setLikeBouncing] = useState(false);
  const [authorUserId, setAuthorUserId] = useState("");
  const [comments, setComments] = useState<PlaybookComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newestCommentId, setNewestCommentId] = useState<string | null>(null);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [activeReplyParentId, setActiveReplyParentId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [postingReplyParentId, setPostingReplyParentId] = useState<string | null>(null);
  const [moreFromAuthor, setMoreFromAuthor] = useState<AuthorPlaybook[]>([]);
  const [isFollowingAuthor, setIsFollowingAuthor] = useState(false);
  const [followPending, setFollowPending] = useState(false);

  function handleOpenAuthorProfile() {
    if (!authorUsername || !authorUserId) return;
    onOpenAuthorProfile?.({
      userId: authorUserId,
      username: authorUsername,
      avatarUrl: authorAvatarUrl,
    });
  }

  useEffect(() => {
    setResolvedPlaybook(playbook);
  }, [playbook]);

  useEffect(() => {
    let cancelled = false;
    async function hydrateMissingMetadata() {
      if (!playbook) return;
      const hasAllFields =
        Array.isArray(playbook.asset_types) &&
        Array.isArray(playbook.strategy_types) &&
        String(playbook.timeframe ?? "").trim().length > 0 &&
        String(playbook.experience_level ?? "").trim().length > 0 &&
        typeof playbook.has_annotations === "boolean" &&
        typeof playbook.has_voice === "boolean" &&
        typeof playbook.has_notes === "boolean";
      if (hasAllFields) return;

      let query = supabase
        .from("folders")
        .select(
          "id, name, share_id, cover_url, is_paid, price, asset_types, timeframe, strategy_types, experience_level, has_annotations, has_voice, has_notes"
        )
        .limit(1);

      if (playbook.id) query = query.eq("id", String(playbook.id));
      else if (playbook.share_id) query = query.eq("share_id", String(playbook.share_id));
      else return;

      const { data, error } = await query;
      if (cancelled || error || !data?.[0]) return;
      const row = data[0] as SelectedPlaybook;
      setResolvedPlaybook((prev) => ({
        ...(prev ?? {}),
        ...row,
      }));
    }
    void hydrateMissingMetadata();
    return () => {
      cancelled = true;
    };
  }, [playbook]);

  useEffect(() => {
    let cancelled = false;
    async function hydrateHeroData() {
      const coverFromPlaybook = String(playbook?.cover_url ?? "").trim();
      if (coverFromPlaybook) {
        if (!cancelled) setCoverUrl(coverFromPlaybook);
      } else if (playbookId) {
        const shot = await supabase
          .from("screenshots")
          .select("image_url")
          .eq("folder_id", playbookId)
          .order("created_at", { ascending: true })
          .limit(1);
        if (!shot.error) {
          const fallback = String(shot.data?.[0]?.image_url ?? "").trim();
          if (!cancelled) setCoverUrl(fallback);
        } else if (!cancelled) {
          setCoverUrl("");
        }
      } else if (!cancelled) {
        setCoverUrl("");
      }

      if (playbookId) {
        const shots = await supabase
          .from("screenshots")
          .select("*")
          .eq("folder_id", playbookId)
          .order("created_at", { ascending: false })
          .limit(9);
        if (!cancelled && !shots.error) {
          const rows = (shots.data ?? []) as Array<Record<string, unknown>>;
          let normalized: PreviewScreenshot[] = rows
            .map((row, index) => ({
              id: String(row.id ?? `preview-${index}`),
              image_url: String(row.image_url ?? "").trim(),
              created_at: row.created_at ? String(row.created_at) : undefined,
              tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
              notes: row.notes ? String(row.notes) : null,
              source_screenshot_id: row.source_screenshot_id
                ? String(row.source_screenshot_id)
                : null,
              voice_memo_url: row.voice_memo_url ? String(row.voice_memo_url) : null,
              voice_memo_duration_ms:
                typeof row.voice_memo_duration_ms === "number"
                  ? row.voice_memo_duration_ms
                  : null,
              private_voice_memo_url: row.private_voice_memo_url
                ? String(row.private_voice_memo_url)
                : null,
              private_voice_memo_duration_ms:
                typeof row.private_voice_memo_duration_ms === "number"
                  ? row.private_voice_memo_duration_ms
                  : null,
              annotation: row.annotation,
              annotations: row.annotations,
            }))
            .filter((row) => row.image_url.length > 0);

          if (normalized.length > 0) {
            const ids = normalized.map((row) => row.id);
            const { data: attrData } = await supabase
              .from("trade_attributes")
              .select("*")
              .in("screenshot_id", ids);

            const byShot: Record<string, Array<{ name: string; value: string }>> = {};
            for (const row of (attrData ?? []) as Record<string, unknown>[]) {
              const parsed = parseTradeAttributeRow(row);
              const sid = row.screenshot_id != null ? String(row.screenshot_id) : "";
              if (!sid || !parsed) continue;
              if (!byShot[sid]) byShot[sid] = [];
              byShot[sid].push({ name: parsed.key, value: parsed.value });
            }

            normalized = normalized.map((shot) => ({
              ...shot,
              attributes: byShot[shot.id] ?? [],
            }));
          }

          setPreviewScreenshots(normalized);
        }
      } else if (!cancelled) {
        setPreviewScreenshots([]);
      }

      if (!playbookId) {
        if (!cancelled) setOwnedCopyFolderId(null);
      } else {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) {
          if (!cancelled) setOwnedCopyFolderId(null);
        } else {
          const owned = await supabase
            .from("user_playbooks")
            .select("copy_folder_id")
            .eq("user_id", user.id)
            .eq("source_folder_id", playbookId)
            .limit(1);
          if (!cancelled) {
            setOwnedCopyFolderId(String(owned.data?.[0]?.copy_folder_id ?? "").trim() || null);
          }
        }
      }

      const ownerFolder = await supabase
        .from("folders")
        .select("user_id")
        .eq("share_id", shareId)
        .limit(1);
      const ownerUserId = String(ownerFolder.data?.[0]?.user_id ?? "").trim();
      if (!ownerUserId) {
        if (!cancelled) {
          setAuthorUserId("");
          setAuthorUsername("");
          setAuthorName("Unknown");
          setAuthorAvatarUrl("");
        }
        return;
      }
      if (!cancelled) setAuthorUserId(ownerUserId);

      const authorQuery = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", ownerUserId)
        .limit(1);
      if (!authorQuery.error && authorQuery.data?.[0]) {
        const row = authorQuery.data[0] as {
          username?: string | null;
          avatar_url?: string | null;
        };
        if (!cancelled) {
          const username = String(row.username ?? "").trim();
          setAuthorUsername(username);
          setAuthorName(username || "Unknown");
          setAuthorAvatarUrl(String(row.avatar_url ?? "").trim());
        }
        return;
      }

      const fallbackAuthor = await supabase
        .from("user_playbooks")
        .select("source_owner_email")
        .eq("source_folder_id", playbookId)
        .limit(1);
      if (!cancelled) {
        setAuthorUsername("");
        const fallbackEmail = String(
          (fallbackAuthor.data?.[0] as { source_owner_email?: string | null } | undefined)
            ?.source_owner_email ?? ""
        ).trim();
        setAuthorName(fallbackEmail || "Unknown");
        setAuthorAvatarUrl("");
      }
    }
    void hydrateHeroData();
    return () => {
      cancelled = true;
    };
  }, [playbook?.cover_url, playbookId]);

  useEffect(() => {
    let cancelled = false;
    async function loadMoreFromAuthor() {
      if (!authorUserId) {
        if (!cancelled) setMoreFromAuthor([]);
        return;
      }

      const currentId = String(resolvedPlaybook?.id ?? playbookId).trim();
      const rowsQuery = await supabase
        .from("folders")
        .select("id, name, share_id, cover_url, is_paid, price, asset_types")
        .eq("user_id", authorUserId)
        .eq("is_public", true)
        .not("share_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(8);
      if (rowsQuery.error) {
        if (!cancelled) setMoreFromAuthor([]);
        return;
      }

      const rows = ((rowsQuery.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => ({
          id: String(row.id ?? ""),
          name: String(row.name ?? "").trim() || "Playbook",
          share_id: String(row.share_id ?? "").trim(),
          cover_url: String(row.cover_url ?? "").trim(),
          is_paid: Boolean(row.is_paid),
          price: typeof row.price === "number" ? row.price : null,
          asset_types: Array.isArray(row.asset_types) ? (row.asset_types as string[]) : [],
        }))
        .filter((row) => row.id && row.share_id && row.id !== currentId);

      if (rows.length === 0) {
        if (!cancelled) setMoreFromAuthor([]);
        return;
      }

      const ids = rows.map((row) => row.id);
      const shotsQuery = await supabase
        .from("screenshots")
        .select("folder_id, image_url, created_at")
        .in("folder_id", ids)
        .order("created_at", { ascending: true });

      const byFolderCover: Record<string, string> = {};
      const byFolderCount: Record<string, number> = {};
      if (!shotsQuery.error) {
        for (const shot of (shotsQuery.data ?? []) as Array<Record<string, unknown>>) {
          const folderId = String(shot.folder_id ?? "").trim();
          const imageUrl = String(shot.image_url ?? "").trim();
          if (!folderId || !imageUrl) continue;
          if (!byFolderCover[folderId]) byFolderCover[folderId] = imageUrl;
          byFolderCount[folderId] = (byFolderCount[folderId] ?? 0) + 1;
        }
      }

      const normalized: AuthorPlaybook[] = rows.slice(0, 4).map((row) => ({
        id: row.id,
        name: row.name,
        share_id: row.share_id,
        cover_url: row.cover_url,
        is_paid: row.is_paid,
        price: row.price,
        asset_types: row.asset_types,
        screenshotCount: byFolderCount[row.id] ?? 0,
        displayCover: row.cover_url || byFolderCover[row.id] || "",
      }));
      if (!cancelled) setMoreFromAuthor(normalized);
    }
    void loadMoreFromAuthor();
    return () => {
      cancelled = true;
    };
  }, [authorUserId, resolvedPlaybook?.id, playbookId]);

  useEffect(() => {
    let cancelled = false;
    async function loadFollowState() {
      if (!authorUserId) {
        if (!cancelled) setIsFollowingAuthor(false);
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const followerId = String(auth.user?.id ?? "").trim();
      if (!followerId || followerId === authorUserId) {
        if (!cancelled) setIsFollowingAuthor(false);
        return;
      }
      const query = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", followerId)
        .eq("following_id", authorUserId)
        .limit(1);
      if (!cancelled) setIsFollowingAuthor(Boolean(query.data?.[0]?.id));
    }
    void loadFollowState();
    return () => {
      cancelled = true;
    };
  }, [authorUserId]);

  const resolvedPlaybookId = String(resolvedPlaybook?.id ?? playbookId).trim();

  useEffect(() => {
    let cancelled = false;
    async function loadLikesState() {
      if (!resolvedPlaybookId) {
        if (!cancelled) {
          setLikesCount(0);
          setImportsCount(0);
          setLiked(false);
        }
        return;
      }

      const [{ count }, { count: importCount }, authRes] = await Promise.all([
        supabase
          .from("playbook_likes")
          .select("*", { count: "exact", head: true })
          .eq("playbook_id", resolvedPlaybookId),
        supabase
          .from("user_playbooks")
          .select("*", { count: "exact", head: true })
          .eq("source_folder_id", resolvedPlaybookId),
        supabase.auth.getUser(),
      ]);

      if (cancelled) return;
      setLikesCount(typeof count === "number" ? count : 0);
      setImportsCount(typeof importCount === "number" ? importCount : 0);

      const currentUserId = String(authRes.data.user?.id ?? "").trim();
      if (!currentUserId) {
        setLiked(false);
        return;
      }

      const likeQuery = await supabase
        .from("playbook_likes")
        .select("id")
        .eq("playbook_id", resolvedPlaybookId)
        .eq("user_id", currentUserId)
        .limit(1);

      if (!cancelled) setLiked(Boolean(likeQuery.data?.[0]?.id));
    }
    void loadLikesState();
    return () => {
      cancelled = true;
    };
  }, [resolvedPlaybookId]);

  useEffect(() => {
    let cancelled = false;
    async function loadComments() {
      setCommentsLoading(true);
      if (!resolvedPlaybookId) {
        if (!cancelled) setComments([]);
        if (!cancelled) setCommentsLoading(false);
        return;
      }

      const commentsQuery = await supabase
        .from("playbook_comments")
        .select("id, user_id, parent_id, content, created_at")
        .eq("playbook_id", resolvedPlaybookId)
        .order("created_at", { ascending: true })
        .limit(60);

      const rows = (commentsQuery.data ?? []) as Array<Record<string, unknown>>;
      if (commentsQuery.error || rows.length === 0) {
        if (!cancelled) {
          setComments([]);
          setCommentsLoading(false);
        }
        return;
      }

      const userIds = Array.from(
        new Set(rows.map((row) => String(row.user_id ?? "").trim()).filter((value) => value.length > 0))
      );

      let byUserId: Record<string, { name: string; email: string; avatarUrl: string }> = {};
      if (userIds.length > 0) {
        const usersQuery = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", userIds);
        if (!usersQuery.error) {
          byUserId = Object.fromEntries(
            (usersQuery.data ?? []).map((row: Record<string, unknown>) => [
              String(row.id ?? ""),
              {
                name: String(row.username ?? "").trim(),
                email: "",
                avatarUrl: String(row.avatar_url ?? "").trim(),
              },
            ])
          );
        }
      }

      const normalizedRows: PlaybookComment[] = rows.map((row) => {
        const commentUserId = String(row.user_id ?? "").trim();
        const userRow = byUserId[commentUserId];
        const username = userRow?.name || userRow?.email || "Unknown";
        return {
          id: String(row.id ?? ""),
          user_id: commentUserId,
          parent_id: row.parent_id ? String(row.parent_id) : null,
          content: String(row.content ?? "").trim(),
          created_at: String(row.created_at ?? ""),
          username,
          userInitial: username.charAt(0).toUpperCase() || "T",
          avatarUrl: userRow?.avatarUrl ?? "",
          isAuthor: commentUserId.length > 0 && commentUserId === authorUserId,
          replies: [],
        };
      });

      const byId = new Map(normalizedRows.map((item) => [item.id, { ...item, replies: [] as PlaybookComment[] }]));
      const topLevel: PlaybookComment[] = [];
      for (const item of byId.values()) {
        if (!item.parent_id) {
          topLevel.push(item);
          continue;
        }
        const parent = byId.get(item.parent_id);
        if (parent && !parent.parent_id) parent.replies.push(item);
      }

      const orderedTopLevel = topLevel.sort(
        (a, b) => new Date(String(b.created_at ?? "")).getTime() - new Date(String(a.created_at ?? "")).getTime()
      );
      if (!cancelled) {
        setComments(orderedTopLevel);
        setCommentsLoading(false);
      }
    }
    void loadComments();
    return () => {
      cancelled = true;
    };
  }, [authorUserId, resolvedPlaybookId]);

  const ctaLabel = useMemo(() => {
    if (ownedCopyFolderId) return "Open Playbook";
    if (resolvedPlaybook?.is_paid) return `Unlock Playbook - €${Number(resolvedPlaybook.price ?? 29).toFixed(0)}`;
    return "Import Playbook";
  }, [ownedCopyFolderId, resolvedPlaybook?.is_paid, resolvedPlaybook?.price]);

  function handleCta() {
    if (ownedCopyFolderId) {
      router.push(`/dashboard?folderId=${encodeURIComponent(ownedCopyFolderId)}&openFirstShot=1`);
      return;
    }
    const targetPath = `/playbook/${encodeURIComponent(shareId)}`;
    router.push(targetPath);
  }

  async function toggleLike() {
    if (!resolvedPlaybookId || likePending) return;

    const { data: auth } = await supabase.auth.getUser();
    const userId = String(auth.user?.id ?? "").trim();
    if (!userId) {
      router.push(`/login?next=${encodeURIComponent(`/playbook/${shareId}`)}`);
      return;
    }

    const wasLiked = liked;
    const previousCount = likesCount;
    const nextLiked = !wasLiked;
    const nextCount = Math.max(0, previousCount + (nextLiked ? 1 : -1));

    setLikePending(true);
    setLiked(nextLiked);
    setLikesCount(nextCount);
    setLikeBouncing(true);
    window.setTimeout(() => setLikeBouncing(false), 220);

    try {
      if (wasLiked) {
        const { error } = await supabase
          .from("playbook_likes")
          .delete()
          .eq("playbook_id", resolvedPlaybookId)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("playbook_likes").insert({
          playbook_id: resolvedPlaybookId,
          user_id: userId,
        });
        if (error) throw error;
      }
    } catch {
      setLiked(wasLiked);
      setLikesCount(previousCount);
    } finally {
      setLikePending(false);
    }
  }

  async function toggleFollow() {
    if (!authorUserId || followPending) return;
    const { data: auth } = await supabase.auth.getUser();
    const followerId = String(auth.user?.id ?? "").trim();
    if (!followerId) {
      router.push(`/login?next=${encodeURIComponent(`/playbook/${shareId}`)}`);
      return;
    }
    if (followerId === authorUserId) return;

    const wasFollowing = isFollowingAuthor;
    setFollowPending(true);
    setIsFollowingAuthor(!wasFollowing);
    try {
      if (wasFollowing) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", followerId)
          .eq("following_id", authorUserId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("follows").insert({
          follower_id: followerId,
          following_id: authorUserId,
        });
        if (error) throw error;
      }
    } catch {
      setIsFollowingAuthor(wasFollowing);
    } finally {
      setFollowPending(false);
    }
  }

  async function handlePostComment() {
    if (!resolvedPlaybookId || postingComment) return;
    const content = newComment.trim();
    if (!content) return;

    const { data: auth } = await supabase.auth.getUser();
    const userId = String(auth.user?.id ?? "").trim();
    if (!userId) {
      router.push(`/login?next=${encodeURIComponent(`/playbook/${shareId}`)}`);
      return;
    }

    setPostingComment(true);
    try {
      const insert = await supabase
        .from("playbook_comments")
        .insert({
          playbook_id: resolvedPlaybookId,
          user_id: userId,
          content,
        })
        .select("id, user_id, content, created_at")
        .single();
      if (insert.error || !insert.data) return;

      const userQuery = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", userId)
        .limit(1);
      const userRow = (userQuery.data?.[0] ?? {}) as {
        username?: string | null;
        avatar_url?: string | null;
      };
      const username = String(userRow.username ?? "").trim() || "Unknown";

      const newItem: PlaybookComment = {
        id: String(insert.data.id),
        user_id: userId,
        parent_id: null,
        content: String(insert.data.content ?? ""),
        created_at: String(insert.data.created_at ?? ""),
        username,
        userInitial: username.charAt(0).toUpperCase() || "T",
        avatarUrl: String(userRow.avatar_url ?? "").trim(),
        isAuthor: userId === authorUserId,
        replies: [],
      };

      if (authorUserId && authorUserId !== userId) {
        await supabase.from("notifications").insert({
          user_id: authorUserId,
          type: "comment",
          message: `${username} commented on your playbook "${resolvedPlaybook?.name ?? "Playbook"}".`,
          is_read: false,
        });
      }

      setComments((prev) => [newItem, ...prev]);
      setNewestCommentId(newItem.id);
      setNewComment("");
    } finally {
      setPostingComment(false);
    }
  }

  async function handlePostReply(parentId: string) {
    if (!resolvedPlaybookId || postingReplyParentId) return;
    const content = replyDraft.trim();
    if (!content) return;

    const { data: auth } = await supabase.auth.getUser();
    const userId = String(auth.user?.id ?? "").trim();
    if (!userId) {
      router.push(`/login?next=${encodeURIComponent(`/playbook/${shareId}`)}`);
      return;
    }

    setPostingReplyParentId(parentId);
    try {
      const parentComment = comments.find((comment) => comment.id === parentId);
      const insert = await supabase
        .from("playbook_comments")
        .insert({
          playbook_id: resolvedPlaybookId,
          user_id: userId,
          parent_id: parentId,
          content,
        })
        .select("id, user_id, parent_id, content, created_at")
        .single();
      if (insert.error || !insert.data) return;

      const userQuery = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", userId)
        .limit(1);
      const userRow = (userQuery.data?.[0] ?? {}) as {
        username?: string | null;
        avatar_url?: string | null;
      };
      const username = String(userRow.username ?? "").trim() || "Unknown";

      const newReply: PlaybookComment = {
        id: String(insert.data.id),
        user_id: userId,
        parent_id: parentId,
        content: String(insert.data.content ?? ""),
        created_at: String(insert.data.created_at ?? ""),
        username,
        userInitial: username.charAt(0).toUpperCase() || "T",
        avatarUrl: String(userRow.avatar_url ?? "").trim(),
        isAuthor: userId === authorUserId,
        replies: [],
      };

      const replyTargetUserId = String(parentComment?.user_id ?? "").trim();
      if (replyTargetUserId && replyTargetUserId !== userId) {
        await supabase.from("notifications").insert({
          user_id: replyTargetUserId,
          type: "reply",
          message: `${username} replied to your comment on "${resolvedPlaybook?.name ?? "Playbook"}".`,
          is_read: false,
        });
      }

      setComments((prev) =>
        prev.map((comment) =>
          comment.id === parentId ? { ...comment, replies: [...comment.replies, newReply] } : comment
        )
      );
      setReplyDraft("");
      setActiveReplyParentId(null);
    } finally {
      setPostingReplyParentId(null);
    }
  }

  if (!shareId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-300">No playbook selected.</p>
      </div>
    );
  }

  const assetTypes = resolvedPlaybook?.asset_types?.length ? resolvedPlaybook.asset_types : [];
  const strategyTypes = resolvedPlaybook?.strategy_types?.length ? resolvedPlaybook.strategy_types : [];
  const hasMetadataPills =
    assetTypes.length > 0 ||
    strategyTypes.length > 0 ||
    Boolean(resolvedPlaybook?.has_annotations) ||
    Boolean(resolvedPlaybook?.has_voice) ||
    Boolean(resolvedPlaybook?.has_notes);
  const ctaClassName =
    "micro-btn rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-all duration-150 ease-in-out hover:opacity-90";
  const previewItems = previewScreenshots.slice(0, 6);
  const visibleComments = commentsExpanded ? comments : comments.slice(0, 3);
  const totalCount = previewItems.length;
  let visibleCount = 0;
  if (totalCount <= 4) {
    visibleCount = totalCount;
  } else {
    visibleCount = 3;
  }
  const previewText = `Preview ${visibleCount} of ${totalCount} screenshots`;
  const latestScreenshotTimestamp =
    previewScreenshots
      .map((shot) => new Date(String(shot.created_at ?? "")).getTime())
      .filter((ts) => Number.isFinite(ts) && ts > 0)
      .sort((a, b) => b - a)[0] ?? null;
  const updatedSource = String(playbook?.updated_at ?? "").trim();
  const updatedTimestamp =
    updatedSource.length > 0
      ? new Date(updatedSource).getTime()
      : latestScreenshotTimestamp;
  let updatedText = "";
  if (updatedTimestamp && Number.isFinite(updatedTimestamp)) {
    const daysAgo = Math.floor((Date.now() - updatedTimestamp) / (1000 * 60 * 60 * 24));
    if (daysAgo <= 0) updatedText = "Updated today";
    else if (daysAgo === 1) updatedText = "Updated yesterday";
    else updatedText = `Updated ${daysAgo} days ago`;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="micro-btn rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-all duration-150 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Back to Marketplace
        </button>
      </div>

      <div className="relative h-[260px] w-full overflow-hidden rounded-xl">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={`${playbook?.name ?? "Playbook"} cover`}
            fill
            priority
            sizes="(min-width: 1024px) 960px, 100vw"
            className="object-cover"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-700" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

        <div className="absolute bottom-4 left-4 text-white">
          <h1 className="text-2xl font-semibold text-gray-100">{playbook?.name ?? "Playbook Preview"}</h1>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenAuthorProfile}
              disabled={!authorUsername || !onOpenAuthorProfile}
              className="cursor-pointer text-sm text-gray-300 transition-colors hover:underline disabled:cursor-default disabled:no-underline"
            >
              {authorName}
            </button>
            {authorUserId ? (
              <button
                type="button"
                onClick={() => void toggleFollow()}
                disabled={followPending}
                className={`rounded-md border px-3 py-1.5 text-sm transition-all duration-150 ease-in-out disabled:cursor-not-allowed disabled:opacity-60 ${
                  isFollowingAuthor
                    ? "border-black bg-black text-white hover:opacity-90"
                    : "border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
                }`}
              >
                {isFollowingAuthor ? "Following" : "Follow"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="absolute right-4 top-4">
          <button
            type="button"
            onClick={handleCta}
            className={ctaClassName}
          >
            {ctaLabel}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {resolvedPlaybook?.name ?? "Playbook"}
            </h1>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {previewScreenshots.length} screenshots
              {updatedText ? ` • ${updatedText}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
              <span className="inline-flex items-center gap-1">
                <Heart size={14} className={liked ? "fill-red-500 text-red-500" : "text-gray-500"} />
                {likesCount}
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageCircle size={14} className="text-gray-500" />
                {comments.length}
              </span>
              <span className="inline-flex items-center gap-1">
                <Download size={14} className="text-gray-500" />
                {importsCount}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void toggleLike()}
              disabled={likePending || !resolvedPlaybookId}
              className="mt-2 flex items-center gap-1 text-sm text-gray-700 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:text-gray-100"
              aria-label={liked ? "Unlike playbook" : "Like playbook"}
              aria-pressed={liked}
            >
              <Heart
                size={18}
                className={`transition-transform duration-200 ${likeBouncing ? "scale-110" : "scale-100"} ${likePending ? "animate-pulse" : ""} ${
                  liked ? "fill-red-500 text-red-500" : "text-gray-400"
                }`}
              />
              <span>{likesCount}</span>
            </button>
          </div>
        </div>

        {hasMetadataPills ? (
          <div className="flex flex-wrap gap-2">
            {assetTypes.map((value) => (
              <span
                key={`asset-${value}`}
                className="micro-pill rounded-full bg-gray-200 px-3 py-1 text-xs dark:bg-gray-700"
              >
                {value}
              </span>
            ))}
            {strategyTypes.map((value) => (
              <span
                key={`strategy-${value}`}
                className="micro-pill rounded-full bg-gray-200 px-3 py-1 text-xs dark:bg-gray-700"
              >
                {value}
              </span>
            ))}
            {resolvedPlaybook?.has_annotations ? (
              <span className="micro-pill rounded-full bg-gray-200 px-3 py-1 text-xs dark:bg-gray-700">
                Annotations
              </span>
            ) : null}
            {resolvedPlaybook?.has_voice ? (
              <span className="micro-pill rounded-full bg-gray-200 px-3 py-1 text-xs dark:bg-gray-700">
                Voice Notes
              </span>
            ) : null}
            {resolvedPlaybook?.has_notes ? (
              <span className="micro-pill rounded-full bg-gray-200 px-3 py-1 text-xs dark:bg-gray-700">
                Notes
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200">Playbook Preview</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300">{previewText}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {previewItems.map((item, index) => (
            (() => {
              const isBlurred = totalCount > 4 && index >= visibleCount;
              return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (isBlurred) return;
                setSelectedIndex(index);
              }}
                className={`group micro-card relative overflow-hidden rounded-lg ${
                isBlurred ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <Image
                src={item.image_url}
                alt=""
                width={800}
                height={480}
                loading="lazy"
                className={`h-40 w-full rounded-lg object-cover transition-all duration-150 md:h-48 ${
                  isBlurred ? "blur-sm" : ""
                }`}
                draggable={false}
              />
              {isBlurred ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 backdrop-blur-sm">
                  <span className="text-sm font-medium text-white">
                    🔒 Unlock full playbook
                  </span>
                </div>
              ) : null}
            </button>
              );
            })()
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <button
          type="button"
          onClick={handleOpenAuthorProfile}
          disabled={!authorUsername || !onOpenAuthorProfile}
          className="flex cursor-pointer items-center gap-3 disabled:cursor-default"
        >
          {authorAvatarUrl ? (
            <Image
              src={authorAvatarUrl}
              alt={`${authorName} avatar`}
              width={32}
              height={32}
              loading="lazy"
              className="h-8 w-8 rounded-full bg-gray-300 object-cover"
              draggable={false}
            />
          ) : (
            <div className="w-8 h-8 rounded-full object-cover bg-gray-300 flex items-center justify-center text-xs font-medium">
              {authorName.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="text-left">
            <p className="text-sm text-gray-700 transition-colors hover:underline dark:text-gray-300">{authorName}</p>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Creator</p>
          </div>
        </button>
        {authorUsername ? (
          <button
            type="button"
            onClick={handleOpenAuthorProfile}
            className="ml-auto text-xs font-medium text-gray-600 underline underline-offset-4 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
          >
            View profile
          </button>
        ) : null}
      </div>

      <div className="flex flex-col items-center justify-center text-center">
        <p className="mb-2 text-sm text-gray-700 dark:text-gray-300">
          Full access to all screenshots, notes & annotations
        </p>
        <button
          type="button"
          onClick={handleCta}
          className={`${ctaClassName} px-6 py-3`}
        >
          {ctaLabel}
        </button>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {resolvedPlaybook?.is_paid ? "Instant access after purchase" : "Instant access after import"}
        </p>
      </div>

      {moreFromAuthor.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">More from this author</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {moreFromAuthor.map((item) => {
              const primaryAsset =
                Array.isArray(item.asset_types) && item.asset_types.length > 0
                  ? item.asset_types[0]
                  : "General";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => router.push(`/playbook/${encodeURIComponent(item.share_id)}`)}
                  className="group overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm transition-all hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="relative h-32 w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                    {item.displayCover ? (
                      <Image
                        src={item.displayCover}
                        alt={`${item.name} cover`}
                        fill
                        sizes="(min-width: 1024px) 240px, (min-width: 640px) 50vw, 100vw"
                        loading="lazy"
                        className="object-cover transition-transform duration-200 group-hover:scale-105"
                        draggable={false}
                      />
                    ) : null}
                    <span className="absolute right-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-medium text-white">
                      {item.is_paid ? `€${Number(item.price ?? 0).toFixed(0)}` : "Free"}
                    </span>
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-1 text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</p>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {item.screenshotCount} screenshots • {primaryAsset}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-8">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Comments ({comments.length})</h3>

        {commentsLoading ? (
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">Loading comments...</p>
        ) : comments.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white px-5 py-8 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="flex flex-col items-center justify-center text-center">
              <MessageCircle size={24} className="text-gray-500 dark:text-gray-400" aria-hidden />
              <p className="mt-3 text-base font-medium text-gray-900 dark:text-gray-100">No comments yet</p>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                Be the first to share your thoughts
              </p>
              <button
                type="button"
                onClick={() => {
                  const textarea = document.querySelector<HTMLTextAreaElement>(
                    'textarea[placeholder="Write a comment..."]'
                  );
                  textarea?.focus();
                }}
                className="mt-4 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-all duration-150 ease-in-out hover:opacity-90"
              >
                Write a comment
              </button>
            </div>
          </div>
        ) : null}

        {visibleComments.map((comment) => (
          <motion.div
            key={comment.id}
            className="mt-4 flex gap-3"
            initial={comment.id === newestCommentId ? { opacity: 0, y: 8 } : false}
            animate={comment.id === newestCommentId ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {comment.avatarUrl ? (
              <Image
                src={comment.avatarUrl}
                alt={`${comment.username} avatar`}
                width={32}
                height={32}
                loading="lazy"
                className="h-8 w-8 rounded-full bg-gray-300 object-cover"
                draggable={false}
              />
            ) : (
              <div className="w-8 h-8 rounded-full object-cover bg-gray-300 flex items-center justify-center text-xs font-medium">
                {comment.username.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{comment.username}</span>
                {comment.isAuthor ? (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-600">Author</span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{comment.content}</p>
              <button
                type="button"
                onClick={() =>
                  setActiveReplyParentId((prev) => (prev === comment.id ? null : comment.id))
                }
                className="mt-1 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Reply
              </button>

              {activeReplyParentId === comment.id ? (
                <div className="mt-2">
                  <textarea
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    placeholder="Write a reply..."
                    className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    rows={2}
                  />
                  <button
                    type="button"
                    onClick={() => void handlePostReply(comment.id)}
                    disabled={postingReplyParentId === comment.id || replyDraft.trim().length === 0}
                    className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-all duration-150 ease-in-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {postingReplyParentId === comment.id ? "Posting..." : "Post reply"}
                  </button>
                </div>
              ) : null}

              {comment.replies.length > 0 ? (
                <div className="ml-10 mt-2 space-y-2">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2">
                      {reply.avatarUrl ? (
                        <Image
                          src={reply.avatarUrl}
                          alt={`${reply.username} avatar`}
                          width={32}
                          height={32}
                          loading="lazy"
                          className="h-8 w-8 rounded-full bg-gray-300 object-cover"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full object-cover bg-gray-300 flex items-center justify-center text-xs font-medium">
                          {reply.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {reply.username}
                          </span>
                          {reply.isAuthor ? (
                            <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] text-blue-600">Author</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{reply.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </motion.div>
        ))}

        {comments.length > 3 ? (
          <button
            type="button"
            onClick={() => setCommentsExpanded((prev) => !prev)}
            className="mt-3 text-sm font-medium text-gray-700 underline underline-offset-4 transition-colors hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
          >
            {commentsExpanded ? "Show less comments" : "View all comments"}
          </button>
        ) : null}

        <textarea
          value={newComment}
          onChange={(event) => setNewComment(event.target.value)}
          placeholder="Write a comment..."
          className="mt-4 w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          rows={3}
        />
        <button
          type="button"
          onClick={() => void handlePostComment()}
          disabled={postingComment || newComment.trim().length === 0}
          className="mt-2 rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white transition-all duration-150 ease-in-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {postingComment ? "Posting..." : "Post"}
        </button>
      </div>

      {selectedIndex !== null ? (
        <ScreenshotModal
          screenshots={previewItems}
          index={selectedIndex}
          setIndex={setSelectedIndex}
          readOnly={true}
        />
      ) : null}
    </div>
  );
}

