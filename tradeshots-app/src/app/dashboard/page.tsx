"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import ScreenshotUploader from "@/components/upload/ScreenshotUploader";

type ScreenshotRow = {
  id: string;
  image_url: string;
  created_at: string;
  tags?: string[] | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [screenshotsLoading, setScreenshotsLoading] = useState(true);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [modalEntered, setModalEntered] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  function handleImageLoaded(id: string) {
    setLoadedImages((prev) => ({ ...prev, [id]: true }));
  }

  const fetchScreenshots = async () => {
    setScreenshotsLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
      setScreenshots([]);
      setScreenshotsLoading(false);
      return;
    }

    const { data, error: screenshotsError } = await supabase
      .from("screenshots")
      .select("id, image_url, created_at, tags")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (screenshotsError) {
      setError(screenshotsError.message);
      setScreenshots([]);
    } else {
      setError(null);
      setScreenshots((data ?? []) as ScreenshotRow[]);
    }

    setScreenshotsLoading(false);
  };

  useEffect(() => {
    async function loadDashboardData() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        router.replace("/login");
        return;
      }

      setEmail(user.email ?? null);
      await fetchScreenshots();
    }

    loadDashboardData().finally(() => {
      setCheckingSession(false);
    });
  }, [router]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedIndex(null);
        return;
      }

      const filteredScreenshots = screenshots.filter((s) => {
        if (!tagFilter) return true;

        return s.tags?.some((tag) =>
          tag.toLowerCase().includes(tagFilter.toLowerCase())
        );
      });

      if (selectedIndex === null) return;
      if (selectedIndex < 0 || selectedIndex >= filteredScreenshots.length) return;

      if (e.key === "ArrowRight") {
        setSelectedIndex((prev) =>
          prev !== null && prev < filteredScreenshots.length - 1
            ? prev + 1
            : prev
        );
      }
      if (e.key === "ArrowLeft") {
        setSelectedIndex((prev) =>
          prev !== null && prev > 0 ? prev - 1 : prev
        );
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [screenshots, tagFilter, selectedIndex]);

  useEffect(() => {
    if (selectedIndex === null) {
      setModalEntered(false);
      return;
    }
    setModalEntered(false);
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setModalEntered(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [selectedIndex]);

  async function handleLogout() {
    setSigningOut(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setError(error.message);
        return;
      }
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 font-sans">
        <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-zinc-600">Checking your session...</p>
        </div>
      </main>
    );
  }

  const filteredScreenshots = screenshots.filter((s) => {
    if (!tagFilter) return true;

    return s.tags?.some((tag) =>
      tag.toLowerCase().includes(tagFilter.toLowerCase())
    );
  });

  const selectedImage =
    selectedIndex !== null ? filteredScreenshots[selectedIndex] ?? null : null;

  return (
    <>
      <main className="min-h-screen bg-gray-50 font-sans">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h1 className="mb-3 text-2xl font-semibold text-gray-900">
              You are logged in
            </h1>
            <div className="mb-6 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900">
              Signed in as:{" "}
              <span className="font-medium text-gray-900">{email ?? "unknown"}</span>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handleLogout}
              disabled={signingOut}
              className="h-11 w-full rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
            >
              {signingOut ? "Signing out..." : "Log out"}
            </button>
          </div>

          <section className="space-y-3">
            <h2 className="text-2xl font-semibold text-gray-900">Your Screenshots</h2>
            <ScreenshotUploader onUploadComplete={fetchScreenshots} />
          </section>

          <section className="space-y-3">
            {screenshotsLoading ? (
              <p className="text-sm text-gray-600">Loading screenshots...</p>
            ) : screenshots.length === 0 ? (
              <p className="text-sm text-gray-600">No screenshots yet</p>
            ) : (
              <>
                <input
                  type="text"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder="Filter by tag..."
                  className="mb-4 w-full max-w-sm border rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500"
                />
                {filteredScreenshots.length === 0 ? (
                  <p className="text-sm text-gray-600">No screenshots match this tag</p>
                ) : (
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                    {filteredScreenshots.map((shot, index) => (
                      <div key={shot.id} className="flex flex-col">
                        <div
                          onClick={() => setSelectedIndex(index)}
                          className="group relative h-48 cursor-pointer overflow-hidden rounded-xl shadow-sm transition hover:shadow-md"
                        >
                          <Image
                            src={shot.image_url}
                            alt="Uploaded screenshot"
                            fill
                            onLoad={() => handleImageLoaded(shot.id)}
                            className={`object-cover transition duration-300 ${
                              loadedImages[shot.id] ? "opacity-100" : "opacity-0"
                            } group-hover:scale-[1.02]`}
                          />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/10 to-transparent opacity-0 transition duration-200 group-hover:opacity-100" />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition duration-200 group-hover:opacity-100">
                            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-gray-900 shadow-sm">
                              View
                            </span>
                          </div>
                        </div>
                        {shot.tags && shot.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {shot.tags?.map((tag, i) => (
                              <span
                                key={`${shot.id}-${tag}-${i}`}
                                className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      {selectedImage && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 transition-opacity duration-200 ease-out ${
            modalEntered ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setSelectedIndex(null)}
        >
          <button
            type="button"
            aria-label="Previous screenshot"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((prev) =>
                prev !== null && prev > 0 ? prev - 1 : prev
              );
            }}
            className="absolute left-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer border-0 bg-transparent p-0 text-3xl leading-none text-white"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next screenshot"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((prev) =>
                prev !== null && prev < filteredScreenshots.length - 1
                  ? prev + 1
                  : prev
              );
            }}
            className="absolute right-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer border-0 bg-transparent p-0 text-3xl leading-none text-white"
          >
            →
          </button>
          <img
            src={selectedImage.image_url}
            alt="Selected screenshot"
            onClick={(e) => e.stopPropagation()}
            className={`max-h-[90vh] max-w-[90vw] origin-center rounded-lg shadow-lg transition-[opacity,transform] duration-200 ease-out ${
              modalEntered ? "scale-100 opacity-100" : "scale-[0.98] opacity-0"
            }`}
          />
          <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-sm text-white">
            {selectedIndex !== null ? selectedIndex + 1 : 0} /{" "}
            {filteredScreenshots.length}
          </p>
        </div>
      )}
    </>
  );
}

