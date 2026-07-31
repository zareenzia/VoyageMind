import type { RunState } from "../../hooks/useRun.ts";

type PipelineStage = "intake" | "guide" | "itinerary" | "critic";

const STAGES: { key: PipelineStage; label: string; icon: string }[] = [
  { key: "intake", label: "Intake", icon: "📋" },
  { key: "guide", label: "Guide", icon: "🔍" },
  { key: "itinerary", label: "Itinerary", icon: "🗺️" },
  { key: "critic", label: "Critic", icon: "✓" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onNewTrip: () => void;
  progress: RunState["progress"] | null;
}

export function Sidebar({ open, onClose, onNewTrip, progress }: Props) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-charcoal/20 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-14 bottom-0 left-0 z-40 w-56 border-r border-sand-dark bg-sand transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav className="flex h-full flex-col p-3">
          <button
            onClick={onNewTrip}
            className="mb-4 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-terracotta transition-colors hover:bg-terracotta/5"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            New trip
          </button>

          {progress && (
            <div className="space-y-0.5">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-clay">
                Pipeline
              </p>
              {STAGES.map((stage) => {
                const status = progress.stageStatuses[stage.key];
                const isActive = status === "started";
                const isDone = status === "completed";
                const isFailed = status === "failed";

                return (
                  <div
                    key={stage.key}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-terracotta/8 text-terracotta font-medium"
                        : isDone
                          ? "text-moss"
                          : isFailed
                            ? "text-red-600"
                            : "text-clay-light"
                    }`}
                  >
                    <span className="text-xs">{stage.icon}</span>
                    <span>{stage.label}</span>
                    {isActive && (
                      <span className="ml-auto h-1.5 w-1.5 animate-pulse-warm rounded-full bg-terracotta" />
                    )}
                    {isDone && (
                      <svg className="ml-auto h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 8.5L6.5 12L13 4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-auto border-t border-sand-dark pt-3">
            <p className="px-3 text-[10px] text-clay">
              Five agents · Real data · No fabrication
            </p>
          </div>
        </nav>
      </aside>
    </>
  );
}
