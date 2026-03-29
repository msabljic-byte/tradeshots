import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPlaybookImportersIfShared } from "./notifyPlaybookImporters";

/** Server debounce buckets in `notifications.notify_kind` (see `notify_playbook_update.sql`). */
export type PlaybookNotifyKind = "new_content" | "content_edit";

/**
 * Debounced fan-out to importers (RPC `notify_playbook_update`).
 * Requires `notifications.source_folder_id`, optional `notifications.notify_kind`, and the RPC in Supabase.
 */
export async function notifyPlaybookUpdate(
  supabase: SupabaseClient,
  folderId: string | null | undefined,
  kind: PlaybookNotifyKind = "content_edit"
): Promise<void> {
  if (folderId == null || folderId === "") return;

  const { error } = await supabase.rpc("notify_playbook_update", {
    p_folder_id: folderId,
    p_kind: kind,
  });

  if (!error) return;

  const m = error.message.toLowerCase();
  if (
    (m.includes("does not exist") && m.includes("function")) ||
    m.includes("schema cache") ||
    m.includes("could not find the function")
  ) {
    return;
  }

  console.warn("notify_playbook_update:", error.message);
}

/**
 * Push importer copies from the shared playbook, then send at most one debounced notification
 * per playbook **per kind** per 30s (server-side).
 */
export async function syncSharedPlaybookAndNotifyImporters(
  supabase: SupabaseClient,
  folderId: string | null | undefined,
  kind: PlaybookNotifyKind = "content_edit"
): Promise<void> {
  await notifyPlaybookImportersIfShared(supabase, folderId);
  await notifyPlaybookUpdate(supabase, folderId, kind);
}

async function syncFromScreenshotIdFallback(
  supabase: SupabaseClient,
  screenshotId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("screenshots")
    .select("folder_id")
    .eq("id", screenshotId)
    .maybeSingle();

  if (error) {
    console.warn("syncFromScreenshotIdFallback:", error.message);
    return;
  }

  if (data?.folder_id) {
    await syncSharedPlaybookAndNotifyImporters(
      supabase,
      String(data.folder_id),
      "content_edit"
    );
  } else {
    console.warn(
      "syncFromScreenshotIdFallback: no folder_id for screenshot",
      screenshotId
    );
  }
}

/**
 * Server-side sync by screenshot id, then one debounced notify (RPC returns folder_id).
 * DB triggers only sync — they do not call notify_playbook_update, so saves do not double-notify.
 * Falls back to client folder lookup if the RPC is not deployed yet.
 */
export async function syncSharedPlaybookAndNotifyFromScreenshotId(
  supabase: SupabaseClient,
  screenshotId: string
): Promise<void> {
  const { data: folderId, error } = await supabase.rpc(
    "notify_playbook_sync_from_screenshot_id",
    { p_screenshot_id: screenshotId }
  );

  if (!error) {
    if (folderId != null && folderId !== "") {
      await notifyPlaybookUpdate(supabase, String(folderId), "content_edit");
      return;
    }
    await syncFromScreenshotIdFallback(supabase, screenshotId);
    return;
  }

  const m = error.message.toLowerCase();
  if (
    (m.includes("does not exist") && m.includes("function")) ||
    m.includes("schema cache") ||
    m.includes("could not find the function")
  ) {
    await syncFromScreenshotIdFallback(supabase, screenshotId);
    return;
  }

  console.error("notify_playbook_sync_from_screenshot_id:", error.message);
}
