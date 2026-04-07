/**
 * Placeholder card matching marketplace playbook card layout (h-40 cover + title bars).
 */
export default function SkeletonCard() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
      aria-hidden
    >
      <div className="relative h-40 w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-200 via-gray-100 to-gray-200 dark:from-gray-700 dark:via-gray-800 dark:to-gray-700" />
        <div className="absolute right-2 top-2 h-5 w-16 rounded-full bg-gray-300/90 dark:bg-gray-600 animate-pulse" />
        <div className="absolute bottom-2 left-3 right-3 space-y-2">
          <div className="h-3.5 w-[88%] max-w-full rounded-md bg-gray-300/95 dark:bg-gray-600 animate-pulse" />
          <div className="h-3 w-[55%] rounded-md bg-gray-300/80 dark:bg-gray-600 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
