"use client";

import { useState } from "react";
import { X } from "lucide-react";

type SaveViewDialogProps = {
  open: boolean;
  initialName?: string;
  isUpdate?: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

export function SaveViewDialog({
  open,
  initialName = "",
  isUpdate = false,
  onConfirm,
  onCancel,
}: SaveViewDialogProps) {
  const [name, setName] = useState(initialName);

  if (!open) return null;

  const trimmed = name.trim();
  const canConfirm = trimmed.length > 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(26, 24, 21, 0.4)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] p-6"
        style={{ width: 400, boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-xl font-medium text-[var(--text-primary)]">
            {isUpdate ? "Update view" : "Save view"}
          </h2>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] block mb-2">
          Name
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) onConfirm(trimmed);
            if (e.key === "Escape") onCancel();
          }}
          placeholder="e.g., EURUSD breakouts"
          className="ui-input w-full text-sm px-3 py-2 mb-4"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="font-mono text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--bg-shadow)]"
          >
            Cancel
          </button>
          <button
            onClick={() => canConfirm && onConfirm(trimmed)}
            disabled={!canConfirm}
            className="ui-button-primary px-4 py-2 text-[11px]"
          >
            {isUpdate ? "Update" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
