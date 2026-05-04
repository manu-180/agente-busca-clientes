export function rubroToOsmTags(rubro: string): string[] {
  const r = rubro.toLowerCase();

  if (["boutique", "ropa", "indumentaria"].some((k) => r.includes(k))) {
    return ['["shop"="clothes"]', '["shop"="fashion"]'];
  }
  if (["peluquería", "peluqueria", "cabello"].some((k) => r.includes(k))) {
    return ['["shop"="hairdresser"]'];
  }
  if (["restaurante", "restaurant", "comida"].some((k) => r.includes(k))) {
    return ['["amenity"="restaurant"]', '["amenity"="fast_food"]'];
  }
  if (["bar", "cafe", "cafetería", "cafeteria"].some((k) => r.includes(k))) {
    return ['["amenity"="bar"]', '["amenity"="cafe"]'];
  }
  if (["kiosco", "kiosko"].some((k) => r.includes(k))) {
    return ['["shop"="convenience"]'];
  }
  if (r.includes("farmacia")) {
    return ['["amenity"="pharmacy"]'];
  }
  if (["veterinaria", "veterinario"].some((k) => r.includes(k))) {
    return ['["amenity"="veterinary"]'];
  }
  if (["gimnasio", "gym"].some((k) => r.includes(k))) {
    return ['["leisure"="fitness_centre"]'];
  }
  if (["panadería", "panaderia", "panadero"].some((k) => r.includes(k))) {
    return ['["shop"="bakery"]'];
  }
  if (["librería", "libreria"].some((k) => r.includes(k))) {
    return ['["shop"="books"]'];
  }
  if (["ferretería", "ferreteria"].some((k) => r.includes(k))) {
    return ['["shop"="hardware"]'];
  }
  if (r.includes("supermercado")) {
    return ['["shop"="supermarket"]'];
  }
  if (["zapatería", "zapateria"].some((k) => r.includes(k))) {
    return ['["shop"="shoes"]'];
  }
  if (["joyería", "joyeria", "bijouterie"].some((k) => r.includes(k))) {
    return ['["shop"="jewelry"]'];
  }

  return [`["name"~"${rubro}",i]`];
}
