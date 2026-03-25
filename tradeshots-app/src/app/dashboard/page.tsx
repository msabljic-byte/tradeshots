"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [allAttributes, setAllAttributes] = useState<any[]>([]);
  const [attributeKeyValuesByScreenshot, setAttributeKeyValuesByScreenshot] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [filters, setFilters] = useState<
    Array<{
      key: string;
      value: string;
    }>
  >([]);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
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

  function addFilter(key: string, value: string) {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedKey || !normalizedValue) return;

    setFilters((prev) => {
      const exists = prev.some(
        (f) => f.key === normalizedKey && f.value === normalizedValue
      );
      if (exists) return prev;
      return [...prev, { key: normalizedKey, value: normalizedValue }];
    });

    setShowFilterMenu(false);
    setSelectedKey("");
    setSearchTerm("");
  }

  function removeFilter(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }

  const fetchScreenshots = async () => {
    setLoading(true);
    setAttributeKeyValuesByScreenshot({});

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
      setAttributeKeyValuesByScreenshot({});
    } else {
      setError(null);
      const screenshotRows = (data ?? []) as ScreenshotRow[];
      setScreenshots(screenshotRows);

      const screenshotIds = screenshotRows.map((s) => s.id);
      if (screenshotIds.length > 0) {
        const { data: attrData, error: attrError } = await supabase
          .from("trade_attributes")
          .select("screenshot_id,key,value")
          .in("screenshot_id", screenshotIds);

        if (!attrError && attrData) {
          const map: Record<string, Record<string, string[]>> = {};
          for (const row of attrData as any[]) {
            const sid = row.screenshot_id;
            const key = row.key;
            const value = row.value;
            if (!sid) continue;
            if (!map[sid]) map[sid] = {};
            if (key !== null && key !== undefined && value !== null && value !== undefined) {
              const keyLower = String(key).trim().toLowerCase();
              const valueLower = String(value).trim().toLowerCase();
              if (!keyLower || !valueLower) continue;
              if (!map[sid][keyLower]) map[sid][keyLower] = [];
              if (!map[sid][keyLower].includes(valueLower)) {
                map[sid][keyLower].push(valueLower);
              }
            }
          }
          setAttributeKeyValuesByScreenshot(map);
        } else {
          setAttributeKeyValuesByScreenshot({});
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
    if (selectedIndex === null) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [selectedIndex]);

  useEffect(() => {
    async function fetchAllAttributes() {
      const { data } = await supabase.from("trade_attributes").select("key,value");
      setAllAttributes(data || []);
    }

    fetchAllAttributes();
  }, []);

  // Group attributes per screenshot to enable scalable multi-filter logic.
  const attributesByScreenshot = useMemo(() => {
    const result: Record<
      string,
      Array<{ key: string; value: string }>
    > = {};

    for (const [screenshotId, keyMap] of Object.entries(
      attributeKeyValuesByScreenshot
    )) {
      const pairs: Array<{ key: string; value: string }> = [];
      for (const [key, values] of Object.entries(keyMap ?? {})) {
        for (const value of values ?? []) {
          pairs.push({ key, value });
        }
      }
      result[screenshotId] = pairs;
    }

    return result;
  }, [attributeKeyValuesByScreenshot]);

  const allAttributesNormalized = useMemo(() => {
    return (allAttributes ?? [])
      .map((a: any) => ({
        key: String(a?.key ?? "").trim().toLowerCase(),
        value: String(a?.value ?? "").trim().toLowerCase(),
      }))
      .filter((a) => a.key.length > 0 && a.value.length >0);
  }, [allAttributes]);

  const uniqueKeys = useMemo(() => {
    return [
      ...new Set(allAttributesNormalized.map((a) => a.key).filter(Boolean)),
    ];
  }, [allAttributesNormalized]);

  const valuesForKey = useMemo(() => {
    return [
      ...new Set(
        allAttributesNormalized
          .filter((a) => a.key === selectedKey)
          .map((a) => a.value)
          .filter(Boolean)
      ),
    ];
  }, [allAttributesNormalized, selectedKey]);

  const filteredKeys = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return uniqueKeys;
    return uniqueKeys.filter((k) => k.toLowerCase().includes(term));
  }, [searchTerm, uniqueKeys]);

  const filteredValues = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return valuesForKey;
    return valuesForKey.filter((v) => v.toLowerCase().includes(term));
  }, [searchTerm, valuesForKey]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showFilterMenu) {
          setShowFilterMenu(false);
          return;
        }
        setSelectedIndex(null);
        return;
      }

      if (showFilterMenu) return;

      const tagFilterLower = tagFilter.trim().toLowerCase();

      const filteredScreenshots = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
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
  }, [
    screenshots,
    tagFilter,
    filters,
    attributesByScreenshot,
    showFilterMenu,
    selectedIndex,
  ]);

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

    const filtered = screenshots.filter((s) => {
      const matchesTag =
        !tagFilterLower ||
        s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

      const pairs = attributesByScreenshot[s.id] ?? [];
      const matchesAttribute =
        filters.length === 0 ||
        filters.every((f) =>
          pairs.some((a) => a.key === f.key && a.value === f.value)
        );

      return matchesTag && matchesAttribute;
    });

    const shot = filtered[selectedIndex];
    setCurrentNote(shot?.notes ?? "");
  }, [
    selectedIndex,
    screenshots,
    tagFilter,
    filters,
    attributesByScreenshot,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAttributes() {
      if (selectedIndex === null) {
        if (!cancelled) setAttributes([]);
        return;
      }

      const tagFilterLower = tagFilter.trim().toLowerCase();

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
          );

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
  }, [
    selectedIndex,
    tagFilter,
    filters,
    attributesByScreenshot,
  ]);

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

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
          );

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

      const filtered = screenshots.filter((s) => {
        const matchesTag =
          !tagFilterLower ||
          s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

        const pairs = attributesByScreenshot[s.id] ?? [];
        const matchesAttribute =
          filters.length === 0 ||
          filters.every((f) =>
            pairs.some((a) => a.key === f.key && a.value === f.value)
          );

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
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-7xl px-6 py-6 font-sans">
          <p className="text-sm text-gray-600">Checking your session...</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-7xl px-6 py-6 font-sans">
          <p className="text-sm text-gray-600">Loading screenshots...</p>
        </div>
      </div>
    );
  }

  const tagFilterLower = tagFilter.trim().toLowerCase();

  const filteredScreenshots = screenshots.filter((s) => {
    const matchesTag =
      !tagFilterLower ||
      s.tags?.some((tag) => tag.toLowerCase().includes(tagFilterLower));

    if (filters.length === 0) return matchesTag;

    const pairs = attributesByScreenshot[s.id] ?? [];
    const matchesAttributes = filters.every((filter) =>
      pairs.some(
        (a) => a.key === filter.key && a.value === filter.value
      )
    );

    return matchesTag && matchesAttributes;
  });

  const selectedImage =
    selectedIndex !== null ? filteredScreenshots[selectedIndex] ?? null : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-6 py-6 font-sans">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">TradeShots</h1>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">{email ?? ""}</div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="text-sm font-medium text-gray-700 transition hover:text-gray-900 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Log out"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-gray-900">Your Screenshots</h2>
        </div>

        <div className="mb-6">
          <ScreenshotUploader onUploadComplete={fetchScreenshots} />
        </div>

        {screenshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-lg font-medium text-gray-900">No screenshots yet</p>
            <p className="mt-2 text-sm text-gray-600">
              Upload your first trade to get started
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <input
                type="text"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder="Filter by tag..."
                className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-500 transition focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowFilterMenu(true);
                    setSelectedKey("");
                    setSearchTerm("");
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-gray-100"
                >
                  + Add Filter
                </button>

                {filters.map((f, index) => (
                  <div
                    key={`${f.key}-${f.value}-${index}`}
                    className="flex items-center gap-2 rounded-full bg-gray-900 px-3 py-1 text-sm text-white shadow-sm"
                  >
                    <span className="font-medium">
                      {f.key}: {f.value}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFilter(index)}
                      className="text-white/70 transition hover:text-white"
                      aria-label="Remove filter"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {showFilterMenu && (
                <div
                  className="fixed inset-0 z-50 flex cursor-pointer items-start justify-center bg-black/40 pt-32"
                  onClick={() => setShowFilterMenu(false)}
                >
                  <div
                    className="w-full max-w-md cursor-default rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      autoFocus
                      placeholder={
                        selectedKey ? "Search value..." : "Search attribute..."
                      }
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full border-b border-gray-300 px-2 py-2 text-sm text-gray-900 placeholder:text-gray-500 outline-none"
                    />

                    <div className="mt-2 max-h-60 overflow-y-auto">
                      {!selectedKey ? (
                        filteredKeys.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-gray-500">
                            No results found
                          </div>
                        ) : (
                          filteredKeys.map((key) => (
                            <div
                              key={key}
                              onClick={() => {
                                setSelectedKey(key);
                                setSearchTerm("");
                              }}
                              className="cursor-pointer rounded px-3 py-2 text-sm text-gray-900 transition hover:bg-gray-100"
                            >
                              {key}
                            </div>
                          ))
                        )
                      ) : filteredValues.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">
                          No results found
                        </div>
                      ) : (
                        filteredValues.map((value) => (
                          <div
                            key={value}
                            onClick={() => addFilter(selectedKey, value)}
                            className="cursor-pointer rounded px-3 py-2 text-sm text-gray-900 transition hover:bg-gray-100"
                          >
                            {value}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {filteredScreenshots.length === 0 ? (
              <div className="py-12">
                <p className="text-lg font-semibold text-gray-900">
                  No matching screenshots
                </p>
                <p className="mt-2 text-sm text-gray-600">
                  Try adjusting tags or filters
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {filteredScreenshots.map((shot, index) => (
                  <div
                    key={shot.id}
                    onClick={() => setSelectedIndex(index)}
                    className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="relative h-48 w-full overflow-hidden bg-gray-100">
                      <img
                        src={shot.image_url}
                        alt="Uploaded screenshot"
                        onLoad={() => handleImageLoaded(shot.id)}
                        className={`h-48 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
                          loadedImages[shot.id] ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/10" />
                      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        View
                      </div>
                    </div>

                    <div className="flex min-h-[3.5rem] flex-grow flex-col justify-center px-3 py-3">
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
            className="fixed inset-0 z-[2147483647] overflow-hidden bg-black/70 backdrop-blur-sm transition-opacity duration-200 group opacity-100"
            style={{
              transform: "none",
              pointerEvents: "auto",
            }}
          >
            {/* Dismiss layer (behind sheet) */}
            <div
              className="absolute inset-0 z-0 cursor-pointer"
              onClick={() => setSelectedIndex(null)}
            />

            <div className="absolute inset-0 z-10 flex min-h-0 min-w-0 overflow-hidden bg-white shadow-xl">
              {/* LEFT: IMAGE */}
              <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
                <div className="flex h-full min-h-0 w-full items-center justify-center p-2">
                  <img
                    src={filteredScreenshots[selectedIndex!].image_url}
                    alt=""
                    className="max-h-full max-w-full w-auto cursor-default object-contain"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>

              {/* RIGHT: PANEL — only this column scrolls when content is tall */}
              <div className="box-border flex h-full min-h-0 w-[320px] shrink-0 flex-col overflow-y-auto overflow-x-hidden border-l border-gray-200 p-4">
                {/* NOTES */}
                <div>
                  <p className="text-sm font-semibold text-gray-900">Notes</p>
                  <textarea
                    value={currentNote}
                    onChange={(e) => setCurrentNote(e.target.value)}
                    placeholder="Write your trade thoughts..."
                    className="mt-2 w-full h-24 rounded-lg border border-gray-300 p-2 text-sm text-gray-900"
                  />

                  <button
                    type="button"
                    onClick={handleSaveNote}
                    disabled={savingNote}
                    className="mt-2 w-full rounded-lg bg-gray-900 py-2 text-sm text-white hover:bg-gray-800 transition"
                  >
                    {savingNote ? "Saving note..." : "Save note"}
                  </button>

                  {savedNoteToast && (
                    <div className="mt-2 text-xs text-green-200">Saved ✓</div>
                  )}
                </div>

                {/* ATTRIBUTES */}
                <div className="mt-6">
                  <p className="text-sm font-semibold text-gray-900">Attributes</p>

                  <div className="mt-2 space-y-2">
                    {attributes.map((attr, index) => (
                      <div key={attr.id ?? index} className="flex gap-2">
                        <input
                          value={attr.key || ""}
                          onChange={(e) => {
                            const updated = [...attributes];
                            updated[index].key = e.target.value;
                            setAttributes(updated);
                          }}
                          placeholder="Field"
                          className="w-1/2 rounded-md border px-2 py-1 text-sm"
                        />

                        <input
                          value={attr.value || ""}
                          onChange={(e) => {
                            const updated = [...attributes];
                            updated[index].value = e.target.value;
                            setAttributes(updated);
                          }}
                          placeholder="Value"
                          className="w-1/2 rounded-md border px-2 py-1 text-sm"
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setAttributes([
                        ...attributes,
                        { id: `tmp-${Date.now()}-${Math.random()}`, key: "", value: "" },
                      ])
                    }
                    className="mt-3 text-sm text-blue-600 hover:underline"
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
                    className="mt-3 w-full rounded-lg bg-gray-900 py-2 text-sm text-white hover:bg-gray-800 transition"
                  >
                    {savingAttributes ? "Saving attributes..." : "Save attributes"}
                  </button>
                </div>
              </div>
            </div>

            {/* Fixed controls — above sheet + image so they’re never covered or clipped */}
            <button
              type="button"
              onClick={() => setSelectedIndex(null)}
              aria-label="Close modal"
              className="fixed top-4 z-[2147483646] flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-xl text-white shadow-lg ring-2 ring-white/30 transition hover:bg-zinc-800"
              style={{
                right: "clamp(1rem, calc(320px + 1rem), calc(100vw - 3rem))",
              }}
            >
              ×
            </button>

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
                  fixed left-4 top-1/2 z-[2147483646] -translate-y-1/2
                  flex h-12 w-12 items-center justify-center rounded-full
                  bg-black/50 text-3xl text-white shadow-lg
                  opacity-0 transition-all duration-200 hover:bg-black/70
                  group-hover:opacity-100
                "
              >
                ←
              </button>
            )}

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
                    fixed top-1/2 z-[2147483646] -translate-y-1/2
                    flex h-12 w-12 items-center justify-center rounded-full
                    bg-black/50 text-3xl text-white shadow-lg
                    opacity-0 transition-all duration-200 hover:bg-black/70
                    group-hover:opacity-100
                  "
                  style={{
                    right: "clamp(1rem, calc(320px + 1rem), calc(100vw - 3rem))",
                  }}
                >
                  →
                </button>
              )}

            <div
              className="fixed bottom-4 left-1/2 z-[2147483645] -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white"
            >
              {selectedIndex! + 1} / {filteredScreenshots.length}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

