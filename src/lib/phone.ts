/**
 * Normaliza números móviles argentinos a dígitos comparables.
 * Caso frecuente: 54 + 11 (AMBA) sin 9 móvil (5411…) vs 54 + 9 + 11 (54911…)
 */
export function soloDigitos(telefono: string): string {
  return telefono.replace(/\D/g, '')
}

export function normalizarTelefonoArg(telefono: string): string {
  const d = soloDigitos(telefono)
  if (!d) return d
  if (d.startsWith('54') && !d.startsWith('549')) {
    const after54 = d.slice(2)
    if (after54.startsWith('11') && after54.length >= 10) {
      return '549' + after54
    }
  }
  return d
}

/** Variantes a buscar en DB cuando el almacenamiento pudo quedar con/sin 9. */
export function variantesTelefonoMismaLinea(telefono: string): string[] {
  const d = soloDigitos(telefono)
  const n = normalizarTelefonoArg(telefono)
  const out = new Set<string>([d, n].filter(Boolean))
  if (n.startsWith('549')) {
    const sin9Movil = '54' + n.slice(2).replace(/^9/, '')
    if (sin9Movil !== n) out.add(sin9Movil)
  }
  return Array.from(out)
}

export function claveUnicaPaisLinea(telefono: string): string {
  return normalizarTelefonoArg(telefono)
}
