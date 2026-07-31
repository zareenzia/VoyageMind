interface Props {
  onStartPlan: () => void;
}

export function HeroSection({ onStartPlan }: Props) {
  return (
    <section className="relative overflow-hidden py-16 sm:py-24">
      {/* Subtle background decoration — no blobs, just clean geometry */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-[0.04]">
        <svg viewBox="0 0 800 600" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
          <path d="M100,300 Q200,100 400,200 T700,300" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M50,400 Q250,200 500,350 T750,250" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <circle cx="650" cy="150" r="80" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <circle cx="150" cy="450" r="60" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </svg>
      </div>

      <div className="relative mx-auto max-w-3xl text-center">
        <div className="animate-fade-up">
          <span className="inline-block rounded-full border border-terracotta/20 bg-terracotta/5 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-terracotta">
            AI-powered trip planning
          </span>
        </div>

        <h1 className="animate-fade-up mt-8 font-heading text-4xl leading-tight text-charcoal sm:text-5xl lg:text-6xl" style={{ animationDelay: '100ms' }}>
          Your next adventure,{' '}
          <span className="italic text-terracotta">crafted by specialists</span>
        </h1>

        <p className="animate-fade-up mx-auto mt-6 max-w-xl text-lg leading-relaxed text-charcoal-light" style={{ animationDelay: '200ms' }}>
          Five AI agents research, plan, and critique your trip — validating every detail against real geographic data. No guesswork, no fabrication.
        </p>

        <div className="animate-fade-up mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center" style={{ animationDelay: '300ms' }}>
          <button
            onClick={onStartPlan}
            className="group relative rounded-xl bg-terracotta px-8 py-4 text-base font-semibold text-white transition-all hover:bg-terracotta-dark hover:shadow-xl hover:shadow-terracotta/20 hover:-translate-y-0.5"
          >
            <span className="flex items-center gap-2">
              Start planning
              <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          <span className="text-sm text-clay">No sign-up required to plan</span>
        </div>
      </div>

      {/* Pipeline preview */}
      <div className="animate-fade-up relative mx-auto mt-16 max-w-2xl" style={{ animationDelay: '400ms' }}>
        <div className="rounded-2xl border border-sand-dark bg-white/60 p-6 sm:p-8 backdrop-blur-md">
          <p className="mb-5 text-center text-xs font-medium uppercase tracking-widest text-clay">How it works</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 stagger-children">
            <PipelineStep
              icon={<ReadIcon />}
              title="Intake"
              description="Understands your request"
            />
            <PipelineStep
              icon={<SearchIcon />}
              title="Guide"
              description="Researches destinations"
            />
            <PipelineStep
              icon={<MapIcon />}
              title="Itinerary"
              description="Builds your day plan"
            />
            <PipelineStep
              icon={<CheckIcon />}
              title="Critic"
              description="Validates feasibility"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PipelineStep({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors hover:bg-sand/80">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sand text-clay">
        {icon}
      </div>
      <span className="text-sm font-semibold text-charcoal">{title}</span>
      <span className="text-xs text-clay leading-snug">{description}</span>
    </div>
  );
}

function ReadIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4h12M4 8h8M4 12h10M4 16h6" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l4 4" strokeLinecap="round" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5l5-2 4 2 5-2v12l-5 2-4-2-5 2V5z" />
      <path d="M8 3v12M12 5v12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M7 10l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
