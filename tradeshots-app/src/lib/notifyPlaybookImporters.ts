import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Syncs importer copies only (RPC `notify_playbook_importers`).
 * Pair with `notifyPlaybookUpdate` or use `syncSharedPlaybookAndNotifyImporters`.
 */
export async function notifyPlaybookImportersIfShared(
  supabase: SupabaseClient,
  folderId: string | null | undefined
): Promise<void> {
  if (folderId == null || folderId === "") return;

  const { error } = await supabase.rpc("notify_playbook_importers", {
    p_folder_id: folderId,
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

  console.warn("notify_playbook_importers:", error.message);
}
