import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Itinerary } from "@shared/schemas/index.ts";

const DAY_COLORS = [
  "#c45d3e", // terracotta
  "#4a7c59", // moss
  "#2d6a8a", // ocean
  "#c4863e", // amber
  "#8b7355", // clay
  "#6ba57a", // moss-light
  "#e8845f", // terracotta-light
  "#4a8fad", // ocean-light
];

interface Props {
  itinerary: Itinerary;
  highlightDay: number | null;
}

export function MapPanel({ itinerary, highlightDay }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Plot markers whenever itinerary changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    for (const m of markersRef.current) {
      m.remove();
    }
    markersRef.current = [];

    const allPoints: L.LatLngExpression[] = [];

    itinerary.days.forEach((day, dayIdx) => {
      const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
      const isHighlighted = highlightDay === null || highlightDay === dayIdx;

      day.stops.forEach((stop) => {
        const { lat, lng } = stop.activity.location;
        allPoints.push([lat, lng]);

        const marker = L.circleMarker([lat, lng], {
          radius: isHighlighted ? 7 : 4,
          color: color,
          fillColor: color,
          fillOpacity: isHighlighted ? 0.8 : 0.3,
          weight: isHighlighted ? 2 : 1,
          opacity: isHighlighted ? 1 : 0.4,
        }).addTo(map);

        marker.bindTooltip(
          `<strong>Day ${dayIdx + 1}</strong><br/>${stop.activity.name}`,
          { direction: "top", offset: [0, -8] }
        );

        markersRef.current.push(marker);
      });
    });

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    }
  }, [itinerary, highlightDay]);

  return (
    <div className="rounded-xl border border-sand-dark bg-white overflow-hidden">
      <div className="flex items-center justify-between border-b border-sand-dark px-4 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-clay">Map</h4>
        {highlightDay !== null && (
          <span className="text-[10px] text-clay">Day {highlightDay + 1}</span>
        )}
      </div>
      <div ref={containerRef} className="h-64 w-full xl:h-80" />
      <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-sand-dark">
        {itinerary.days.map((_, idx) => (
          <span key={idx} className="flex items-center gap-1 text-[10px] text-clay">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: DAY_COLORS[idx % DAY_COLORS.length] }}
            />
            Day {idx + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
