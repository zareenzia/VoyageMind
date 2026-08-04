import type { ReactNode } from "react";
import type { WriterOutput } from "@shared/schemas/index.ts";

/**
 * The Writer agent's prose, and the one place the app tells a reader plainly not
 * to trust the clock times.
 *
 * `caveats` sits ABOVE the day narrative on purpose. The prose hedges every
 * estimated value ("opens around 9", never "opens at 09:00"), but hedged wording
 * only reads as honesty if you already know why it's hedged — so the reason comes
 * first, before the reader has taken any timing as a commitment. Burying it under
 * the plan would leave the hedging looking like vagueness.
 */

interface Props {
  /** null is a real state, not an error — see the empty branches below. */
  writerOutput: WriterOutput | null;
  /** Writer only runs on a `pass` (runWriterStage), so an infeasible plan has no
   * prose by design rather than by failure, and says so differently. */
  verdictWasPass: boolean;
}

/**
 * Renders only the two markdown constructs the Writer prompt actually promises:
 * **bold** on first mention of a place, and > blockquotes for inline tips.
 * Deliberately not a markdown dependency — for two constructs the prompt limits
 * itself to, the dependency costs more than it returns. Anything else falls
 * through as literal text: visibly wrong rather than silently mangled.
 */
function InlineMarkdown({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-charcoal">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

function ProseBody({ text }: { text: string }): ReactNode {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) =>
        block.trimStart().startsWith(">") ? (
          <blockquote
            key={i}
            className="border-l-2 border-moss/40 bg-moss/5 py-1.5 pl-3 text-sm italic text-charcoal-light"
          >
            <InlineMarkdown text={block.split("\n").map((l) => l.replace(/^\s*>\s?/, "")).join(" ")} />
          </blockquote>
        ) : (
          <p key={i} className="text-sm leading-relaxed text-charcoal-light">
            <InlineMarkdown text={block.replace(/\n/g, " ")} />
          </p>
        ),
      )}
    </div>
  );
}

export function PlanNarrative({ writerOutput, verdictWasPass }: Props) {
  if (!writerOutput) {
    return (
      <div className="rounded-xl border border-sand-dark bg-white p-5">
        <h3 className="mb-1.5 font-heading text-lg text-charcoal">Your Written Plan</h3>
        {verdictWasPass ? (
          // Two indistinguishable causes from here: a trip saved before prose was
          // stored, or a Writer step that failed and was swallowed so the
          // itinerary survived. Neither is worth guessing at in the UI.
          <p className="text-sm text-clay">
            No written plan was saved for this trip. The day-by-day itinerary below is complete —
            only the written version is missing.
          </p>
        ) : (
          <p className="text-sm text-clay">
            No written plan: this itinerary didn't pass its feasibility checks, so it wasn't written
            up as a plan. See the review below for what blocked it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sand-dark bg-white p-5">
        <h2 className="font-heading text-2xl leading-snug text-charcoal">{writerOutput.title}</h2>
        <div className="mt-3">
          <ProseBody text={writerOutput.summary} />
        </div>
      </div>

      {writerOutput.caveats.length > 0 && (
        <div className="rounded-xl border border-amber/40 bg-amber/5 p-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber/20 text-xs font-bold text-amber">
              !
            </span>
            <h3 className="font-heading text-base text-charcoal">Before you go</h3>
          </div>
          <ul className="space-y-1.5">
            {writerOutput.caveats.map((caveat, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-charcoal-light">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                <span>{caveat}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {writerOutput.sections.map((section, i) => (
        <div key={i} className="rounded-xl border border-sand-dark bg-white p-5">
          <h3 className="mb-2 font-heading text-lg text-charcoal">{section.heading}</h3>
          <ProseBody text={section.body} />
        </div>
      ))}

      {writerOutput.practical_tips.length > 0 && (
        <div className="rounded-xl border border-sand-dark bg-white p-5">
          <h3 className="mb-2.5 font-heading text-lg text-charcoal">Practical Tips</h3>
          <ul className="space-y-1.5">
            {writerOutput.practical_tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-charcoal-light">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-moss/50" />
                <span>
                  <InlineMarkdown text={tip} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
