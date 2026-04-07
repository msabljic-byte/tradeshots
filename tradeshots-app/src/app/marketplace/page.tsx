import { redirect } from "next/navigation";

/** Standalone URL keeps working: marketplace lives inside the dashboard layout. */
export default function MarketplacePage() {
  redirect("/dashboard?view=marketplace");
}
