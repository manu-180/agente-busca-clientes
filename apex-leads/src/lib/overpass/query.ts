import { geocodeZona } from "./nominatim";
import { rubroToOsmTags, OsmTagFilter } from "./rubro-tags";

export interface OsmBusiness {
  nombre: string;
  direccion: string;
  telefono: string;
  tiene_web: boolean;
  url_web: string | null;
  google_maps_url: string;
  rating: number;
  cantidad_reviews: number;
  rubro: string;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const PHONE_KEYS = ["phone", "contact:phone", "mobile", "contact:mobile"];
const WEBSITE_KEYS = ["website", "contact:website", "url", "contact:url"];

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function pickPhone(tags: Record<string, string>): string {
  for (const key of PHONE_KEYS) {
    const v = tags[key];
    if (v && v.trim()) return normalizePhone(v.split(";")[0]);
  }
  return "";
}

function pickWebsite(tags: Record<string, string>): string | null {
  for (const key of WEBSITE_KEYS) {
    const v = tags[key];
    if (v && v.trim()) return v.split(";")[0].trim();
  }
  return null;
}

function buildTagFilterString(filter: OsmTagFilter): string {
  // Para name usamos regex case-insensitive; para el resto, igualdad estricta.
  return filter
    .map(([k, v]) => {
      if (k === "name") {
        const safe = v.replace(/[\\"]/g, " ");
        return `["name"~"${safe}",i]`;
      }
      return `["${k}"="${v}"]`;
    })
    .join("");
}

function buildQuery(filters: OsmTagFilter[], bbox: { south: number; west: number; north: number; east: number }): string {
  const bboxStr = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  const parts: string[] = [];
  for (const filter of filters) {
    const tags = buildTagFilterString(filter);
    parts.push(`  node${tags}${bboxStr};`);
    parts.push(`  way${tags}${bboxStr};`);
  }
  return `[out:json][timeout:20];\n(\n${parts.join("\n")}\n);\nout center 200;`;
}

async function fetchOverpass(query: string, signal?: AbortSignal): Promise<{ elements: Array<{
  type: string;
  id: number;
  tags?: Record<string, string>;
}> }> {
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
        signal,
      });

      if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
        lastError = new Error(`Overpass ${endpoint} HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(`Overpass ${endpoint} HTTP ${res.status}`);
        continue;
      }

      const text = await res.text();
      if (text.includes("runtime error") || text.includes("Dispatcher_Client")) {
        lastError = new Error(`Overpass ${endpoint} runtime error`);
        continue;
      }

      try {
        return JSON.parse(text);
      } catch {
        lastError = new Error(`Overpass ${endpoint} respuesta no-JSON`);
        continue;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }

  throw lastError ?? new Error("Overpass: todos los endpoints fallaron");
}

export async function searchBusinesses(
  rubro: string,
  zona: string,
  signal?: AbortSignal
): Promise<OsmBusiness[]> {
  const bbox = await geocodeZona(zona, signal);
  const filters = rubroToOsmTags(rubro);
  const query = buildQuery(filters, bbox);

  const data = await fetchOverpass(query, signal);

  const elements: OsmBusiness[] = [];
  const vistos = new Set<string>();

  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const telefono = pickPhone(tags);
    if (!telefono || telefono.length < 6) continue;
    if (vistos.has(telefono)) continue;

    const url_web = pickWebsite(tags);
    if (url_web) continue; // queremos solo negocios SIN web

    vistos.add(telefono);

    const nombre = tags.name ?? tags["operator"] ?? "";
    if (!nombre) continue;

    const street = tags["addr:street"] ?? "";
    const number = tags["addr:housenumber"] ?? "";
    const direccion = [street, number].filter(Boolean).join(" ");
    const osmUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;

    elements.push({
      nombre,
      direccion,
      telefono,
      tiene_web: false,
      url_web: null,
      google_maps_url: osmUrl,
      rating: 0,
      cantidad_reviews: 0,
      rubro,
    });

    if (elements.length >= 30) break;
  }

  return elements;
}
