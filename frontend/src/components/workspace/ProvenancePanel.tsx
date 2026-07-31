import type { Itinerary } from "@shared/schemas/index.ts";

interface Props {
  itinerary: Itinerary;
}

interface EstimatedItem {
  name: string;
  fields: string[];
}

export function ProvenancePanel({ itinerary }: Props) {
  let totalValues = 0;
  let estimatedCount = 0;
  const estimatedItems: EstimatedItem[] = [];
  let transitRouted = 0;
  let transitHeuristic = 0;
  let transitUnknown = 0;

  for (const day of itinerary.days) {
    for (const stop of day.stops) {
      const est = stop.activity.estimated;
      // Each activity contributes 3 estimatable values: duration, cost, hours
      totalValues += 3;
      const fields: string[] = [];
      if (est.duration) { estimatedCount++; fields.push("duration"); }
      if (est.cost) { estimatedCount++; fields.push("cost"); }
      if (est.hours) { estimatedCount++; fields.push("hours"); }
      if (fields.length > 0) {
        estimatedItems.push({ name: stop.activity.name, fields });
      }

      // Transit source
      if (stop.transit_minutes_from_previous > 0) {
        if (stop.transit_source === "routed") transitRouted++;
        else if (stop.transit_source === "heuristic") transitHeuristic++;
        else transitUnknown++;
      }
    }
  }

  const sourcedCount = totalValues - estimatedCount;
  const totalTransit = transitRouted + transitHeuristic + transitUnknown;

  return (
    <div className="rounded-xl border border-sand-dark bg-white p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-clay">
        Data Provenance
      </h4>

      {/* Sourced vs estimated bar */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-moss font-medium">{sourcedCount} sourced</span>
          <span className="text-amber font-medium">{estimatedCount} estimated</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-sand-dark">
          <div
            className="h-full rounded-full bg-moss transition-all"
            style={{ width: totalValues > 0 ? `${(sourcedCount / totalValues) * 100}%` : "0%" }}
          />
        </div>
        <p className="mt-1 text-[10px] text-clay">
          {totalValues} data points across {itinerary.days.reduce((s, d) => s + d.stops.length, 0)} activities
        </p>
      </div>

      {/* Transit sources */}
      {totalTransit > 0 && (
        <div className="mb-3 border-t border-sand-dark pt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-clay">
            Transit legs
          </p>
          <div className="space-y-1">
            {transitRouted > 0 && (
              <TransitRow label="Routed" count={transitRouted} total={totalTransit} color="bg-moss" style="solid" />
            )}
            {transitHeuristic > 0 && (
              <TransitRow label="Heuristic ~" count={transitHeuristic} total={totalTransit} color="bg-amber" style="dashed" />
            )}
            {transitUnknown > 0 && (
              <TransitRow label="Unknown" count={transitUnknown} total={totalTransit} color="bg-clay-light" style="dotted" />
            )}
          </div>
        </div>
      )}

      {/* Estimated items list */}
      {estimatedItems.length > 0 && (
        <div className="border-t border-sand-dark pt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-clay">
            Estimated values
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {estimatedItems.map((item, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="text-charcoal-light truncate">{item.name}</span>
                <span className="shrink-0 text-amber">
                  ~{item.fields.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Completeness */}
      <div className="mt-3 border-t border-sand-dark pt-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${itinerary.estimated_total_complete ? "bg-moss" : "bg-amber"}`} />
          <span className="text-[11px] text-charcoal-light">
            {itinerary.estimated_total_complete
              ? "Total cost is complete"
              : "Total cost is partial — some items not priced"}
          </span>
        </div>
      </div>
    </div>
  );
}

function TransitRow({ label, count, total, color, style }: {
  label: string; count: number; total: number; color: string; style: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-0.5 w-4 ${color} ${style === "dashed" ? "border-t border-dashed border-amber" : style === "dotted" ? "border-t border-dotted border-clay-light" : ""}`}
        style={style === "solid" ? { height: "2px" } : {}}
      />
      <span className="text-[11px] text-charcoal-light">{label}</span>
      <span className="ml-auto text-[11px] font-mono text-clay">{count}/{total}</span>
    </div>
  );
}
