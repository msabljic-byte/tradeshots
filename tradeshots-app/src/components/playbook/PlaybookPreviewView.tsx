"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { FileText, Mic, Pencil } from "lucide-react";

export type SelectedPlaybook = {
  id?: string;
  name?: string | null;
  share_id?: string | null;
  cover_url?: string | null;
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

export default function PlaybookPreviewView({
  playbook,
  onBack,
}: {
  playbook: SelectedPlaybook | null;
  onBack: () => void;
}) {
  const router = useRouter();
  const shareId = String(playbook?.share_id ?? "").trim();
  const playbookId = String(playbook?.id ?? "").trim();
  const [coverUrl, setCoverUrl] = useState<string>("");
  const [ownedCopyFolderId, setOwnedCopyFolderId] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState("Trader");
  const [authorAvatarUrl, setAuthorAvatarUrl] = useState("");

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
      if (!authorQuery.error && authorQuery.data?.[0]) {
        const row = authorQuery.data[0] as {
          name?: string | null;
          avatar_url?: string | null;
          email?: string | null;
        };
        if (!cancelled) {
          const fallbackName = String(row.email ?? "").trim() || "Trader";
          setAuthorName(String(row.name ?? "").trim() || fallbackName);
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
        const fallbackEmail = String(
          (fallbackAuthor.data?.[0] as { source_owner_email?: string | null } | undefined)
            ?.source_owner_email ?? ""
        ).trim();
        setAuthorName(fallbackEmail || "Trader");
        setAuthorAvatarUrl("");
      }
    }
    void hydrateHeroData();
    return () => {
      cancelled = true;
    };
  }, [playbook?.cover_url, playbookId]);

  const ctaLabel = useMemo(() => {
    if (ownedCopyFolderId) return "Open Playbook";
    if (playbook?.is_paid) return `Buy & Import (€${Number(playbook.price ?? 0).toFixed(0)})`;
    return "Import";
  }, [ownedCopyFolderId, playbook?.is_paid, playbook?.price]);

  function handleCta() {
    if (ownedCopyFolderId) {
      router.push(`/dashboard?folderId=${encodeURIComponent(ownedCopyFolderId)}&openFirstShot=1`);
      return;
    }
    router.push(`/playbook/${encodeURIComponent(shareId)}`);
  }

  if (!shareId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-300">No playbook selected.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Back to Marketplace
        </button>
        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {playbook?.name ?? "Playbook Preview"}
        </p>
      </div>

      <div className="relative h-[300px] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`${playbook?.name ?? "Playbook"} cover`}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-700" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

        <div className="absolute right-4 top-4">
          <button
            type="button"
            onClick={handleCta}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow transition hover:bg-gray-100"
          >
            {ctaLabel}
          </button>
        </div>

        <div className="absolute bottom-4 left-4 right-4">
          <p className="line-clamp-2 text-xl font-semibold text-white">
            {playbook?.name ?? "Playbook Preview"}
          </p>
          <p className="mt-1 text-sm text-gray-200">by {authorName}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-4 flex items-center gap-3 border-b border-gray-200 pb-3 dark:border-gray-700">
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
            <p className="text-xs text-gray-500 dark:text-gray-400">Creator</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Asset Types
            </p>
            <div className="flex flex-wrap gap-2">
              {(playbook?.asset_types?.length ? playbook.asset_types : ["Not specified"]).map(
                (value) => (
                  <span
                    key={`asset-${value}`}
                    className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {value}
                  </span>
                )
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Timeframe
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {playbook?.timeframe?.trim() || "Not specified"}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Strategy Types
            </p>
            <div className="flex flex-wrap gap-2">
              {(playbook?.strategy_types?.length
                ? playbook.strategy_types
                : ["Not specified"]).map((value) => (
                <span
                  key={`strategy-${value}`}
                  className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  {value}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Experience Level
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {playbook?.experience_level?.trim() || "Not specified"}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Features
            </p>
            <div className="flex flex-wrap gap-2">
              {playbook?.has_annotations ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  Annotations
                </span>
              ) : null}
              {playbook?.has_voice ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <Mic className="h-3.5 w-3.5" aria-hidden />
                  Voice
                </span>
              ) : null}
              {playbook?.has_notes ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Notes
                </span>
              ) : null}
              {!playbook?.has_annotations && !playbook?.has_voice && !playbook?.has_notes ? (
                <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  No feature flags yet
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <iframe
          title={`Playbook preview ${shareId}`}
          src={`/playbook/${encodeURIComponent(shareId)}`}
          className="h-[78vh] w-full border-0"
        />
      </div>
    </div>
  );
}

