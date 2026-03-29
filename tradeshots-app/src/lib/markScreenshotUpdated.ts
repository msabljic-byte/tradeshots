import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sets screenshots.is_updated = true for importer-visible "changed" state.
 * Ignores errors when the column is not deployed yet.
 */
export async function markScreenshotUpdated(
  supabase: SupabaseClient,
  screenshotId: string
): Promise<void> {
  if (!screenshotId) return;

  const { error } = await supabase
    .from("screenshots")
    .update({ is_updated: true })
    .eq("id", screenshotId);

  if (!error) return;

  const m = error.message.toLowerCase();
  if (
    m.includes("is_updated") ||
    m.includes("column") ||
    m.includes("schema cache")
  ) {
    return;
  }
  console.warn("markScreenshotUpdated:", error.message);
}

export async function markScreenshotsUpdated(
  supabase: SupabaseClient,
  screenshotIds: string[]
): Promise<void> {
  const ids = screenshotIds.filter(Boolean);
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("screenshots")
    .update({ is_updated: true })
    .in("id", ids);

  if (!error) return;

  const m = error.message.toLowerCase();
  if (
    m.includes("is_updated") ||
    m.includes("column") ||
    m.includes("schema cache")
  ) {
    return;
  }
  console.warn("markScreenshotsUpdated:", error.message);
}
