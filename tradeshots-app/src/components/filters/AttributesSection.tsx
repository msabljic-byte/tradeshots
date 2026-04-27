import { useMemo, useState } from "react";
import { Check, ChevronLeft } from "lucide-react";
import type { AttributeFilter } from "./types";
import { useRecentAttributes } from "./useRecentAttributes";

type AttributesSectionProps = {
  attributesByScreenshot: Record<string, Array<{ key: string; value: string }>>;
  filters: AttributeFilter[];
  onAddAttributeFilter: (pair: AttributeFilter) => void;
  onRemoveAttributeFilter: (index: number) => void;
};

export function AttributesSection({
  attributesByScreenshot,
  filters,
  onAddAttributeFilter,
  onRemoveAttributeFilter,
}: AttributesSectionProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { recent, recordKey } = useRecentAttributes();

  const keysWithValueCount = useMemo(() => {
    const keyToValues = new Map<string, Set<string>>();
    Object.values(attributesByScreenshot).forEach((pairs) => {
      pairs.forEach((p) => {
        if (!keyToValues.has(p.key)) keyToValues.set(p.key, new Set());
        keyToValues.get(p.key)?.add(p.value);
      });
    });
    return Array.from(keyToValues.entries())
      .map(([key, valueSet]) => ({ key, valueCount: valueSet.size }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [attributesByScreenshot]);

  const valuesForSelectedKey = useMemo(() => {
    if (!selectedKey) return [];
    const valueCounts = new Map<string, number>();
    Object.values(attributesByScreenshot).forEach((pairs) => {
      const matching = pairs.filter((p) => p.key === selectedKey);
      const distinctValues = new Set(matching.map((p) => p.value));
      distinctValues.forEach((v) => {
        valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
      });
    });
    return Array.from(valueCounts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }, [attributesByScreenshot, selectedKey]);

  const recentValid = useMemo(
    () => recent.filter((k) => keysWithValueCount.some((kv) => kv.key === k)),
    [recent, keysWithValueCount]
  );

  const isSelected = (key: string, value: string) =>
    filters.some((f) => f.key === key && f.value === value);

  const filterIndex = (key: string, value: string) =>
    filters.findIndex((f) => f.key === key && f.value === value);

  const toggleValue = (value: string) => {
    if (!selectedKey) return;
    const idx = filterIndex(selectedKey, value);
    if (idx >= 0) {
      onRemoveAttributeFilter(idx);
    } else {
      onAddAttributeFilter({ key: selectedKey, value });
    }
  };

  const header = selectedKey ? (
    <button
      onClick={() => setSelectedKey(null)}
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
    >
      <ChevronLeft className="h-3 w-3" strokeWidth={1.5} />
      {selectedKey}
    </button>
  ) : (
    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
      Attributes
    </span>
  );

  if (!selectedKey) {
    return (
      <div className="p-4">
        <div className="mb-3">{header}</div>
        {keysWithValueCount.length === 0 ? (
          <div className="font-serif text-sm italic text-[var(--text-muted)]">No attributes yet.</div>
        ) : (
          <>
            {recentValid.length > 0 && (
              <>
                <div className="mb-2 mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                  Recent
                </div>
                <div className="mb-4 flex flex-wrap gap-1.5 border-b border-[var(--border-subtle)] pb-4">
                  {recentValid.map((key) => {
                    const meta = keysWithValueCount.find((k) => k.key === key);
                    if (!meta) return null;
                    const activeCount = filters.filter((f) => f.key === key).length;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setSelectedKey(key);
                          recordKey(key);
                        }}
                        className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-shadow)]"
                      >
                        {key}
                        {activeCount > 0 && (
                          <span className="ml-1.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-[2px] bg-[var(--accent-tint)] px-1 text-[9px] font-medium text-[var(--accent)]">
                            {activeCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="space-y-1">
              {keysWithValueCount.map(({ key, valueCount }) => {
                const activeCount = filters.filter((f) => f.key === key).length;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setSelectedKey(key);
                      recordKey(key);
                    }}
                    className="w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-shadow)]"
                  >
                    <span className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-primary)]">
                        {key}
                        {activeCount > 0 && (
                          <span
                            className="ml-2 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-[2px] bg-[var(--accent-tint)] px-1 text-[9px] font-medium text-[var(--accent)]"
                            aria-label={`${activeCount} filter${activeCount > 1 ? "s" : ""} active for ${key}`}
                          >
                            {activeCount}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {valueCount} {valueCount === 1 ? "value" : "values"} ▸
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3">{header}</div>
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-muted)]">
        {valuesForSelectedKey.length} {valuesForSelectedKey.length === 1 ? "value" : "values"} in
        your vault
      </div>
      <div className="space-y-1">
        {valuesForSelectedKey.map(({ value, count }) => {
          const active = isSelected(selectedKey, value);
          return (
            <button
              key={value}
              onClick={() => toggleValue(value)}
              aria-pressed={active}
              className={`w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors ${
                active
                  ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                  : "text-[var(--text-primary)] hover:bg-[var(--bg-shadow)]"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)]"
                        : "border-[var(--border-strong)]"
                    }`}
                  >
                    {active && (
                      <Check className="h-2.5 w-2.5 text-[var(--accent-on)]" strokeWidth={3} />
                    )}
                  </span>
                  <span className="font-serif text-sm">{value}</span>
                </span>
                <span
                  className={`font-mono text-[10px] ${
                    active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  ({count})
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 font-mono text-[9px] uppercase tracking-[0.15em] italic text-[var(--text-muted)]">
        Click values to toggle. Multiple allowed.
      </div>
    </div>
  );
}
