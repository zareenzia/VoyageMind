import { useState } from "react";

interface Props {
  onNewTrip: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export function WorkspaceHeader({ onNewTrip, onToggleSidebar, sidebarOpen }: Props) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-sand-dark/80 bg-sand/95 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-charcoal-light hover:bg-sand-dark hover:text-charcoal transition-colors lg:hidden"
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            {sidebarOpen ? (
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            ) : (
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-terracotta text-white">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10l1.5-1.5m0 0L10 3l5.5 5.5M4.5 8.5v8a.5.5 0 00.5.5h2.5m8.5-8.5L17 10m-1.5-1.5v8a.5.5 0 01-.5.5H12.5m-5 0a.5.5 0 00.5-.5v-3a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v3a.5.5 0 00.5.5m-4 0h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-heading text-lg text-charcoal tracking-tight">VoyageMind</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onNewTrip}
          className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-terracotta-dark hover:shadow-md hover:shadow-terracotta/15"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">New trip</span>
        </button>
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-charcoal-light hover:bg-sand-dark hover:text-charcoal transition-colors"
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? (
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="10" cy="10" r="4" />
              <path d="M10 2v1M10 17v1M18 10h-1M3 10H2M15.5 4.5l-.7.7M5.2 14.8l-.7.7M15.5 15.5l-.7-.7M5.2 5.2l-.7-.7" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 12.5A7 7 0 117.5 3a5.5 5.5 0 009.5 9.5z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
