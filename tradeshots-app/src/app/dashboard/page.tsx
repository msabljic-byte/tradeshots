"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ScreenshotUploader from "@/components/upload/ScreenshotUploader";
import { createPortal } from "react-dom";

type ScreenshotRow = {
  id: string;
  image_url: string;
  created_at: string;
  tags?: string[] | null;
  notes?: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [attributeFilter, setAttributeFilter] = useState("");
  const [attributeValuesByScreenshot, setAttributeValuesByScreenshot] = useState<
    Record<string, string[]>
  >({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [modalEntered, setModalEntered] = useState(false);
  const [currentNote, setCurrentNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savedNoteToast, setSavedNoteToast] = useState(false);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [savingAttributes, setSavingAttributes] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  function handleImageLoaded(id: string) {
    setLoadedImages((prev) => ({ ...prev, [id]: true }));
  }

  const fetchScreenshots = async () => {
    setLoading(true);
    setAttributeValuesByScreenshot({});

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
      setScreenshots([]);
      setLoading(false);
      return;
    }

    const { data, error: screenshotsError } = await supabase
      .from("screenshots")
      .select("id, image_url, created_at, tags, notes")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (screenshotsError) {
      setError(screenshotsError.message);
      setScreenshots([]);
      setAttributeValuesByScreenshot({});
    } else {
      setError(null);
      const screenshotRows = (data ?? []) as ScreenshotRow[];
      setScreenshots(screenshotRows);

      const screenshotIds = screenshotRows.map((s) => s.id);
      if (screenshotIds.length > 0) {
        const { data: attrData, error: attrError } = await supabase
          .from("trade_attributes")
          .select("screenshot_id,value")
          .in("screenshot_id", screenshotIds);

        if (!attrError && attrData) {
          const map: Record<string, string[]> = {};
          for (const row of attrData as any[]) {
            const sid = row.screenshot_id;
            const value = row.value;
            if (!sid) continue;
            if (!map[sid]) map[sid] = [];
            if (value !== null && value !== undefined) {
              map[sid].push(String(value));
            }
          }
          setAttributeValuesByScreenshot(map);
        } else {
          setAttributeValuesByScreenshot({});
        }
      }
    }

    setLoading(false);
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
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedIndex(null);
        return;
      }

      const tagFilterLower = tagFilter.trim().toLowerCase();
      const attributeFilterLower = attributeFilter.trim().toLowerCase();

      const filteredScreenshots = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const values = attributeValuesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          !attributeFilterLower ||
          values.some((v) =>
            v.toLowerCase().includes(attributeFilterLower)
          );

        return matchesTag && matchesAttribute;
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
  }, [screenshots, tagFilter, attributeFilter, attributeValuesByScreenshot, selectedIndex]);

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

  useEffect(() => {
    if (selectedIndex === null) {
      setCurrentNote("");
      return;
    }

    const tagFilterLower = tagFilter.trim().toLowerCase();
    const attributeFilterLower = attributeFilter.trim().toLowerCase();

    const filtered = screenshots.filter((s) => {
      const matchesTag =
        !tagFilterLower ||
        s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

      const values = attributeValuesByScreenshot[s.id] ?? [];
      const matchesAttribute =
        !attributeFilterLower ||
        values.some((v) => v.toLowerCase().includes(attributeFilterLower));

      return matchesTag && matchesAttribute;
    });

    const shot = filtered[selectedIndex];
    setCurrentNote(shot?.notes ?? "");
  }, [selectedIndex, screenshots, tagFilter, attributeFilter, attributeValuesByScreenshot]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAttributes() {
      if (selectedIndex === null) {
        if (!cancelled) setAttributes([]);
        return;
      }

      const tagFilterLower = tagFilter.trim().toLowerCase();
      const attributeFilterLower = attributeFilter.trim().toLowerCase();

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const values = attributeValuesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          !attributeFilterLower ||
          values.some((v) => v.toLowerCase().includes(attributeFilterLower));

        return matchesTag && matchesAttribute;
      });

      const screenshot = filtered[selectedIndex];
      if (!screenshot) {
        if (!cancelled) setAttributes([]);
        return;
      }

      const { data } = await supabase
        .from("trade_attributes")
        .select("*")
        .eq("screenshot_id", screenshot.id);

      if (!cancelled) setAttributes(data || []);
    }

    fetchAttributes();
    return () => {
      cancelled = true;
    };
  }, [selectedIndex, tagFilter, attributeFilter, attributeValuesByScreenshot]);

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

  async function handleSaveNote() {
    if (selectedIndex === null) return;

    setSavingNote(true);
    setError(null);
    try {
      const tagFilterLower = tagFilter.trim().toLowerCase();
      const attributeFilterLower = attributeFilter.trim().toLowerCase();

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const values = attributeValuesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          !attributeFilterLower ||
          values.some((v) => v.toLowerCase().includes(attributeFilterLower));

        return matchesTag && matchesAttribute;
      });

      const shot = filtered[selectedIndex];
      if (!shot) return;

      const { error: saveError } = await supabase
        .from("screenshots")
        .update({ notes: currentNote })
        .eq("id", shot.id);

      if (saveError) {
        setError(saveError.message);
        return;
      }

      // Keep UI in sync for note navigation.
      setScreenshots((prev) =>
        prev.map((s) =>
          s.id === shot.id
            ? {
                ...s,
                notes: currentNote,
              }
            : s
        )
      );

      setSavedNoteToast(true);
      setTimeout(() => setSavedNoteToast(false), 2000);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleSaveAttributes() {
    if (selectedIndex === null) return;

    setSavingAttributes(true);
    setError(null);

    try {
      const tagFilterLower = tagFilter.trim().toLowerCase();
      const attributeFilterLower = attributeFilter.trim().toLowerCase();

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const values = attributeValuesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          !attributeFilterLower ||
          values.some((v) => v.toLowerCase().includes(attributeFilterLower));

        return matchesTag && matchesAttribute;
      });

      const screenshot = filtered[selectedIndex];
      if (!screenshot) return;

      // delete old attributes
      const { error: deleteError } = await supabase
        .from("trade_attributes")
        .delete()
        .eq("screenshot_id", screenshot.id);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      // insert new ones
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData.user) {
        setError(userError?.message ?? "User not found.");
        return;
      }

      const rows = attributes
        .map((attr) => ({
          screenshot_id: screenshot.id,
          user_id: userData.user.id,
          key: (attr?.key ?? "").toString(),
          value: (attr?.value ?? "").toString(),
        }))
        .filter((r) => r.key.trim().length > 0);

      if (rows.length === 0) return;

      const { error: insertError } = await supabase
        .from("trade_attributes")
        .insert(rows);

      if (insertError) {
        setError(insertError.message);
        return;
      }
    } finally {
      setSavingAttributes(false);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-600">Loading screenshots...</p>
      </div>
    );
  }

  const tagFilterLower = tagFilter.trim().toLowerCase();
  const attributeFilterLower = attributeFilter.trim().toLowerCase();

  const filteredScreenshots = screenshots.filter((s) => {
    const matchesTag =
      !tagFilterLower ||
      s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

    const values = attributeValuesByScreenshot[s.id] ?? [];
    const matchesAttribute =
      !attributeFilterLower ||
      values.some((v) => v.toLowerCase().includes(attributeFilterLower));

    return matchesTag && matchesAttribute;
  });

  const selectedImage =
    selectedIndex !== null ? filteredScreenshots[selectedIndex] ?? null : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-8 font-sans">
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
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

          <section className="mt-6 space-y-3">
            {screenshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-lg font-semibold text-gray-900">
                  No screenshots yet
                </p>

                <p className="mt-2 text-sm text-gray-600">
                  Upload or paste your first trade to get started
                </p>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder="Filter by tag..."
                  className="mb-6 w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-300 transition"
                />
                <input
                  type="text"
                  value={attributeFilter}
                  onChange={(e) => setAttributeFilter(e.target.value)}
                  placeholder="Filter by attribute (e.g. Long)"
                  className="mb-6 w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-300 transition"
                />
                {filteredScreenshots.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <p className="text-lg font-semibold text-gray-900">
                      No screenshots yet
                    </p>

                    <p className="mt-2 text-sm text-gray-600">
                      Upload or paste your first trade to get started
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredScreenshots.map((shot, index) => (
                      <div
                        key={shot.id}
                        onClick={() => setSelectedIndex(index)}
                        className="
                          group
                          flex flex-col h-full
                          rounded-xl
                          overflow-hidden
                          bg-white
                          border border-gray-200
                          shadow-sm
                          hover:shadow-md
                          transition-all duration-200
                          cursor-pointer
                        "
                      >
                        <div className="w-full aspect-[4/3] overflow-hidden bg-gray-100">
                          <img
                            src={shot.image_url}
                            alt="Uploaded screenshot"
                            onLoad={() => handleImageLoaded(shot.id)}
                            className={`w-full h-full object-cover cursor-pointer transition-transform duration-200 group-hover:scale-[1.02] ${
                              loadedImages[shot.id] ? "opacity-100" : "opacity-0"
                            }`}
                          />
                        </div>

                        <div className="flex flex-col justify-center flex-grow px-3 py-3 min-h-[3.5rem]">
                          {shot.tags && shot.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
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
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
      </div>

      {false && (
        <div
          className={`fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-200 relative group ${
            modalEntered ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* ✅ Close when clicking background */}
          <div
            className="absolute inset-0"
            onClick={() => setSelectedIndex(null)}
          />

          {/* LEFT arrow */}
          {selectedIndex !== null && selectedIndex! > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIndex((prev) =>
                  prev !== null && prev > 0 ? prev - 1 : prev
                );
              }}
              className="
                absolute left-4 top-1/2 -translate-y-1/2
                z-[100000]
                text-white text-3xl
                bg-black/40
                w-12 h-12
                rounded-full
                flex items-center justify-center
                cursor-pointer
                transition-all duration-200
                opacity-0 group-hover:opacity-100
                hover:bg-black/60
              "
            >
              ←
            </button>
          )}

          {/* RIGHT arrow */}
          {selectedIndex !== null &&
            selectedIndex! < filteredScreenshots.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIndex((prev) =>
                    prev !== null && prev < filteredScreenshots.length - 1
                      ? prev + 1
                      : prev
                  );
                }}
                className="
                  absolute right-4 top-1/2 -translate-y-1/2
                  z-[100000]
                  text-white text-3xl
                  bg-black/40
                  w-12 h-12
                  rounded-full
                  flex items-center justify-center
                  cursor-pointer
                  transition-all duration-200
                  opacity-0 group-hover:opacity-100
                  hover:bg-black/60
                "
              >
                →
              </button>
            )}

          {/* Close (X) */}
          <button
            type="button"
            onClick={() => setSelectedIndex(null)}
            aria-label="Close modal"
            className="
              absolute top-4 right-4 z-[100000]
              text-white text-xl
              bg-black/50 hover:bg-black/70
              rounded-full w-10 h-10
              flex items-center justify-center
              transition
            "
          >
            ×
          </button>

          {/* Image */}
          <div
            className="relative z-10 transform transition-all duration-200 scale-95 opacity-0"
            style={{ animation: "fadeIn 0.2s ease-out forwards" }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={filteredScreenshots[selectedIndex!].image_url}
              alt=""
              className="max-h-[90vh] max-w-[90vw] origin-center rounded-lg shadow-lg"
            />
          </div>

          {/* Counter */}
          <div
            className="
              absolute bottom-4 left-1/2 -translate-x-1/2
              z-50
              text-white text-sm
              bg-black/50 px-3 py-1 rounded-full
            "
          >
            {selectedIndex! + 1} / {filteredScreenshots.length}
          </div>
        </div>
      )}
      {mounted &&
        selectedImage &&
        createPortal(
          <div
            className="flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-200 relative group opacity-100"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 2147483647,
              transform: "none",
              width: "100vw",
              height: "100vh",
              pointerEvents: "auto",
            }}
          >
            {/* ✅ Close when clicking background */}
            <div
              className="absolute inset-0"
              onClick={() => setSelectedIndex(null)}
            />

            {/* LEFT arrow */}
            {selectedIndex !== null && selectedIndex! > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIndex((prev) =>
                    prev !== null && prev > 0 ? prev - 1 : prev
                  );
                }}
                className="
                  absolute left-4 top-1/2 -translate-y-1/2
                  z-[2147483646]
                  text-white text-3xl
                  bg-black/40
                  w-12 h-12
                  rounded-full
                  flex items-center justify-center
                  cursor-pointer
                  transition-all duration-200
                  opacity-0 group-hover:opacity-100
                  hover:bg-black/60
                "
              >
                ←
              </button>
            )}

            {/* RIGHT arrow */}
            {selectedIndex !== null &&
              selectedIndex! < filteredScreenshots.length - 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedIndex((prev) =>
                      prev !== null && prev < filteredScreenshots.length - 1
                        ? prev + 1
                        : prev
                    );
                  }}
                  className="
                    absolute right-4 top-1/2 -translate-y-1/2
                  z-[2147483646]
                    text-white text-3xl
                    bg-black/40
                    w-12 h-12
                    rounded-full
                    flex items-center justify-center
                    cursor-pointer
                    transition-all duration-200
                    opacity-0 group-hover:opacity-100
                    hover:bg-black/60
                  "
                >
                  →
                </button>
              )}

            {/* Close (X) */}
            <button
              type="button"
              onClick={() => setSelectedIndex(null)}
              aria-label="Close modal"
              className="
                absolute top-4 right-4 z-[2147483646]
                text-white text-xl
                bg-black/50 hover:bg-black/70
                rounded-full w-10 h-10
                flex items-center justify-center
                transition
              "
            >
              ×
            </button>

            {/* Image */}
            <div className="flex flex-col items-center">
              <div
                className="relative z-[2147483645] transform transition-all duration-200 scale-95 opacity-0"
                style={{ animation: "fadeIn 0.2s ease-out forwards" }}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={filteredScreenshots[selectedIndex!].image_url}
                  alt=""
                  className="max-h-[90vh] max-w-[90vw] origin-center rounded-lg shadow-lg"
                />
              </div>

              <div className="relative z-10 mt-4 w-full max-w-xl">
                <textarea
                  value={currentNote}
                  onChange={(e) => setCurrentNote(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900"
                  placeholder="Add notes about this trade..."
                />

                <button
                  type="button"
                  onClick={handleSaveNote}
                  disabled={savingNote}
                  className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 transition"
                >
                  {savingNote ? "Saving note..." : "Save note"}
                </button>

                {savedNoteToast && (
                  <div className="mt-2 text-xs text-green-200">
                    Saved ✓
                  </div>
                )}
              </div>

              <div className="relative z-10 mt-4 w-full max-w-xl space-y-2">
                {attributes.map((attr, index) => (
                  <div key={attr.id ?? index} className="flex gap-2">
                    <input
                      value={attr.key || ""}
                      onChange={(e) => {
                        const updated = [...attributes];
                        updated[index].key = e.target.value;
                        setAttributes(updated);
                      }}
                      placeholder="Field (e.g. Direction)"
                      className="w-1/2 rounded-lg border px-2 py-1 text-sm"
                    />

                    <input
                      value={attr.value || ""}
                      onChange={(e) => {
                        const updated = [...attributes];
                        updated[index].value = e.target.value;
                        setAttributes(updated);
                      }}
                      placeholder="Value (e.g. Long)"
                      className="w-1/2 rounded-lg border px-2 py-1 text-sm"
                    />
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setAttributes([
                      ...attributes,
                      { id: `tmp-${Date.now()}-${Math.random()}`, key: "", value: "" },
                    ])
                  }
                  className="text-sm text-blue-600"
                >
                  + Add field
                </button>

                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await handleSaveAttributes();
                  }}
                  disabled={savingAttributes}
                  className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 transition"
                >
                  {savingAttributes ? "Saving attributes..." : "Save attributes"}
                </button>
              </div>
            </div>

            {/* Counter */}
            <div
              className="
                absolute bottom-4 left-1/2 -translate-x-1/2
              z-[2147483644]
                text-white text-sm
                bg-black/50 px-3 py-1 rounded-full
              "
            >
              {selectedIndex! + 1} / {filteredScreenshots.length}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

