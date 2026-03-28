import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Calls RPC with the author's active folder id (from upload/save). The database resolves
 * the shared playbook root by walking `folders.parent_id` until `share_id` is set, then
 * syncs all screenshots under that root's folder tree into each importer's `copy_folder_id`.
 *
 * - Default: "New setup added" only when new importer rows are inserted (upload/move).
 * - `notifyImportersOnCopyUpdates: true`: also send "Setup updated" when existing copies
 *   were synced (author edited/cleared notes, annotations, or attributes). Requires
 *   `notify_playbook_importers(uuid, boolean)` in Supabase.
 */
export async function notifyPlaybookImportersIfShared(
  supabase: SupabaseClient,
  folderId: string | null | undefined,
  options?: { notifyImportersOnCopyUpdates?: boolean }
): Promise<void> {
  if (folderId == null || folderId === "") return;

  const { error } = await supabase.rpc("notify_playbook_importers", {
    p_folder_id: folderId,
    p_notify_importers_on_copy_updates:
      options?.notifyImportersOnCopyUpdates ?? false,
  });

  if (!error) return;

  const m = error.message.toLowerCase();
  // Only ignore "RPC not deployed / PostgREST cache" — surface real permission or data errors.
  if (
    (m.includes("does not exist") && m.includes("function")) ||
    m.includes("schema cache") ||
    m.includes("could not find the function")
  ) {
    return;
  }

  console.warn("notify_playbook_importers:", error.message);
}
