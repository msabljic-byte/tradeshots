"use client";

import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import {
  Search,
  Bookmark,
  Image as ImageIcon,
  Pencil,
  MessageSquare,
  Mic,
  Star,
  Filter,
} from "lucide-react";
import type { SavedView } from "@/components/views/savedViewUtils";

type ScreenshotLite = {
  id: string;
  tags?: string[] | null;
  notes?: string | null;
  created_at?: string;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onGoToDashboard: () => void;
  onGoToMarketplace: () => void;
  onToggleQuickFilter: (key: "voice" | "annotations" | "notes" | "favorites") => void;
  onClearAllFilters: () => void;
  savedViews: SavedView[];
  onApplySavedView: (view: SavedView) => void;
  screenshots: ScreenshotLite[];
  attributesByScreenshot: Record<string, Array<{ key: string; value: string }>>;
  onOpenScreenshot: (id: string) => void;
};

export function CommandPalette({
  open,
  onClose,
  onGoToDashboard,
  onGoToMarketplace,
  onToggleQuickFilter,
  onClearAllFilters,
  savedViews,
  onApplySavedView,
  screenshots,
  attributesByScreenshot,
  onOpenScreenshot,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Ensure focus happens after the input mounts and paints.
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  const handle = (action: () => void) => {
    action();
    onClose();
  };

  // Match the existing palette's filter behavior - show top 20 matches
  // when there's a query, none when empty
  const q = search.trim().toLowerCase();
  const matchedScreenshots =
    q.length === 0
      ? []
      : screenshots
          .filter((s) => {
            const inNotes = String(s.notes ?? "")
              .toLowerCase()
              .includes(q);
            const inTags = (s.tags ?? []).some((t) =>
              String(t).toLowerCase().includes(q)
            );
            const attributePairs = attributesByScreenshot[s.id] ?? [];
            const inAttributes = attributePairs.some(
              (pair) =>
                pair.key.toLowerCase().includes(q) ||
                pair.value.toLowerCase().includes(q)
            );
            return inNotes || inTags || inAttributes;
          })
          .slice(0, 20);

  const buildPreview = (shot: ScreenshotLite): string => {
    // If the query matched an attribute, surface that attribute.
    if (q.length > 0) {
      const pairs = attributesByScreenshot[shot.id] ?? [];
      const matchedPair = pairs.find(
        (p) => p.key.toLowerCase().includes(q) || p.value.toLowerCase().includes(q)
      );
      if (matchedPair) {
        return `${matchedPair.key.toUpperCase()}: ${matchedPair.value}`;
      }
    }
    // Otherwise: tags, then notes, then fallback.
    if ((shot.tags ?? []).length > 0) {
      return (shot.tags as string[]).join(", ");
    }
    if ((shot.notes ?? "").trim().length > 0) {
      return (shot.notes as string).trim().slice(0, 60);
    }
    return "Open screenshot";
  };

  const buildSecondaryLine = (shot: ScreenshotLite): string => {
    const parts: string[] = [];

    // Date - always include if present.
    if (shot.created_at) {
      const date = new Date(shot.created_at);
      if (!Number.isNaN(date.getTime())) {
        parts.push(
          date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        );
      }
    }

    // If primary line is showing an attribute, add disambiguating context.
    if (q.length > 0) {
      const pairs = attributesByScreenshot[shot.id] ?? [];
      const matchedAttr = pairs.find(
        (p) => p.key.toLowerCase().includes(q) || p.value.toLowerCase().includes(q)
      );
      if (matchedAttr && (shot.tags ?? []).length > 0) {
        const tagsPart = (shot.tags as string[]).slice(0, 3).join(", ");
        parts.push(tagsPart);
      } else if (matchedAttr) {
        const otherPair = pairs.find(
          (p) => !(p.key === matchedAttr.key && p.value === matchedAttr.value)
        );
        if (otherPair) {
          parts.push(`${otherPair.key.toUpperCase()}: ${otherPair.value}`);
        } else if ((shot.notes ?? "").trim()) {
          parts.push((shot.notes as string).trim().slice(0, 40));
        }
      }
    }

    return parts.join("  ·  ");
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(26, 24, 21, 0.4)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Command
        loop
        label="Command palette"
        className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] overflow-hidden"
        style={{ width: 600, maxHeight: "60vh", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
          <Search className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
          <Command.Input
            ref={inputRef}
            value={search}
            onValueChange={setSearch}
            placeholder="Type a command, search, or jump to..."
            className="flex-1 bg-transparent outline-none text-sm font-serif text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] text-[var(--text-muted)]">
            Esc
          </kbd>
        </div>

        <Command.List className="overflow-y-auto" style={{ maxHeight: "calc(60vh - 56px)" }}>
          <Command.Empty className="px-4 py-8 text-center font-serif italic text-sm text-[var(--text-muted)]">
            No matches yet.
          </Command.Empty>

          <Command.Group heading="Filters" className="cmd-group">
            <Command.Item
              value="filter annotations toggle"
              onSelect={() => handle(() => onToggleQuickFilter("annotations"))}
              className="cmd-item"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Toggle annotations filter</span>
            </Command.Item>
            <Command.Item
              value="filter notes toggle"
              onSelect={() => handle(() => onToggleQuickFilter("notes"))}
              className="cmd-item"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Toggle notes filter</span>
            </Command.Item>
            <Command.Item
              value="filter voice memos toggle"
              onSelect={() => handle(() => onToggleQuickFilter("voice"))}
              className="cmd-item"
            >
              <Mic className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Toggle voice memos filter</span>
            </Command.Item>
            <Command.Item
              value="filter favorites toggle"
              onSelect={() => handle(() => onToggleQuickFilter("favorites"))}
              className="cmd-item"
            >
              <Star className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Toggle favorites filter</span>
            </Command.Item>
            <Command.Item
              value="filter clear all"
              onSelect={() => handle(onClearAllFilters)}
              className="cmd-item"
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Clear all filters</span>
            </Command.Item>
          </Command.Group>

          {savedViews.length > 0 && (
            <Command.Group heading="Saved views" className="cmd-group">
              {savedViews.map((view) => (
                <Command.Item
                  key={view.id}
                  value={`view ${view.name}`}
                  onSelect={() => handle(() => onApplySavedView(view))}
                  className="cmd-item"
                >
                  <Bookmark className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>{view.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Navigation" className="cmd-group">
            <Command.Item
              value="navigate dashboard go"
              onSelect={() => handle(onGoToDashboard)}
              className="cmd-item"
            >
              <span>Go to Dashboard</span>
            </Command.Item>
            <Command.Item
              value="navigate marketplace go"
              onSelect={() => handle(onGoToMarketplace)}
              className="cmd-item"
            >
              <span>Go to Marketplace</span>
            </Command.Item>
          </Command.Group>

          {matchedScreenshots.length > 0 && (
            <Command.Group heading="Screenshots" className="cmd-group">
              {matchedScreenshots.map((shot) => {
                const preview = buildPreview(shot);
                const secondary = buildSecondaryLine(shot);
                return (
                  <Command.Item
                    key={shot.id}
                    value={`screenshot ${shot.id} ${preview} ${secondary}`}
                    onSelect={() => handle(() => onOpenScreenshot(shot.id))}
                    className="cmd-item cmd-item-multiline"
                  >
                    <ImageIcon className="h-3.5 w-3.5 cmd-item-icon" strokeWidth={1.5} />
                    <div className="cmd-item-content">
                      <div className="cmd-item-primary">{preview}</div>
                      {secondary && <div className="cmd-item-secondary">{secondary}</div>}
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
