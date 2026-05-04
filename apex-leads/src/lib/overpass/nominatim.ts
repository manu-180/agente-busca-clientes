export async function geocodeZona(
  zona: string
): Promise<{ south: number; west: number; north: number; east: number }> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(zona)}&format=json&limit=1`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "apex-leads-bot/1.0 (manunv97@gmail.com)",
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim HTTP error: ${res.status}`);
  }

  const data = await res.json();

  if (!data || data.length === 0) {
    throw new Error(`No se encontró la zona: ${zona}`);
  }

  // boundingbox = [south, north, west, east]
  const [south, north, west, east] = data[0].boundingbox.map(Number);

  return { south, west, north, east };
}
