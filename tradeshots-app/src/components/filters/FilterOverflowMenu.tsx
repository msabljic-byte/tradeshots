type FilterOverflowMenuProps = {
  savedViewsCount: number;
  onSaveView: (name: string) => void;
  onClose: () => void;
};

export function FilterOverflowMenu({
  savedViewsCount,
  onSaveView,
  onClose,
}: FilterOverflowMenuProps) {
  return (
    <div className="ui-popover absolute right-0 top-10 z-30 min-w-[190px] p-1.5">
      <button
        type="button"
        onClick={() => {
          const suggested = `View ${savedViewsCount + 1}`;
          const name = prompt("Save view as", suggested);
          if (name && name.trim()) {
            onSaveView(name);
          }
          onClose();
        }}
        className="app-label-meta w-full rounded-md px-3 py-2 text-left text-muted hover:bg-surface-muted hover:text-foreground"
      >
        Save current view
      </button>
    </div>
  );
}
