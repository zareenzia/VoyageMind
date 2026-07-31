export function Footer() {
  return (
    <footer className="border-t border-sand-dark bg-sand py-8 mt-auto">
      <div className="mx-auto max-w-5xl px-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-terracotta/10">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-terracotta" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-sm font-medium text-charcoal-light">VoyageMind</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-clay">
            <span>Powered by five specialist AI agents</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">Real data, no fabrication</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
