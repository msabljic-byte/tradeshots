"use client";

import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { syncSharedPlaybookAndNotifyImporters } from "@/lib/notifyPlaybookUpdate";
import { X } from "lucide-react";

export default function ScreenshotUploader({
  folderId,
  onUploadComplete,
}: {
  /** When set, new screenshots are created inside this playbook folder. */
  folderId?: string | null;
  onUploadComplete?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function normalizeTag(tag: string) {
    return tag.trim();
  }

  function addTagsFromString(value: string) {
    const parts = value
      .split(",")
      .map(normalizeTag)
      .filter((t) => t.length > 0);

    if (parts.length === 0) return;

    setTags((prev) => {
      const seen = new Set(prev.map((t) => t.toLowerCase()));
      const next = [...prev];
      for (const t of parts) {
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(t);
      }
      return next;
    });
  }

  function commitDraft() {
    const t = normalizeTag(tagDraft);
    if (!t) return;
    addTagsFromString(t);
    setTagDraft("");
  }

  function removeTag(tagToRemove: string) {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function uploadScreenshot(file: File) {
    if (isUploading) return;

    setIsUploading(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        alert("You must be logged in to upload");
        return;
      }

      const extension = file.name.includes(".")
        ? file.name.split(".").pop()
        : "png";
      const fileName = `${user.id}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("screenshots")
        .upload(fileName, file, {
          upsert: false,
        });

      if (uploadError) {
        setErrorMessage(uploadError.message);
        setTimeout(() => {
          setErrorMessage(null);
        }, 3000);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("screenshots")
        .getPublicUrl(fileName);

      const publicUrl = publicUrlData.publicUrl;
      const draftTags = tagDraft
        .split(",")
        .map(normalizeTag)
        .filter((t) => t.length > 0);
      const tagsArray = [...tags, ...draftTags].filter((t, i, arr) => {
        const key = t.toLowerCase();
        return arr.findIndex((x) => x.toLowerCase() === key) === i;
      });

      console.log("Uploading for user:", user.id);

      const insertPayload: Record<string, unknown> = {
        user_id: user.id,
        image_url: publicUrl,
        tags: tagsArray,
      };
      if (folderId != null && folderId !== "") {
        insertPayload.folder_id = folderId;
      }

      const { error: insertError } = await supabase
        .from("screenshots")
        .insert(insertPayload);

      if (insertError) {
        setErrorMessage(insertError.message);
        setTimeout(() => {
          setErrorMessage(null);
        }, 3000);
        return;
      }

      if (folderId != null && folderId !== "") {
        await syncSharedPlaybookAndNotifyImporters(
          supabase,
          folderId,
          "new_content"
        );
      }

      setSuccessMessage("Screenshot uploaded successfully.");
      setTags([]);
      setTagDraft("");
      setTimeout(() => {
        setSuccessMessage(null);
      }, 2500);
      onUploadComplete?.();
    } finally {
      setIsUploading(false);
    }
  }

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      if (!event.clipboardData) return;

      const items = event.clipboardData.items;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            setIsPasting(true);
            await uploadScreenshot(file);
            setTimeout(() => setIsPasting(false), 800);
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, []);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    await uploadScreenshot(file);

    // Allow selecting the same file again.
    e.target.value = "";
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    await uploadScreenshot(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave() {
    setIsDragActive(false);
  }

  return (
    <div className="w-full rounded-2xl border border-default bg-surface p-6 shadow-sm">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus-within:ring-2 focus-within:ring-gray-300 transition">
          {tags.map((tag) => (
            <span
              key={tag}
              className="relative inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => removeTag(tag)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-[10px] leading-none text-gray-600 transition-colors duration-150 ease-in-out hover:bg-gray-100 hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagDraft}
            onChange={(e) => {
              const next = e.target.value;
              if (next.includes(",")) {
                const parts = next.split(",");
                const complete = parts.slice(0, -1).join(",");
                const remainder = parts[parts.length - 1] ?? "";
                addTagsFromString(complete);
                setTagDraft(remainder);
                return;
              }
              setTagDraft(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "," || e.key === "Enter") {
                e.preventDefault();
                commitDraft();
                return;
              }
              if (e.key === "Backspace" && tagDraft.length === 0 && tags.length > 0) {
                setTags((prev) => prev.slice(0, -1));
              }
            }}
            placeholder={tags.length === 0 ? "Add tags (comma separated)" : "Add another tag..."}
            className="min-w-[10ch] flex-1 bg-transparent px-1 py-1 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
          />
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-500">example: breakout, reversal, fakeout</p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      <div
        role="button"
        tabIndex={0}
        onClick={openFilePicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openFilePicker();
          }
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all duration-150 ease-in-out
${isDragActive
  ? "border-gray-900 bg-gray-100 scale-[1.01]"
  : "border-gray-300 hover:border-gray-400 hover:bg-gray-100"
}
${isUploading ? "pointer-events-none opacity-50" : ""}
`.trim()}
      >
        <p className="text-lg font-semibold text-gray-900">
          Drag & drop your screenshot
        </p>
        <p className="mt-2 text-sm text-gray-600">or click to upload</p>
        <p className="mt-1 text-xs text-gray-600">or paste screenshot (Ctrl + V)</p>

        {isUploading && (
          <p className="mt-4 text-sm font-medium text-gray-600">Uploading...</p>
        )}
        {isPasting && (
          <p className="mt-2 text-sm font-medium text-gray-600">Pasting screenshot...</p>
        )}
      </div>

      {successMessage && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 transition">
          Screenshot uploaded successfully
        </div>
      )}

      {errorMessage && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 transition-opacity duration-300">
          {errorMessage}
        </div>
      )}
    </div>
  );
}

