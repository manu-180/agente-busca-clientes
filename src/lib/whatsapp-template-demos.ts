/**
 * Demo (subdominio) y rating para plantillas de WhatsApp (Twilio Content API).
 * Extensible: agregá reglas en orden (las primeras ganan).
 */

export const SITIO_PRINCIPAL_APEX = 'www.theapexweb.com'

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

type Rule = { id: string; test: (t: string) => boolean; host: string }

/**
 * Orden importa: p.ej. "ropa de hombre" debe evaluarse antes que reglas genéricas de "ropa".
 */
const RULES: Rule[] = [
  {
    id: 'ropa_hombre',
    test: (t) =>
      /\b(ropa de hombre|ropa hombre|moda hombre|tienda de hombre|indumentaria masculina)\b/.test(
        t
      ) ||
      (/\bhombre\b/.test(t) && /\b(ropa|moda|indumentaria|indumentaria|textil|boutique)\b/.test(t)) ||
      /\b(masculin|varonil)\b/.test(t),
    host: 'hombre.theapexweb.com',
  },
  {
    id: 'gimnasio',
    test: (t) =>
      /\b(gimnasio|gym|fitness|crossfit|musculacion|entrenamiento funcional|box de cross)\b/.test(
        t
      ),
    host: 'gym.theapexweb.com',
  },
  {
    id: 'moda_mujer',
    test: (t) =>
      /\b(ropa de mujer|moda mujer|tienda de mujer|tienda femenina|mujer)\b/.test(t) ||
      /\b(femenin|indumentaria femenina)\b/.test(t) ||
      (/\b(moda|ropa|indumentaria|textil|boutique)\b/.test(t) &&
        (/\b(mujer|femenin)\b/.test(t) || /\b(talle|remera|vestido|jean)\b/.test(t))),
    host: 'moda.theapexweb.com',
  },
]

/**
 * Subdominio para la variable {{3}} del template (sin https://, como en Twilio).
 * Si no matchea ningún rubro, se usa el sitio principal.
 */
export function resolveWhatsAppDemoHost(rubro: string, descripcion?: string | null): string {
  const text = fold(`${rubro} ${descripcion ?? ''}`.trim())
  if (!text) return SITIO_PRINCIPAL_APEX
  for (const r of RULES) {
    if (r.test(text)) return r.host
  }
  return SITIO_PRINCIPAL_APEX
}

/**
 * El lead guarda en `descripcion` el prefijo "Rating: X/5" (ver NuevoLeadClient).
 */
export function extraerRatingParaPlantilla(descripcion: string | null | undefined): string {
  if (!descripcion) return '5'
  const m = descripcion.match(/Rating:\s*([\d.]+)\s*\/5/i)
  if (!m) return '5'
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return '5'
  if (n <= 0) return '5'
  const rounded = Math.round(n * 10) / 10
  if (Number.isInteger(rounded)) return String(rounded)
  return rounded.toFixed(1)
}
