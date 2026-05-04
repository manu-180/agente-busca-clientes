export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const cache = new Map<string, BBox>();

const MIN_HALF_DEGREES = 0.02;

function expandIfTiny(bbox: BBox): BBox {
  const latSpan = bbox.north - bbox.south;
  const lonSpan = bbox.east - bbox.west;
  if (latSpan >= MIN_HALF_DEGREES * 2 && lonSpan >= MIN_HALF_DEGREES * 2) {
    return bbox;
  }
  const cLat = (bbox.north + bbox.south) / 2;
  const cLon = (bbox.east + bbox.west) / 2;
  const halfLat = Math.max(MIN_HALF_DEGREES, latSpan / 2);
  const halfLon = Math.max(MIN_HALF_DEGREES, lonSpan / 2);
  return {
    south: cLat - halfLat,
    north: cLat + halfLat,
    west: cLon - halfLon,
    east: cLon + halfLon,
  };
}

function pickBestResult(results: Array<{
  osm_type?: string;
  class?: string;
  type?: string;
  importance?: number;
  boundingbox?: string[];
}>): { boundingbox?: string[] } | null {
  if (!results.length) return null;
  const ranked = [...results].sort((a, b) => {
    const score = (r: typeof a) => {
      let s = 0;
      if (r.osm_type === "relation") s += 100;
      else if (r.osm_type === "way") s += 50;
      if (r.class === "boundary" || r.class === "place") s += 30;
      if (r.type === "administrative" || r.type === "suburb" || r.type === "neighbourhood" || r.type === "town" || r.type === "city" || r.type === "village") s += 20;
      s += (r.importance ?? 0) * 10;
      return s;
    };
    return score(b) - score(a);
  });
  return ranked[0] ?? null;
}

export async function geocodeZona(zona: string): Promise<BBox> {
  const key = zona.toLowerCase().trim();
  const hit = cache.get(key);
  if (hit) return hit;

  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(zona)}` +
    `&format=json&limit=5&addressdetails=0&accept-language=es`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "apex-leads-bot/1.0 (manunv97@gmail.com)",
      "Accept-Language": "es",
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No se encontró la zona: ${zona}`);
  }

  const best = pickBestResult(data);
  if (!best || !best.boundingbox) {
    throw new Error(`Sin boundingbox para zona: ${zona}`);
  }

  // Nominatim boundingbox: [south, north, west, east]
  const [south, north, west, east] = best.boundingbox.map(Number);
  const bbox = expandIfTiny({ south, north, west, east });
  cache.set(key, bbox);
  return bbox;
}
