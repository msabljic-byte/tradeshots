"use client";

/**
 * Dropzone + file picker + clipboard paste for uploading images to Supabase Storage and inserting a
 * `screenshots` row. When `folderId` is set, notifies shared-playbook importers after upload (`new_content`).
 *
 * The single `useEffect` registers a window `paste` listener (see `// useEffect:` there).
 */
import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { syncSharedPlaybookAndNotifyImporters } from "@/lib/notifyPlaybookUpdate";
import { Plus } from "lucide-react";

export default function ScreenshotUploader({
  folderId,
  onUploadComplete,
  compact = false,
}: {
  /** When set, new screenshots are created inside this playbook folder. */
  folderId?: string | null;
  onUploadComplete?: () => void;
  compact?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      console.log("Uploading for user:", user.id);

      const insertPayload: Record<string, unknown> = {
        user_id: user.id,
        image_url: publicUrl,
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
      setTimeout(() => {
        setSuccessMessage(null);
      }, 2500);
      onUploadComplete?.();
    } finally {
      setIsUploading(false);
    }
  }

  // useEffect: global paste — if clipboard has an image, upload it (same path as file picker).
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
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {compact ? (
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
cursor-pointer flex h-14 w-full items-center justify-between rounded-[var(--radius-lg)] border-[1.5px] border-dashed border-[color:var(--border-strong)] bg-surface px-4 py-3
${isDragActive ? "border-solid border-[color:var(--accent)] bg-[color:var(--accent-tint)] scale-[1.005]" : "hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-tint)]"}
${isUploading ? "pointer-events-none opacity-50" : ""}
`.trim()}
          style={{
            transition:
              "border-color var(--motion-fast), background-color var(--motion-fast), transform var(--motion-fast)",
          }}
        >
          <div className="flex items-center gap-2">
            <Plus size={16} strokeWidth={1.5} color="var(--text-muted)" aria-hidden />
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "16px",
                fontWeight: 400,
                color: "var(--text-primary)",
              }}
            >
              Add a screenshot
            </span>
          </div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Drop here · Paste · Ctrl + V
          </span>
        </div>
      ) : (
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
cursor-pointer rounded-2xl border-[1.5px] border-dashed border-[color:var(--border-strong)] bg-surface px-8 py-16 text-center transition-all duration-150 ease-in-out
${isDragActive ? "bg-surface-muted scale-[1.01]" : "hover:bg-surface-muted"}
${isUploading ? "pointer-events-none opacity-50" : ""}
`.trim()}
        >
          <p className="text-[24px] font-normal italic leading-[1.2] text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
            Begin your record
          </p>
          <p className="mt-2 text-[15px] font-normal text-muted" style={{ fontFamily: "var(--font-serif)" }}>
            Drop a screenshot here, or click to upload.
          </p>
          <p className="mt-3 text-[10px] uppercase tracking-[0.15em] text-muted" style={{ fontFamily: "var(--font-mono)" }}>
            OR PASTE A SCREENSHOT (CTRL + V)
          </p>

          {isUploading && (
            <p className="app-body mt-4 text-sm">Saving screenshot...</p>
          )}
          {isPasting && (
            <p className="app-body mt-2 text-sm">Reading from clipboard...</p>
          )}
        </div>
      )}

      {successMessage && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 transition">
          Screenshot saved.
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

