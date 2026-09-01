'use client';

import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';

import { distanceLabel, rupees } from '@/lib/format';
import type { SearchResult } from '@/types/db';

import 'leaflet/dist/leaflet.css';

/**
 * Map of who has the part.
 *
 * Unrevealed shops are drawn as a dashed ~350 m circle around a jittered point,
 * not a pin: the buyer can see the part is "somewhere off Karve Road" without
 * being handed a competitor's doorstep. Once they reserve, the row is revealed
 * and the circle becomes a real marker at the real address.
 */

const originIcon = L.divIcon({
  className: '',
  html: `<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:9999px;
    background:var(--primary);color:var(--primary-foreground);font:600 10px/1 var(--font-sans),sans-serif;
    box-shadow:0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)">YOU</span>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function revealedIcon(label: string) {
  return L.divIcon({
    className: '',
    html: `<span style="display:grid;place-items:center;width:28px;height:28px;border-radius:9999px;
      background:var(--brand);color:var(--brand-foreground);font:700 11px/1 var(--font-sans),sans-serif;
      box-shadow:0 0 0 4px color-mix(in oklab, var(--brand) 25%, transparent)">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Keeps every result (and the searching shop) inside the viewport. */
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }, [map, points]);

  return null;
}

export function ResultsMap({
  origin,
  results,
}: {
  origin: { lat: number; lng: number; name: string };
  results: SearchResult[];
}) {
  const points = useMemo<Array<[number, number]>>(
    () => [[origin.lat, origin.lng], ...results.map((r): [number, number] => [r.lat, r.lng])],
    [origin.lat, origin.lng, results],
  );

  return (
    <MapContainer
      center={[origin.lat, origin.lng]}
      zoom={14}
      scrollWheelZoom={false}
      className="h-full w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds points={points} />

      <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
        <Tooltip direction="top" offset={[0, -14]}>
          {origin.name}
        </Tooltip>
      </Marker>

      {results.map((r) =>
        r.revealed ? (
          <Marker
            key={r.inventory_id}
            position={[r.lat, r.lng]}
            icon={revealedIcon(r.alias_label.replace('Shop ', ''))}
          >
            <Tooltip direction="top" offset={[0, -16]}>
              <span className="font-medium">{r.shop_name}</span>
              <br />
              {distanceLabel(r.distance_km)} · {rupees(r.price_paise)} · {r.quantity} in stock
            </Tooltip>
          </Marker>
        ) : (
          <Circle
            key={r.inventory_id}
            center={[r.lat, r.lng]}
            radius={350}
            pathOptions={{
              color: 'var(--brand)',
              weight: 1.5,
              dashArray: '4 4',
              fillColor: 'var(--brand)',
              fillOpacity: 0.12,
            }}
          >
            <Tooltip direction="top">
              <span className="font-medium">{r.alias_label}</span>
              <br />
              approx. {distanceLabel(r.distance_km)} away · {rupees(r.price_paise)}
              <br />
              <span className="text-muted-foreground">Reserve to see who this is</span>
            </Tooltip>
          </Circle>
        ),
      )}
    </MapContainer>
  );
}
