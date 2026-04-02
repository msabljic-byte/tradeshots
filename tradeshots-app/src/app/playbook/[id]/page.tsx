"use client";

/**
 * Public shared playbook page: `/playbook/[shareId]`.
 * Loads folder + screenshots by `folders.share_id`; supports free preview/unlock, paid Stripe gate,
 * and “Import playbook” which copies rows into the signed-in user’s account (`user_playbooks`, new folder, screenshots).
 * Optional columns/RPCs are handled gracefully when the Supabase schema is behind the UI.
 *
 * Each `useEffect` below is prefixed with `// useEffect:` describing its role.
 */
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ScreenshotModal from "@/components/ScreenshotModal";
import { Image as ImageIcon } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";

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
  /** True for rows just imported/synced from a shared playbook (highlight in UI). */
  is_new?: boolean | null;
};

const LOCAL_ANNOTATIONS_KEY = "tradeshots.localAnnotations.v1";
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

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
    row.value ??
    row["value"] ??
    row.attr_value ??
    row.attribute_value ??
    row.val;
  if (rawKey == null || rawValue == null) return null;
  const key = String(rawKey).trim();
  const value = String(rawValue).trim();
  if (!key || !value) return null;
  return { key, value };
}

/** PostgREST / Supabase when table or column is not in the project yet */
function isOptionalSchemaMissing(err: { message?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("could not find")
  );
}

/** Next name if `baseName` is already used: "(Copy)", then "(Copy 2)", … */
function nextAvailablePlaybookName(baseName: string, existingNames: Set<string>): string {
  const trimmed = baseName.trim();
  const root = trimmed.length > 0 ? trimmed : "Playbook";
  if (!existingNames.has(root)) return root;
  let n = 1;
  while (n < 10_000) {
    const candidate =
      n === 1 ? `${root} (Copy)` : `${root} (Copy ${n})`;
    if (!existingNames.has(candidate)) return candidate;
    n += 1;
  }
  return `${root} (Copy ${Date.now()})`;
}

export default function PublicPlaybookPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const shareId = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<any | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [importing, setImporting] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [toastExiting, setToastExiting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const toastExitTimeoutRef = useRef<number | null>(null);

  function showToast(message: string) {
    setToast(message);
    setToastExiting(false);
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    if (toastExitTimeoutRef.current) {
      window.clearTimeout(toastExitTimeoutRef.current);
    }

    const TOAST_TOTAL_MS = 3200;
    const TOAST_OUT_START_MS = 3000;

    toastExitTimeoutRef.current = window.setTimeout(() => {
      setToastExiting(true);
    }, TOAST_OUT_START_MS);

    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
      toastExitTimeoutRef.current = null;
      setToastExiting(false);
    }, 3200);
  }

  function redirectToLoginForThisPlaybook() {
    const nextPath = shareId ? `/playbook/${shareId}` : "/dashboard";
    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  async function createCheckoutSession(userId: string): Promise<string | null> {
    if (!shareId) return null;

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
    if (!sessionId) {
      showToast("Could not create checkout session.");
      return null;
    }

    return String(sessionId);
  }

  async function handleBuyWithStripe(userId: string) {
    setCheckingOut(true);
    try {
      const stripe = stripePromise ? await stripePromise : null;
      if (!stripe) {
        showToast("Stripe is not configured.");
        return;
      }

      const sessionId = await createCheckoutSession(userId);
      if (!sessionId) return;

      const { error } = await (stripe as any).redirectToCheckout({ sessionId });
      if (error) showToast(error.message);
    } finally {
      setCheckingOut(false);
    }
  }

  // useEffect: unmount — clear toast timers to avoid setState after unmount.
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
      if (toastExitTimeoutRef.current) {
        window.clearTimeout(toastExitTimeoutRef.current);
      }
    };
  }, []);

  async function syncPlaybook() {
    if (!folder) return;

    if (folder.is_paid && !hasAccess) {
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
      // If this user already imported this shared playbook, don't allow importing again.
      // (DB should enforce this too via a unique constraint; this is the friendly UX guard.)
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
        router.push("/dashboard");
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

      const importName = nextAvailablePlaybookName(
        String(folder.name ?? ""),
        existingNames
      );

      const { data: newFolder, error: folderError } = await supabase
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

      if (folderError || !newFolder) {
        showToast(folderError?.message ?? "Could not create folder");
        return;
      }

      const { error: importedFlagErr } = await supabase
        .from("folders")
        .update({ is_imported: true })
        .eq("id", newFolder.id);
      if (importedFlagErr && !isOptionalSchemaMissing(importedFlagErr)) {
        console.warn("folders.is_imported:", importedFlagErr.message);
      }

      const { error: linkErr } = await supabase.from("user_playbooks").insert({
        user_id: userId,
        source_folder_id: sourceFolderId,
        copy_folder_id: newFolder.id,
      });

      if (linkErr) {
        showToast(
          linkErr.message ??
            "Could not link import (add user_playbooks.copy_folder_id in Supabase). Import cancelled."
        );
        await supabase.from("folders").delete().eq("id", newFolder.id);
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

      const rows = (sourceScreenshots ?? []) as Record<string, unknown>[];

      for (const s of rows) {
        const sourceShotId = String(s.id);

        const insertPayload: Record<string, unknown> = {
          folder_id: newFolder.id,
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
        if (s.annotations != null) {
          insertPayload.annotations = s.annotations;
        } else if (s.annotation != null) {
          insertPayload.annotation = s.annotation;
        }

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
          const { error: attrInsErr } = await supabase
            .from("trade_attributes")
            .insert(attrInserts);
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

      showToast("Playbook imported");
      router.push("/dashboard");
    } finally {
      setImporting(false);
    }
  }

  // useEffect: paid playbooks — grant access from Stripe return (`?success=true&session_id=`) via verify API; free playbooks get access immediately.
  useEffect(() => {
    if (!folder) return;
    const successParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("success")
        : null;

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

    // success URL includes `session_id={CHECKOUT_SESSION_ID}`.
    const sessionId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("session_id")
        : null;

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
          body: JSON.stringify({
            sessionId,
            playbookId: shareId,
            userId: auth.user.id,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.authorized) {
          setHasAccess(true);
          showToast("Payment confirmed. You can import now.");
        } else {
          setHasAccess(false);
          showToast(data?.error ?? "Payment could not be verified.");
        }
      } finally {
        setVerifyingPayment(false);
      }
    }

    void verifyPayment();
  }, [folder]);

  // useEffect: load shared folder + screenshots + trade_attributes by `share_id` (runs when `shareId` from route changes).
  useEffect(() => {
    async function load() {
      if (!shareId) {
        setError("Not found");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const folderQuery = await supabase
        .from("folders")
        .select(
          "id, name, description, owner_email, share_id, is_paid, price"
        )
        .eq("share_id", shareId)
        .single();

      if (folderQuery.error || !folderQuery.data) {
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

      setFolder(folderQuery.data);

      const shotsQuery = await supabase
        .from("screenshots")
        .select("*")
        .eq("folder_id", folderQuery.data.id)
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
        const { data: attrData } = await supabase
          .from("trade_attributes")
          .select("*")
          .in("screenshot_id", ids);

        const byShot: Record<string, Array<{ name: string; value: string }>> =
          {};
        for (const row of (attrData ?? []) as Record<string, unknown>[]) {
          const parsed = parseTradeAttributeRow(row);
          const sid = row.screenshot_id != null ? String(row.screenshot_id) : "";
          if (!sid || !parsed) continue;
          if (!byShot[sid]) byShot[sid] = [];
          byShot[sid].push({ name: parsed.key, value: parsed.value });
        }

        setScreenshots((prev) =>
          prev.map((s) => ({ ...s, attributes: byShot[s.id] ?? [] }))
        );
      }

      setLoading(false);
    }

    void load();
  }, [shareId]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-600">Loading shared playbook...</div>
    );
  }

  if (!folder) {
    return <div className="p-6 text-sm text-gray-700">{error ?? "Not found"}</div>;
  }

  if (!hasAccess || !isUnlocked) {
    return (
      <div className="min-h-screen bg-background">
        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center">
          <div className="absolute right-6 top-10 text-xs text-gray-400">
            Powered by Tradeshots
          </div>

          <h1 className="text-2xl font-bold text-gray-900">{folder.name}</h1>

          {folder.description && (
            <p className="mx-auto mt-4 max-w-2xl text-gray-600">{folder.description}</p>
          )}

          <div className="mt-6 flex justify-center gap-6 text-sm text-gray-500">
            <span>{screenshots.length} screenshots</span>
            <span>Annotated trades</span>
          </div>

          {screenshots.length > 0 && (
            <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
              {screenshots.slice(0, 6).map((s) => (
                <div key={s.id} className="relative overflow-hidden rounded-lg">
                  <img
                    src={s.image_url}
                    alt=""
                    className="h-40 w-full object-cover blur-[2px]"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-black/5" />
                </div>
              ))}
            </div>
          )}

          {folder.is_paid && !hasAccess ? (
            <div className="mt-10 flex flex-col items-center gap-3 text-center">
              <div className="text-sm text-gray-600">Price</div>
              <div className="text-3xl font-bold text-gray-900">
                €{folder.price ?? 19}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const { data: auth } = await supabase.auth.getUser();
                  if (!auth.user) {
                    redirectToLoginForThisPlaybook();
                    return;
                  }
                  await handleBuyWithStripe(auth.user.id);
                }}
                disabled={checkingOut || verifyingPayment}
                className="btn btn-primary mt-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifyingPayment
                  ? "Verifying payment…"
                  : checkingOut
                    ? "Redirecting…"
                    : "Buy & Import"}
              </button>
            </div>
          ) : (
            <div className="mt-10 flex flex-col items-center gap-3">
              <button
                type="button"
                disabled={importing}
                onClick={() => void syncPlaybook()}
                className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? "Importing…" : "Import Playbook"}
              </button>
              <button
                type="button"
                onClick={() => setIsUnlocked(true)}
                className="text-sm text-gray-600 underline-offset-4 transition hover:text-gray-900 hover:underline"
              >
                View full playbook
              </button>
            </div>
          )}
        </div>

        {toast && (
          <div
            className={`fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg ${
              toastExiting ? "animate-toast-out" : "animate-toast-in"
            }`}
          >
            {toast}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="relative">
          <div className="absolute right-0 top-0 text-xs text-gray-400">
            Powered by Tradeshots
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{folder.name}</h1>
          {folder.description && (
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              {folder.description}
            </p>
          )}
          <p className="mt-1 text-sm text-gray-500">Shared playbook</p>
          <p className="mt-1 text-xs text-gray-400">
            by {folder.owner_email || "Trader"}
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {screenshots.length === 0 ? (
          <div className="py-20 text-center text-gray-500">
            <div className="mx-auto mb-3 text-2xl" aria-hidden>
              <ImageIcon
                className="mx-auto h-5 w-5 text-gray-600"
                aria-hidden
              />
            </div>
            <p className="text-sm font-medium text-gray-900">
              No screenshots yet in this playbook
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Check back later or import it to start building.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {screenshots.map((shot, index) => (
              <button
                key={shot.id}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className="group cursor-pointer overflow-hidden rounded-xl bg-white shadow-sm transition-all duration-150 ease-in-out hover:bg-gray-100 hover:shadow-md"
              >
                <img
                  src={shot.image_url}
                  alt=""
                  draggable={false}
                  className="h-40 w-full object-cover transition-transform group-hover:scale-[1.02]"
                />
              </button>
            ))}
          </div>
        )}

        {selectedIndex !== null && (
          <ScreenshotModal
            screenshots={screenshots}
            index={selectedIndex}
            setIndex={setSelectedIndex}
            readOnly={true}
          />
        )}

        {toast && (
          <div
            className={`fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg ${
              toastExiting ? "animate-toast-out" : "animate-toast-in"
            }`}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

