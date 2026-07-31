import type { CritiqueResult } from "@shared/schemas/index.ts";

interface Props {
  critique: CritiqueResult;
  revisionsUsed: number;
}

export function CritiquePanel({ critique, revisionsUsed }: Props) {
  const hasContent = critique.hard_failures.length > 0 || critique.soft_notes.length > 0 || critique.suggested_fixes.length > 0;

  return (
    <div className="rounded-xl border border-sand-dark bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-heading text-lg text-charcoal">Quality Review</h3>
        <div className="flex items-center gap-2">
          {revisionsUsed > 0 && (
            <span className="text-[10px] text-clay">
              {revisionsUsed} revision{revisionsUsed > 1 ? "s" : ""}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            critique.verdict === "pass" ? "bg-moss/10 text-moss" :
            critique.verdict === "infeasible" ? "bg-terracotta/10 text-terracotta" :
            "bg-amber/10 text-amber"
          }`}>
            {critique.verdict}
          </span>
        </div>
      </div>

      {!hasContent && (
        <p className="text-sm text-clay">No issues found — plan passed all checks.</p>
      )}

      {critique.hard_failures.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-terracotta">
            Hard failures
          </p>
          <ul className="space-y-1.5">
            {critique.hard_failures.map((f, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-terracotta/5 px-3 py-2 text-sm text-charcoal-light">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-terracotta" />
                <span>
                  <span className="font-mono text-[10px] text-terracotta">[{f.code}]</span>{" "}
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {critique.soft_notes.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-clay">
            Notes
          </p>
          <ul className="space-y-1">
            {critique.soft_notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-charcoal-light">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-clay-light" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {critique.suggested_fixes.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-moss">
            Suggested improvements
          </p>
          <ul className="space-y-1">
            {critique.suggested_fixes.map((fix, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-charcoal-light">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-moss/50" />
                {fix}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
