"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ScreenshotUploader({
  onUploadComplete,
}: {
  onUploadComplete?: () => void;
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

      const { error: insertError } = await supabase.from("screenshots").insert({
        user_id: user.id,
        image_url: publicUrl,
      });

      if (insertError) {
        setErrorMessage(insertError.message);
        setTimeout(() => {
          setErrorMessage(null);
        }, 3000);
        return;
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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    await uploadScreenshot(file);

    // Allow selecting the same file again.
    e.target.value = "";
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    await uploadScreenshot(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragActive(true);
  }

  function handleDragLeave() {
    setIsDragActive(false);
  }

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl bg-white p-6 shadow-md">
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
        className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
          isDragActive
            ? "border-gray-400 bg-gray-50"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        } ${isUploading ? "pointer-events-none opacity-50" : ""}`}
      >
        <p className="text-lg font-semibold text-gray-900">
          Drag & drop your screenshot
        </p>
        <p className="mt-2 text-sm text-gray-600">or click to upload</p>
        <p className="mt-1 text-xs text-gray-500">or paste screenshot (Ctrl + V)</p>

        {isUploading && (
          <p className="mt-4 text-sm font-medium text-gray-700">Uploading...</p>
        )}
        {isPasting && (
          <p className="mt-2 text-sm font-medium text-gray-700">Pasting screenshot...</p>
        )}
      </div>

      {successMessage && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 transition-opacity duration-300">
          {successMessage}
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

