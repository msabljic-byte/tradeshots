"use client";

import { X } from "lucide-react";

const SECTIONS = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["/"], description: "Focus search" },
      { keys: ["Esc"], description: "Close any open menu or overlay" },
      { keys: ["?"], description: "Show this help" },
    ],
  },
  {
    title: "Upload",
    shortcuts: [{ keys: ["⌘", "V"], description: "Paste a screenshot to upload" }],
  },
];

type ShortcutHelpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export function ShortcutHelpOverlay({ open, onClose }: ShortcutHelpOverlayProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(26, 24, 21, 0.4)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] p-8"
        style={{ width: 480, boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-medium text-[var(--text-primary)]">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
                {section.title}
              </div>
              <div className="space-y-2">
                {section.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-serif text-sm text-[var(--text-primary)]">
                      {s.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="font-mono text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] min-w-[24px] text-center"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
