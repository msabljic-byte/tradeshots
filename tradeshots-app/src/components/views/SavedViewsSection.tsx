"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { SavedView } from "./savedViewUtils";

type SavedViewsSectionProps = {
  savedViews: SavedView[];
  activeViewId: string | null;
  isModified: boolean;
  onApply: (view: SavedView) => void;
  onRename: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
  onUpdate: (view: SavedView) => void;
};

export function SavedViewsSection({
  savedViews,
  activeViewId,
  isModified,
  onApply,
  onRename,
  onDelete,
  onUpdate,
}: SavedViewsSectionProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [openMenuId]);

  if (savedViews.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      <div className="px-3 mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-muted)] flex items-center gap-1.5">
        <Bookmark className="h-2.5 w-2.5" strokeWidth={1.5} />
        Saved Views
      </div>
      <div className="space-y-0.5">
        {savedViews.map((view) => {
          const isActive = activeViewId === view.id;
          return (
            <div
              key={view.id}
              className={`group relative flex items-center justify-between px-3 py-1.5 mx-1 rounded-[var(--radius-md)] cursor-pointer transition-colors ${
                isActive ? "bg-[var(--accent-tint)]" : "hover:bg-[var(--bg-shadow)]"
              }`}
              onClick={() => onApply(view)}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={`font-serif text-sm truncate ${
                    isActive ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                  }`}
                >
                  {view.name}
                </span>
                {isActive && isModified && (
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--text-muted)] italic"
                    title="Filters have changed since this view was applied"
                  >
                    · modified
                  </span>
                )}
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === view.id ? null : view.id);
                  }}
                  aria-label="View options"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </button>
              </div>
              {openMenuId === view.id && (
                <div
                  ref={menuRef}
                  className="absolute right-2 top-full mt-1 z-50 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] py-1 min-w-[160px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isActive && isModified && (
                    <button
                      onClick={() => {
                        onUpdate(view);
                        setOpenMenuId(null);
                      }}
                      className="w-full text-left px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--accent)] hover:bg-[var(--accent-tint)]"
                    >
                      Save changes
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onRename(view);
                      setOpenMenuId(null);
                    }}
                    className="w-full text-left px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-primary)] hover:bg-[var(--bg-shadow)] flex items-center gap-2"
                  >
                    <Pencil className="h-2.5 w-2.5" /> Rename
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete view "${view.name}"?`)) {
                        onDelete(view);
                      }
                      setOpenMenuId(null);
                    }}
                    className="w-full text-left px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--danger)] hover:bg-[var(--danger-tint)] flex items-center gap-2"
                  >
                    <Trash2 className="h-2.5 w-2.5" /> Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
