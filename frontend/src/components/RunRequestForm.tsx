import { useState } from "react";

interface Props {
  onSubmit: (request: string) => void;
}

export function RunRequestForm({ onSubmit }: Props) {
  const [request, setRequest] = useState("");
  const [focused, setFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = request.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className={`rounded-2xl border bg-white p-1.5 transition-all duration-300 ${
        focused
          ? "border-terracotta/40 shadow-xl shadow-terracotta/10"
          : "border-sand-dark shadow-lg shadow-charcoal/5"
      }`}>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="4 days in Meghalaya, BDT 45,000, solo traveller interested in waterfalls and caves…"
          rows={4}
          className="w-full resize-none rounded-xl border-0 bg-transparent px-5 py-4 text-base text-charcoal placeholder:text-clay-light/80 focus:outline-none"
          autoFocus
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-2">
            <Hint icon={<LocationIcon />} text="Where" />
            <Hint icon={<CalendarIcon />} text="When" />
            <Hint icon={<WalletIcon />} text="Budget" />
          </div>
          <button
            type="submit"
            disabled={!request.trim()}
            className="group rounded-xl bg-terracotta px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-terracotta-dark hover:shadow-lg hover:shadow-terracotta/20 hover:-translate-y-0.5 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <span className="flex items-center gap-2">
              Plan trip
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </form>
  );
}

function Hint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="hidden items-center gap-1 rounded-md bg-sand/80 px-2 py-1 text-[11px] text-clay sm:flex">
      {icon}
      {text}
    </span>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 11S2 7.5 2 5a4 4 0 118 0c0 2.5-4 6-4 6z" />
      <circle cx="6" cy="5" r="1.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2.5" width="9" height="8" rx="1" />
      <path d="M1.5 5.5h9M4 1v2M8 1v2" strokeLinecap="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="10" height="7" rx="1.5" />
      <path d="M8.5 7a0.5 0.5 0 110-1 0.5 0.5 0 010 1z" fill="currentColor" />
      <path d="M3 3V2.5A1.5 1.5 0 014.5 1h3A1.5 1.5 0 019 2.5V3" />
    </svg>
  );
}

