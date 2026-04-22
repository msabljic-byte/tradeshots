"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FileText, Heart, Image as ImageIcon, Mic, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import ScreenshotModal from "@/components/ScreenshotModal";

type ScreenshotRow = {
  id: string;
  image_url: string;
  created_at: string;
  notes?: string | null;
  tags?: string[] | null;
  source_screenshot_id?: string | null;
  voice_memo_url?: string | null;
  voice_memo_path?: string | null;
  voice_memo_duration_ms?: number | null;
  voice_memo_mime_type?: string | null;
  voice_memo_size_bytes?: number | null;
  voice_memo_updated_at?: string | null;
  annotation?: unknown;
  annotations?: unknown;
  attributes?: Array<{ name: string; value: string }>;
  is_new?: boolean | null;
};

type PlaybookComment = {
  id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at?: string;
  username: string;
  userInitial: string;
  isAuthor: boolean;
  replies: PlaybookComment[];
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
    row.value ?? row["value"] ?? row.attr_value ?? row.attribute_value ?? row.val;
  if (rawKey == null || rawValue == null) return null;
  const key = String(rawKey).trim();
  const value = String(rawValue).trim();
  if (!key || !value) return null;
  return { key, value };
}

function isOptionalSchemaMissing(err: { message?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return m.includes("schema cache") || m.includes("does not exist") || m.includes("could not find");
}

function nextAvailablePlaybookName(baseName: string, existingNames: Set<string>): string {
  const trimmed = baseName.trim();
  const root = trimmed.length > 0 ? trimmed : "Playbook";
  if (!existingNames.has(root)) return root;
  let n = 1;
  while (n < 10_000) {
    const candidate = n === 1 ? `${root} (Copy)` : `${root} (Copy ${n})`;
    if (!existingNames.has(candidate)) return candidate;
    n += 1;
  }
  return `${root} (Copy ${Date.now()})`;
}

export default function SharedPlaybookView({
  shareId,
  loginNextPath,
  embedded = false,
}: {
  shareId: string;
  loginNextPath?: string;
  embedded?: boolean;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<any | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isOwned, setIsOwned] = useState(false);
  const [ownedCopyFolderId, setOwnedCopyFolderId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [toastExiting, setToastExiting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState("Trader");
  const [authorAvatarUrl, setAuthorAvatarUrl] = useState("");
  const [likesCount, setLikesCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likePending, setLikePending] = useState(false);
  const [comments, setComments] = useState<PlaybookComment[]>([]);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [activeReplyParentId, setActiveReplyParentId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [postingReplyParentId, setPostingReplyParentId] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const toastExitTimeoutRef = useRef<number | null>(null);
  const autoImportRanRef = useRef(false);

  function showToast(message: string) {
    setToast(message);
    setToastExiting(false);
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    if (toastExitTimeoutRef.current) window.clearTimeout(toastExitTimeoutRef.current);

    toastExitTimeoutRef.current = window.setTimeout(() => {
      setToastExiting(true);
    }, 3000);

    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
      toastExitTimeoutRef.current = null;
      setToastExiting(false);
    }, 3200);
  }

  function redirectToLoginForThisPlaybook() {
    const nextPath = loginNextPath ?? (shareId ? `/playbook/${shareId}` : "/dashboard");
    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  async function createCheckoutSession(
    userId: string
  ): Promise<{ sessionId: string; url: string | null } | null> {
    if (!shareId) return null;
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playbookId: shareId, userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data?.error ?? "Failed to start checkout.");
        return null;
      }
      const sessionId = data?.sessionId;
      const checkoutUrl = typeof data?.url === "string" && data.url.length > 0 ? data.url : null;
      if (!sessionId) {
        showToast("Could not create checkout session.");
        return null;
      }
      return { sessionId: String(sessionId), url: checkoutUrl };
    } catch {
      showToast("Could not contact checkout service.");
      return null;
    }
  }

  async function handleBuyWithStripe(userId: string) {
    setCheckingOut(true);
    try {
      const checkout = await createCheckoutSession(userId);
      if (!checkout) return;
      if (checkout.url) {
        window.location.assign(checkout.url);
        return;
      }
      showToast("Checkout URL missing. Please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
      if (toastExitTimeoutRef.current) window.clearTimeout(toastExitTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadOwnership() {
      if (!folder?.id) {
        if (!cancelled) {
          setCurrentUserId(null);
          setIsOwned(false);
          setOwnedCopyFolderId(null);
        }
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        if (!cancelled) {
          setCurrentUserId(null);
          setIsOwned(false);
          setOwnedCopyFolderId(null);
        }
        return;
      }

      if (!cancelled) setCurrentUserId(user.id);

      const ownershipQuery = await supabase
        .from("user_playbooks")
        .select("copy_folder_id")
        .eq("user_id", user.id)
        .eq("source_folder_id", String(folder.id))
        .limit(1);

      if (ownershipQuery.error) {
        if (!cancelled) {
          setIsOwned(false);
          setOwnedCopyFolderId(null);
        }
        return;
      }

      const row =
        Array.isArray(ownershipQuery.data) && ownershipQuery.data.length > 0
          ? ownershipQuery.data[0]
          : null;
      if (!cancelled) {
        setIsOwned(Boolean(row));
        setOwnedCopyFolderId(row?.copy_folder_id != null ? String(row.copy_folder_id) : null);
      }
    }
    void loadOwnership();
    return () => {
      cancelled = true;
    };
  }, [folder?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadComments() {
      const currentPlaybookId = String(folder?.id ?? "").trim();
      if (!currentPlaybookId) {
        if (!cancelled) setComments([]);
        return;
      }

      const commentsQuery = await supabase
        .from("playbook_comments")
        .select("id, user_id, parent_id, content, created_at")
        .eq("playbook_id", currentPlaybookId)
        .order("created_at", { ascending: true });

      const rows = (commentsQuery.data ?? []) as Array<Record<string, unknown>>;
      if (commentsQuery.error || rows.length === 0) {
        if (!cancelled) setComments([]);
        return;
      }

      const userIds = Array.from(
        new Set(rows.map((row) => String(row.user_id ?? "").trim()).filter((value) => value.length > 0))
      );

      let byUserId: Record<string, { name: string; email: string }> = {};
      if (userIds.length > 0) {
        const usersQuery = await supabase.from("users").select("id, name, email").in("id", userIds);
        if (!usersQuery.error) {
          byUserId = Object.fromEntries(
            (usersQuery.data ?? []).map((row: Record<string, unknown>) => [
              String(row.id ?? ""),
              {
                name: String(row.name ?? "").trim(),
                email: String(row.email ?? "").trim(),
              },
            ])
          );
        }
      }

      const ownerUserId = String(folder?.user_id ?? "").trim();
      const normalizedRows: PlaybookComment[] = rows.map((row) => {
        const commentUserId = String(row.user_id ?? "").trim();
        const userRow = byUserId[commentUserId];
        const username = userRow?.name || userRow?.email || "Trader";
        return {
          id: String(row.id ?? ""),
          user_id: commentUserId,
          parent_id: row.parent_id ? String(row.parent_id) : null,
          content: String(row.content ?? "").trim(),
          created_at: String(row.created_at ?? ""),
          username,
          userInitial: username.charAt(0).toUpperCase() || "T",
          isAuthor: commentUserId.length > 0 && commentUserId === ownerUserId,
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
      if (!cancelled) setComments(orderedTopLevel);
    }
    void loadComments();
    return () => {
      cancelled = true;
    };
  }, [folder?.id, folder?.user_id]);

  useEffect(() => {
    let cancelled = false;
    async function loadAuthor() {
      const ownerUserId = String(folder?.user_id ?? "").trim();
      if (!ownerUserId) {
        if (!cancelled) {
          setAuthorName("Trader");
          setAuthorAvatarUrl("");
        }
        return;
      }

      const authorQuery = await supabase
        .from("users")
        .select("name, avatar_url, email")
        .eq("id", ownerUserId)
        .limit(1);

      if (!cancelled && !authorQuery.error && authorQuery.data?.[0]) {
        const row = authorQuery.data[0] as {
          name?: string | null;
          avatar_url?: string | null;
          email?: string | null;
        };
        const fallbackName = String(row.email ?? "").trim() || "Trader";
        setAuthorName(String(row.name ?? "").trim() || fallbackName);
        setAuthorAvatarUrl(String(row.avatar_url ?? "").trim());
        return;
      }

      if (!cancelled) {
        setAuthorName("Trader");
        setAuthorAvatarUrl("");
      }
    }
    void loadAuthor();
    return () => {
      cancelled = true;
    };
  }, [folder?.user_id]);

  useEffect(() => {
    let cancelled = false;
    async function loadLikesState() {
      const currentPlaybookId = String(folder?.id ?? "").trim();
      if (!currentPlaybookId) {
        if (!cancelled) {
          setLikesCount(0);
          setLiked(false);
        }
        return;
      }

      const [{ count }, authRes] = await Promise.all([
        supabase
          .from("playbook_likes")
          .select("*", { count: "exact", head: true })
          .eq("playbook_id", currentPlaybookId),
        supabase.auth.getUser(),
      ]);

      if (cancelled) return;
      setLikesCount(typeof count === "number" ? count : 0);

      const currentUserId = String(authRes.data.user?.id ?? "").trim();
      if (!currentUserId) {
        setLiked(false);
        return;
      }

      const likeQuery = await supabase
        .from("playbook_likes")
        .select("id")
        .eq("playbook_id", currentPlaybookId)
        .eq("user_id", currentUserId)
        .limit(1);

      if (!cancelled) setLiked(Boolean(likeQuery.data?.[0]?.id));
    }
    void loadLikesState();
    return () => {
      cancelled = true;
    };
  }, [folder?.id]);

  function openOwnedPlaybook() {
    if (ownedCopyFolderId) {
      router.push(`/dashboard?folderId=${encodeURIComponent(ownedCopyFolderId)}&openFirstShot=1`);
      return;
    }
    router.push("/dashboard");
  }

  async function toggleLike() {
    const currentPlaybookId = String(folder?.id ?? "").trim();
    if (!currentPlaybookId || likePending) return;

    const { data: auth } = await supabase.auth.getUser();
    const userId = String(auth.user?.id ?? "").trim();
    if (!userId) {
      redirectToLoginForThisPlaybook();
      return;
    }

    const wasLiked = liked;
    const previousCount = likesCount;
    const nextLiked = !wasLiked;
    const nextCount = Math.max(0, previousCount + (nextLiked ? 1 : -1));

    setLikePending(true);
    setLiked(nextLiked);
    setLikesCount(nextCount);

    try {
      if (wasLiked) {
        const { error } = await supabase
          .from("playbook_likes")
          .delete()
          .eq("playbook_id", currentPlaybookId)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("playbook_likes").insert({
          playbook_id: currentPlaybookId,
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

  async function handlePostComment() {
    const currentPlaybookId = String(folder?.id ?? "").trim();
    if (!currentPlaybookId || postingComment) return;
    const content = newComment.trim();
    if (!content) return;

    const { data: auth } = await supabase.auth.getUser();
    const userId = String(auth.user?.id ?? "").trim();
    if (!userId) {
      redirectToLoginForThisPlaybook();
      return;
    }

    setPostingComment(true);
    try {
      const insert = await supabase
        .from("playbook_comments")
        .insert({
          playbook_id: currentPlaybookId,
          user_id: userId,
          content,
        })
        .select("id, user_id, content, created_at")
        .single();
      if (insert.error || !insert.data) return;

      const userQuery = await supabase.from("users").select("name, email").eq("id", userId).limit(1);
      const userRow = (userQuery.data?.[0] ?? {}) as { name?: string | null; email?: string | null };
      const username = String(userRow.name ?? "").trim() || String(userRow.email ?? "").trim() || "Trader";
      const ownerUserId = String(folder?.user_id ?? "").trim();

      const newItem: PlaybookComment = {
        id: String(insert.data.id),
        user_id: userId,
        parent_id: null,
        content: String(insert.data.content ?? ""),
        created_at: String(insert.data.created_at ?? ""),
        username,
        userInitial: username.charAt(0).toUpperCase() || "T",
        isAuthor: userId === ownerUserId,
        replies: [],
      };

      if (ownerUserId && ownerUserId !== userId) {
        await supabase.from("notifications").insert({
          user_id: ownerUserId,
          type: "comment",
          message: `${username} commented on your playbook "${String(folder?.name ?? "Playbook")}".`,
          is_read: false,
        });
      }

      setComments((prev) => [newItem, ...prev]);
      setNewComment("");
    } finally {
      setPostingComment(false);
    }
  }

  async function handlePostReply(parentId: string) {
    const currentPlaybookId = String(folder?.id ?? "").trim();
    if (!currentPlaybookId || postingReplyParentId) return;
    const content = replyDraft.trim();
    if (!content) return;

    const { data: auth } = await supabase.auth.getUser();
    const userId = String(auth.user?.id ?? "").trim();
    if (!userId) {
      redirectToLoginForThisPlaybook();
      return;
    }

    setPostingReplyParentId(parentId);
    try {
      const parentComment = comments.find((comment) => comment.id === parentId);
      const insert = await supabase
        .from("playbook_comments")
        .insert({
          playbook_id: currentPlaybookId,
          user_id: userId,
          parent_id: parentId,
          content,
        })
        .select("id, user_id, parent_id, content, created_at")
        .single();
      if (insert.error || !insert.data) return;

      const userQuery = await supabase.from("users").select("name, email").eq("id", userId).limit(1);
      const userRow = (userQuery.data?.[0] ?? {}) as { name?: string | null; email?: string | null };
      const username = String(userRow.name ?? "").trim() || String(userRow.email ?? "").trim() || "Trader";
      const ownerUserId = String(folder?.user_id ?? "").trim();

      const newReply: PlaybookComment = {
        id: String(insert.data.id),
        user_id: userId,
        parent_id: parentId,
        content: String(insert.data.content ?? ""),
        created_at: String(insert.data.created_at ?? ""),
        username,
        userInitial: username.charAt(0).toUpperCase() || "T",
        isAuthor: userId === ownerUserId,
        replies: [],
      };

      const replyTargetUserId = String(parentComment?.user_id ?? "").trim();
      if (replyTargetUserId && replyTargetUserId !== userId) {
        await supabase.from("notifications").insert({
          user_id: replyTargetUserId,
          type: "reply",
          message: `${username} replied to your comment on "${String(folder?.name ?? "Playbook")}".`,
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

  async function syncPlaybook(options?: {
    skipPaidCheck?: boolean;
    successToast?: string;
    skipRedirect?: boolean;
  }) {
    if (!folder) return;
    if (!options?.skipPaidCheck && folder.is_paid && !hasAccess) {
      showToast("Please purchase first");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      redirectToLoginForThisPlaybook();
      return;
    }

    const userId = auth.user.id;
    const sourceFolderId = folder.id as string;
    setImporting(true);
    try {
      const { data: existingImports, error: existingErr } = await supabase
        .from("user_playbooks")
        .select("copy_folder_id")
        .eq("user_id", userId)
        .eq("source_folder_id", sourceFolderId)
        .limit(1);
      if (existingErr && !isOptionalSchemaMissing(existingErr)) {
        showToast(existingErr.message);
        return;
      }
      if (existingImports && existingImports.length > 0) {
        showToast("You already imported this playbook.");
        if (!options?.skipRedirect) router.push("/dashboard");
        return;
      }

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

      const importName = nextAvailablePlaybookName(String(folder.name ?? ""), existingNames);
      let newFolder: (Record<string, unknown> & { id: string }) | null = null;
      let folderError: { message?: string } | null = null;
      const inserted = await supabase
        .from("folders")
        .insert({
          name: importName,
          description: folder.description ?? null,
          user_id: userId,
          share_id: null,
          parent_id: null,
          is_imported: true,
        })
        .select()
        .single();
      newFolder = (inserted.data as (Record<string, unknown> & { id: string }) | null) ?? null;
      folderError = inserted.error;

      if (folderError && isOptionalSchemaMissing(folderError)) {
        const retry = await supabase
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
        if (retry.error || !retry.data) {
          showToast(retry.error?.message ?? "Could not create folder");
          return;
        }
        const { error: importedFlagErr } = await supabase
          .from("folders")
          .update({ is_imported: true })
          .eq("id", retry.data.id);
        if (importedFlagErr && !isOptionalSchemaMissing(importedFlagErr)) {
          console.warn("folders.is_imported:", importedFlagErr.message);
        }
        newFolder = (retry.data as (Record<string, unknown> & { id: string }) | null) ?? null;
      } else if (folderError || !newFolder) {
        showToast(folderError?.message ?? "Could not create folder");
        return;
      }

      const copyFolderId = newFolder.id;
      const { error: linkErr } = await supabase.from("user_playbooks").insert({
        user_id: userId,
        source_folder_id: sourceFolderId,
        copy_folder_id: copyFolderId,
      });
      if (linkErr) {
        showToast(linkErr.message ?? "Could not link import. Import cancelled.");
        await supabase.from("folders").delete().eq("id", copyFolderId);
        return;
      }

      const { data: sourceScreenshots, error: shotsErr } = await supabase
        .from("screenshots")
        .select("*")
        .eq("folder_id", sourceFolderId);
      if (shotsErr) {
        showToast(shotsErr.message);
        return;
      }

      for (const s of (sourceScreenshots ?? []) as Record<string, unknown>[]) {
        const sourceShotId = String(s.id);
        const insertPayload: Record<string, unknown> = {
          folder_id: copyFolderId,
          user_id: userId,
          image_url: s.image_url,
          notes: s.notes ?? null,
          tags: s.tags ?? null,
          voice_memo_url: s.voice_memo_url ?? null,
          voice_memo_path: s.voice_memo_path ?? null,
          voice_memo_duration_ms: s.voice_memo_duration_ms ?? null,
          voice_memo_mime_type: s.voice_memo_mime_type ?? null,
          voice_memo_size_bytes: s.voice_memo_size_bytes ?? null,
          voice_memo_updated_at: s.voice_memo_updated_at ?? null,
          source_screenshot_id: sourceShotId,
          is_new: true,
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

        const { data: sourceAttrs } = await supabase
          .from("trade_attributes")
          .select("*")
          .eq("screenshot_id", sourceShotId);
        const attrInserts: Array<{
          screenshot_id: string;
          user_id: string;
          key: string;
          value: string;
        }> = [];
        for (const row of (sourceAttrs ?? []) as Record<string, unknown>[]) {
          const parsed = parseTradeAttributeRow(row);
          if (!parsed) continue;
          attrInserts.push({
            screenshot_id: newShot.id,
            user_id: userId,
            key: parsed.key,
            value: parsed.value,
          });
        }
        if (attrInserts.length > 0) {
          const { error: attrInsErr } = await supabase.from("trade_attributes").insert(attrInserts);
          if (attrInsErr) {
            showToast(attrInsErr.message);
            return;
          }
        }
      }

      const { error: notifErr } = await supabase.from("notifications").insert({
        user_id: userId,
        type: "import",
        message: `Playbook "${importName}" imported`,
      });
      if (notifErr && !isOptionalSchemaMissing(notifErr)) {
        console.warn("notifications insert:", notifErr.message);
      }

      showToast(options?.successToast ?? "Playbook imported");
      if (!options?.skipRedirect) router.push("/dashboard");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    if (!folder) return;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const successParam = params?.get("success");

    if (!folder.is_paid) {
      setHasAccess(true);
      return;
    }

    const paidSuccess = successParam === "true";
    setIsUnlocked(false);
    if (!paidSuccess) {
      setHasAccess(false);
      return;
    }

    const sessionId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("session_id") : null;
    if (!sessionId) {
      setHasAccess(false);
      showToast("Payment missing session id. Please try again.");
      return;
    }

    async function verifyPayment() {
      setVerifyingPayment(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) {
          redirectToLoginForThisPlaybook();
          return;
        }

        const res = await fetch("/api/verify-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, playbookId: shareId, userId: auth.user.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.authorized) {
          setHasAccess(true);

          const existingPurchase = await supabase
            .from("purchases")
            .select("id")
            .eq("user_id", auth.user.id)
            .eq("source_folder_id", String(folder.id))
            .limit(1);
          if (!existingPurchase.error && (!existingPurchase.data || existingPurchase.data.length === 0)) {
            const purchaseInsert = await supabase.from("purchases").insert({
              user_id: auth.user.id,
              source_folder_id: String(folder.id),
              price: Number(folder.price ?? 0),
            });
            if (purchaseInsert.error && !isOptionalSchemaMissing(purchaseInsert.error)) {
              console.warn("purchases insert:", purchaseInsert.error.message);
            }
          }

          if (!autoImportRanRef.current) {
            autoImportRanRef.current = true;
            await syncPlaybook({
              skipPaidCheck: true,
              successToast: "Playbook purchased and added",
              skipRedirect: true,
            });
            if (typeof window !== "undefined") {
              window.history.replaceState({}, "", window.location.pathname);
            }
            window.setTimeout(() => {
              router.push("/dashboard");
            }, 1500);
          }
        } else {
          setHasAccess(false);
          showToast(data?.error ?? "Payment could not be verified.");
        }
      } finally {
        setVerifyingPayment(false);
      }
    }
    void verifyPayment();
  }, [folder, router, shareId]);

  useEffect(() => {
    async function load() {
      if (!shareId) {
        setError("Not found");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      let folderQuery = await supabase
        .from("folders")
        .select("id, name, description, share_id, is_paid, price, cover_url, user_id")
        .eq("share_id", shareId)
        .limit(1);

      if (!folderQuery.error && (!folderQuery.data || folderQuery.data.length === 0)) {
        folderQuery = await supabase
          .from("folders")
          .select("id, name, description, share_id, is_paid, price, cover_url, user_id")
          .ilike("share_id", shareId.trim())
          .limit(1);
      }

      if (
        folderQuery.error &&
        isOptionalSchemaMissing(folderQuery.error) &&
        (folderQuery.error.message ?? "").toLowerCase().includes("cover_url")
      ) {
        folderQuery = (await supabase
          .from("folders")
          .select("id, name, description, share_id, is_paid, price, user_id")
          .eq("share_id", shareId)
          .limit(1)) as typeof folderQuery;
      }

      if (folderQuery.error && isOptionalSchemaMissing(folderQuery.error)) {
        const legacyQuery = await supabase
          .from("folders")
          .select("id, name, description, share_id, user_id")
          .eq("share_id", shareId)
          .limit(1);
        if (!legacyQuery.error && (!legacyQuery.data || legacyQuery.data.length === 0)) {
          const legacyIlike = await supabase
            .from("folders")
            .select("id, name, description, share_id, user_id")
            .ilike("share_id", shareId.trim())
            .limit(1);
          folderQuery = {
            data:
              Array.isArray(legacyIlike.data) && legacyIlike.data.length > 0
                ? { ...legacyIlike.data[0], is_paid: false, price: 0 }
                : null,
            error: legacyIlike.error,
            count: null,
            status: legacyIlike.status,
            statusText: legacyIlike.statusText,
          } as typeof folderQuery;
        } else {
          folderQuery = {
            data:
              Array.isArray(legacyQuery.data) && legacyQuery.data.length > 0
                ? { ...legacyQuery.data[0], is_paid: false, price: 0 }
                : null,
            error: legacyQuery.error,
            count: null,
            status: legacyQuery.status,
            statusText: legacyQuery.statusText,
          } as typeof folderQuery;
        }
      } else {
        folderQuery = {
          ...folderQuery,
          data:
            Array.isArray(folderQuery.data) && folderQuery.data.length > 0
              ? folderQuery.data[0]
              : null,
        } as typeof folderQuery;
      }

      const rawFolderData = folderQuery.data;
      const folderRow = rawFolderData == null ? null : Array.isArray(rawFolderData) ? rawFolderData[0] ?? null : rawFolderData;
      if (folderQuery.error || !folderRow) {
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

      setFolder(folderRow);

      const shotsQuery = await supabase
        .from("screenshots")
        .select("*")
        .eq("folder_id", folderRow.id)
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
        const { data: attrData } = await supabase.from("trade_attributes").select("*").in("screenshot_id", ids);
        const byShot: Record<string, Array<{ name: string; value: string }>> = {};
        for (const row of (attrData ?? []) as Record<string, unknown>[]) {
          const parsed = parseTradeAttributeRow(row);
          const sid = row.screenshot_id != null ? String(row.screenshot_id) : "";
          if (!sid || !parsed) continue;
          if (!byShot[sid]) byShot[sid] = [];
          byShot[sid].push({ name: parsed.key, value: parsed.value });
        }
        setScreenshots((prev) => prev.map((s) => ({ ...s, attributes: byShot[s.id] ?? [] })));
      }

      setLoading(false);
    }
    void load();
  }, [shareId]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-700 dark:text-gray-300">Loading shared playbook...</div>;
  }
  if (!folder) {
    return <div className="p-6 text-sm text-gray-700">{error ?? "Not found"}</div>;
  }

  const coverImageUrl =
    (typeof folder.cover_url === "string" && folder.cover_url.trim().length > 0
      ? folder.cover_url
      : null) ?? (screenshots[0]?.image_url ?? null);
  const assetTypes = Array.isArray(folder.asset_types) && folder.asset_types.length > 0
    ? folder.asset_types
    : ["Not specified"];
  const strategyTypes =
    Array.isArray(folder.strategy_types) && folder.strategy_types.length > 0
      ? folder.strategy_types
      : ["Not specified"];
  const timeframe = String(folder.timeframe ?? "").trim() || "Not specified";
  const experienceLevel = String(folder.experience_level ?? "").trim() || "Not specified";
  const previewShots = screenshots.slice(0, 9);
  const shouldProtectPaidPreview = Boolean(folder.is_paid) && !hasAccess && !isOwned;
  const visibleComments = commentsExpanded ? comments : comments.slice(0, 3);

  function renderPrimaryPreviewCta(extraClassName = "") {
    if (!currentUserId) {
      return (
        <button
          type="button"
          onClick={() => redirectToLoginForThisPlaybook()}
          className={`btn btn-primary micro-btn ${extraClassName}`.trim()}
        >
          Login to import
        </button>
      );
    }
    if (isOwned) {
      return (
        <button
          type="button"
          onClick={() => openOwnedPlaybook()}
          className={`btn btn-primary micro-btn ${extraClassName}`.trim()}
        >
          Open Playbook
        </button>
      );
    }
    if (folder.is_paid) {
      return (
        <button
          type="button"
          onClick={async () => {
            await handleBuyWithStripe(currentUserId);
          }}
          disabled={checkingOut || verifyingPayment}
          className={`btn btn-primary micro-btn disabled:cursor-not-allowed disabled:opacity-60 ${extraClassName}`.trim()}
        >
          {verifyingPayment
            ? "Verifying payment..."
            : checkingOut
              ? "Redirecting..."
              : `Buy & Import (€${folder.price ?? 19})`}
        </button>
      );
    }
    return (
      <button
        type="button"
        disabled={importing}
        onClick={() => void syncPlaybook()}
        className={`btn btn-primary micro-btn disabled:cursor-not-allowed disabled:opacity-60 ${extraClassName}`.trim()}
      >
        {importing ? "Importing..." : "Import Playbook"}
      </button>
    );
  }

  const containerClass = embedded ? "bg-background" : "min-h-screen bg-background";

  if (!hasAccess || !isUnlocked) {
    return (
      <div className={containerClass}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="relative mx-auto max-w-4xl space-y-6 px-6 py-10 text-center"
        >
          {!embedded ? (
            <div className="absolute right-6 top-10 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Powered by Tradeshots</div>
          ) : null}
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{folder.name}</h1>
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => void toggleLike()}
              disabled={likePending || !folder?.id}
              className="flex items-center gap-1 text-sm text-gray-700 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:text-gray-100"
              aria-label={liked ? "Unlike playbook" : "Like playbook"}
              aria-pressed={liked}
            >
              <Heart
                size={18}
                className={`${likePending ? "animate-pulse" : ""} ${
                  liked ? "fill-red-500 text-red-500" : "text-gray-400"
                }`}
              />
              <span>{likesCount}</span>
            </button>
          </div>

          {coverImageUrl ? (
            <div className="group micro-card overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <img
                src={coverImageUrl}
                alt="Playbook cover"
                className="h-56 w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
                draggable={false}
              />
            </div>
          ) : null}

          {folder.description ? <p className="mx-auto mt-4 max-w-2xl text-sm text-gray-700 dark:text-gray-300">{folder.description}</p> : null}
          <div className="mt-6 flex justify-center gap-6 text-sm text-gray-700 dark:text-gray-300">
            <span>{screenshots.length} screenshots</span>
            <span>Annotated trades</span>
          </div>
          <div className="mt-8 text-left">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Comments ({comments.length})</h3>

            {visibleComments.map((comment) => (
              <div key={comment.id} className="mt-4 flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-300 text-sm text-gray-700">
                  {comment.userInitial}
                </div>
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
                        className="w-full rounded border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        rows={2}
                      />
                      <button
                        type="button"
                        onClick={() => void handlePostReply(comment.id)}
                        disabled={postingReplyParentId === comment.id || replyDraft.trim().length === 0}
                        className="mt-2 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {postingReplyParentId === comment.id ? "Posting..." : "Post reply"}
                      </button>
                    </div>
                  ) : null}
                  {comment.replies.length > 0 ? (
                    <div className="ml-10 mt-2 space-y-2">
                      {comment.replies.map((reply) => (
                        <div key={reply.id} className="flex gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600">
                            {reply.userInitial}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                {reply.username}
                              </span>
                              {reply.isAuthor ? (
                                <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] text-blue-600">
                                  Author
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{reply.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
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
              className="mt-4 w-full rounded border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              rows={3}
            />
            <button
              type="button"
              onClick={() => void handlePostComment()}
              disabled={postingComment || newComment.trim().length === 0}
              className="mt-2 rounded bg-black px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            >
              {postingComment ? "Posting..." : "Post"}
            </button>
          </div>

          {previewShots.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {previewShots.map((s, index) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (shouldProtectPaidPreview) return;
                    setSelectedIndex(index);
                  }}
                  className={`group micro-card relative overflow-hidden rounded-lg ${
                    shouldProtectPaidPreview ? "cursor-default" : "cursor-pointer"
                  }`}
                >
                  <img
                    src={s.image_url}
                    alt=""
                    className={`h-40 w-full rounded-lg object-cover ${
                      shouldProtectPaidPreview ? "blur-sm" : ""
                    } transition-transform duration-200 ease-out group-hover:scale-[1.03]`}
                    draggable={false}
                  />
                  {shouldProtectPaidPreview ? (
                    <>
                      <div className="absolute inset-0 bg-black/20" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
                          Preview
                        </span>
                      </div>
                    </>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {folder.is_paid && !hasAccess && !isOwned ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Price</div>
              <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">EUR {folder.price ?? 19}</div>
              <button
                type="button"
                onClick={async () => {
                  if (!currentUserId) {
                    redirectToLoginForThisPlaybook();
                    return;
                  }
                  await handleBuyWithStripe(currentUserId);
                }}
                disabled={checkingOut || verifyingPayment}
                className="btn btn-primary micro-btn mt-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifyingPayment ? "Verifying payment..." : checkingOut ? "Redirecting..." : "Buy & Import"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {renderPrimaryPreviewCta()}
              <button
                type="button"
                onClick={() => setIsUnlocked(true)}
                className="text-sm font-medium text-gray-700 dark:text-gray-300 underline-offset-4 transition hover:text-gray-900 dark:hover:text-gray-100 hover:underline"
              >
                View full playbook
              </button>
            </div>
          )}
        </motion.div>

        {toast ? (
          <div
            className={`fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg ${
              toastExiting ? "animate-toast-out" : "animate-toast-in"
            }`}
          >
            {toast}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="mx-auto max-w-6xl space-y-6 px-6 py-6"
      >
        {!embedded ? (
          <div className="relative">
            <div className="absolute right-0 top-0 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Powered by Tradeshots</div>
          </div>
        ) : null}

        <div className="relative h-[260px] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm">
            {coverImageUrl ? (
              <img
                src={coverImageUrl}
                alt="Playbook cover"
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-gray-200 to-gray-300" />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

            <div className="absolute right-4 top-4">{renderPrimaryPreviewCta()}</div>

            <div className="absolute bottom-4 left-4 right-4">
              <h1 className="line-clamp-2 text-2xl font-semibold text-gray-100">{folder.name}</h1>
              <p className="mt-1 text-sm text-gray-300">by {authorName}</p>
              <button
                type="button"
                onClick={() => void toggleLike()}
                disabled={likePending || !folder?.id}
                className="mt-2 flex items-center gap-1 text-sm text-gray-200 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={liked ? "Unlike playbook" : "Like playbook"}
                aria-pressed={liked}
              >
                <Heart
                  size={18}
                  className={`${likePending ? "animate-pulse" : ""} ${
                    liked ? "fill-red-500 text-red-500" : "text-gray-300"
                  }`}
                />
                <span>{likesCount}</span>
              </button>
            </div>
        </div>

        {folder.description ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">{folder.description}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {assetTypes.map((value: string) => (
            <span
              key={`asset-${value}`}
              className="micro-pill rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {value}
            </span>
          ))}
          <span className="micro-pill rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {timeframe}
          </span>
          {strategyTypes.map((value: string) => (
            <span
              key={`strategy-${value}`}
              className="micro-pill rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {value}
            </span>
          ))}
          <span className="micro-pill rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {experienceLevel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {folder.has_annotations ? (
            <span className="micro-pill inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <Pencil size={16} aria-hidden />
              Annotations
            </span>
          ) : null}
          {folder.has_voice ? (
            <span className="micro-pill inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <Mic size={16} aria-hidden />
              Voice
            </span>
          ) : null}
          {folder.has_notes ? (
            <span className="micro-pill inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <FileText size={16} aria-hidden />
              Notes
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {authorAvatarUrl ? (
            <img
              src={authorAvatarUrl}
              alt={`${authorName} avatar`}
              className="h-10 w-10 rounded-full object-cover transition-transform duration-200 hover:scale-105"
              draggable={false}
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-100">
              {authorName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{authorName}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Creator</p>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <div>
          <h2 className="mb-3 text-lg font-medium text-gray-800 dark:text-gray-200">Preview</h2>
          {previewShots.length === 0 ? (
          <div className="py-20 text-center text-gray-500">
            <div className="mx-auto mb-3 text-2xl" aria-hidden>
              <ImageIcon size={20} className="mx-auto text-gray-600" aria-hidden />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">No screenshots yet in this playbook</p>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">Check back later or import it to start building.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {previewShots.map((shot, index) => (
              <button
                key={shot.id}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className="group relative cursor-pointer overflow-hidden rounded-xl bg-white shadow-sm transition-all duration-150 ease-in-out hover:bg-gray-100 hover:shadow-md"
              >
                <img
                  src={shot.image_url}
                  alt=""
                  draggable={false}
                  className={`h-40 w-full rounded-lg object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03] md:h-48 ${
                    Boolean(folder.is_paid) && !isOwned ? "blur-sm" : ""
                  }`}
                />
                {Boolean(folder.is_paid) && !isOwned ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
                      Preview
                    </span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          )}
        </div>

        <div className="flex justify-center">
          {renderPrimaryPreviewCta()}
        </div>

        <div className="mt-8">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Comments ({comments.length})</h3>

          {visibleComments.map((comment) => (
            <div key={comment.id} className="mt-4 flex gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-300 text-sm text-gray-700">
                {comment.userInitial}
              </div>
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
                      className="w-full rounded border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                      rows={2}
                    />
                    <button
                      type="button"
                      onClick={() => void handlePostReply(comment.id)}
                      disabled={postingReplyParentId === comment.id || replyDraft.trim().length === 0}
                      className="mt-2 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {postingReplyParentId === comment.id ? "Posting..." : "Post reply"}
                    </button>
                  </div>
                ) : null}
                {comment.replies.length > 0 ? (
                  <div className="ml-10 mt-2 space-y-2">
                    {comment.replies.map((reply) => (
                      <div key={reply.id} className="flex gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600">
                          {reply.userInitial}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              {reply.username}
                            </span>
                            {reply.isAuthor ? (
                              <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] text-blue-600">
                                Author
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{reply.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
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
            className="mt-4 w-full rounded border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            rows={3}
          />
          <button
            type="button"
            onClick={() => void handlePostComment()}
            disabled={postingComment || newComment.trim().length === 0}
            className="mt-2 rounded bg-black px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            {postingComment ? "Posting..." : "Post"}
          </button>
        </div>

        {selectedIndex !== null ? (
          <ScreenshotModal
            screenshots={screenshots}
            index={selectedIndex}
            setIndex={setSelectedIndex}
            readOnly={true}
          />
        ) : null}

        {toast ? (
          <div
            className={`fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg ${
              toastExiting ? "animate-toast-out" : "animate-toast-in"
            }`}
          >
            {toast}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
