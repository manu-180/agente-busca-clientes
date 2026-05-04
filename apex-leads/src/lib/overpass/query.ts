import { geocodeZona } from "./nominatim";
import { rubroToOsmTags } from "./rubro-tags";

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

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function searchBusinesses(
  rubro: string,
  zona: string
): Promise<OsmBusiness[]> {
  const { south, west, north, east } = await geocodeZona(zona);
  const tagFilters = rubroToOsmTags(rubro);

  const bboxStr = `(${south},${west},${north},${east})`;

  const lines: string[] = [];
  for (const tagFilter of tagFilters) {
    lines.push(`  node${tagFilter}["phone"]${bboxStr};`);
    lines.push(`  way${tagFilter}["phone"]${bboxStr};`);
    lines.push(`  relation${tagFilter}["phone"]${bboxStr};`);
  }

  const query = `[out:json][timeout:25];\n(\n${lines.join("\n")}\n);\nout center;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: query,
  });

  if (!res.ok) {
    throw new Error(`Overpass HTTP error: ${res.status}`);
  }

  const data = await res.json();
  const elements: OsmBusiness[] = [];

  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};

    if (!tags.phone) continue;
    if (tags.website) continue;

    const nombre = tags.name ?? "";
    const street = tags["addr:street"] ?? "";
    const number = tags["addr:housenumber"] ?? "";
    const direccion = [street, number].filter(Boolean).join(" ");
    const telefono = normalizePhone(tags.phone);
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
