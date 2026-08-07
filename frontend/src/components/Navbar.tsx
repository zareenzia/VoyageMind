import { AuthPanel } from "./AuthPanel.tsx";
import { MyTripsPanel } from "./MyTripsPanel.tsx";

interface Props {
  onHome: () => void;
  onSelectTrip: (id: string) => void;
}

export function Navbar({ onHome, onSelectTrip }: Props) {
  return (
    <nav className="sticky top-0 z-50 border-b border-sand-dark/80 bg-sand/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <button onClick={onHome} className="flex items-center gap-3 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-terracotta text-white transition-transform group-hover:scale-105">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <span className="font-heading text-xl text-charcoal tracking-tight">VoyageMind</span>
            <span className="ml-2 hidden text-[10px] font-medium uppercase tracking-widest text-clay sm:inline">AI Travel</span>
          </div>
        </button>

        <div className="flex items-center gap-1">
          <MyTripsPanel onSelectTrip={onSelectTrip} />
          <AuthPanel />
        </div>
      </div>
    </nav>
  );
}
