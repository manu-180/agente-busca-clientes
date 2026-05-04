/**
 * Cada filtro es un arreglo de pares clave/valor que se combinan con AND.
 * Por ejemplo `[["amenity","restaurant"],["cuisine","pizza"]]` produce
 * `["amenity"="restaurant"]["cuisine"~"pizza"]` en la query Overpass.
 */
export type OsmTagFilter = Array<[string, string]>;

function tag(...pairs: Array<[string, string]>): OsmTagFilter {
  return pairs;
}

export function rubroToOsmTags(rubro: string): OsmTagFilter[] {
  const r = rubro.toLowerCase();

  if (["pizzería", "pizzeria", "pizza"].some((k) => r.includes(k))) {
    return [
      tag(["amenity", "restaurant"], ["cuisine", "pizza"]),
      tag(["amenity", "fast_food"], ["cuisine", "pizza"]),
    ];
  }
  if (["heladería", "heladeria", "helado"].some((k) => r.includes(k))) {
    return [tag(["amenity", "ice_cream"]), tag(["shop", "ice_cream"])];
  }
  if (["parrilla", "asador", "asado"].some((k) => r.includes(k))) {
    return [
      tag(["amenity", "restaurant"], ["cuisine", "argentinian"]),
      tag(["amenity", "restaurant"], ["cuisine", "barbecue"]),
      tag(["amenity", "restaurant"], ["cuisine", "steak_house"]),
    ];
  }
  if (["sushi", "japonés", "japones"].some((k) => r.includes(k))) {
    return [
      tag(["amenity", "restaurant"], ["cuisine", "sushi"]),
      tag(["amenity", "restaurant"], ["cuisine", "japanese"]),
    ];
  }
  if (["hamburguesa", "burger"].some((k) => r.includes(k))) {
    return [
      tag(["amenity", "fast_food"], ["cuisine", "burger"]),
      tag(["amenity", "restaurant"], ["cuisine", "burger"]),
    ];
  }
  if (["empanada", "empanadas"].some((k) => r.includes(k))) {
    return [tag(["amenity", "fast_food"], ["cuisine", "empanada"])];
  }
  if (["rotisería", "rotiseria", "rotisero"].some((k) => r.includes(k))) {
    return [tag(["shop", "deli"]), tag(["amenity", "fast_food"])];
  }
  if (["boutique", "ropa", "indumentaria", "moda"].some((k) => r.includes(k))) {
    return [tag(["shop", "clothes"]), tag(["shop", "fashion"]), tag(["shop", "boutique"])];
  }
  if (["peluquería", "peluqueria", "cabello", "barbería", "barberia", "barber"].some((k) => r.includes(k))) {
    return [tag(["shop", "hairdresser"])];
  }
  if (["restaurante", "restaurant", "comida"].some((k) => r.includes(k))) {
    return [tag(["amenity", "restaurant"]), tag(["amenity", "fast_food"])];
  }
  if (["bar", "boliche", "pub"].some((k) => r.includes(k))) {
    return [tag(["amenity", "bar"]), tag(["amenity", "pub"])];
  }
  if (["cafe", "café", "cafetería", "cafeteria"].some((k) => r.includes(k))) {
    return [tag(["amenity", "cafe"])];
  }
  if (["kiosco", "kiosko", "maxikiosco"].some((k) => r.includes(k))) {
    return [tag(["shop", "convenience"]), tag(["shop", "kiosk"])];
  }
  if (r.includes("farmacia")) {
    return [tag(["amenity", "pharmacy"])];
  }
  if (["veterinaria", "veterinario"].some((k) => r.includes(k))) {
    return [tag(["amenity", "veterinary"])];
  }
  if (["gimnasio", "gym"].some((k) => r.includes(k))) {
    return [tag(["leisure", "fitness_centre"]), tag(["sport", "fitness"])];
  }
  if (["panadería", "panaderia", "panadero"].some((k) => r.includes(k))) {
    return [tag(["shop", "bakery"])];
  }
  if (["librería", "libreria"].some((k) => r.includes(k))) {
    return [tag(["shop", "books"]), tag(["shop", "stationery"])];
  }
  if (["ferretería", "ferreteria"].some((k) => r.includes(k))) {
    return [tag(["shop", "hardware"]), tag(["shop", "doityourself"])];
  }
  if (["supermercado", "supermarket", "almacén", "almacen"].some((k) => r.includes(k))) {
    return [tag(["shop", "supermarket"]), tag(["shop", "convenience"])];
  }
  if (["zapatería", "zapateria", "zapatos", "calzado"].some((k) => r.includes(k))) {
    return [tag(["shop", "shoes"])];
  }
  if (["joyería", "joyeria", "bijouterie", "bijou", "joya"].some((k) => r.includes(k))) {
    return [tag(["shop", "jewelry"])];
  }
  if (["lavadero", "lavandería", "lavanderia"].some((k) => r.includes(k))) {
    return [tag(["shop", "laundry"]), tag(["shop", "dry_cleaning"])];
  }
  if (["dentista", "odontología", "odontologia", "odontólogo", "odontologo"].some((k) => r.includes(k))) {
    return [tag(["amenity", "dentist"]), tag(["healthcare", "dentist"])];
  }
  if (["óptica", "optica"].some((k) => r.includes(k))) {
    return [tag(["shop", "optician"])];
  }
  if (["florería", "floreria", "florista"].some((k) => r.includes(k))) {
    return [tag(["shop", "florist"])];
  }
  if (["carnicería", "carniceria"].some((k) => r.includes(k))) {
    return [tag(["shop", "butcher"])];
  }
  if (["verdulería", "verduleria", "frutería", "fruteria"].some((k) => r.includes(k))) {
    return [tag(["shop", "greengrocer"])];
  }
  if (["hotel", "hostal", "hostel", "alojamiento"].some((k) => r.includes(k))) {
    return [tag(["tourism", "hotel"]), tag(["tourism", "hostel"]), tag(["tourism", "guest_house"])];
  }

  // Fallback: buscar por nombre (lento, último recurso).
  return [tag(["name", rubro])];
}
