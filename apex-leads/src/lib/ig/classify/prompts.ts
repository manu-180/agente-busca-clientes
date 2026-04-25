import type { ProfileData } from '../sidecar'

export const NICHE_SYSTEM_PROMPT = `Sos un clasificador de cuentas de Instagram para un agente que vende sitios web a boutiques argentinas.

Devolvé EXACTAMENTE JSON: {"niche": "<categoria>", "confidence": <0.0-1.0>, "reason": "<máx 80 chars>"}

Categorías permitidas:
- moda_femenina         (ropa para mujer adulta)
- moda_masculina        (ropa para hombre adulto)
- indumentaria_infantil
- accesorios            (carteras, bijouterie no-fina, lentes, gorros)
- calzado
- belleza_estetica      (centros estéticos, productos beauty, peluquería)
- joyeria               (joyería fina, plata/oro)
- otro                  (comercio pero no es ninguno de los anteriores)
- descartar             (cuenta personal, política, spam, sin actividad comercial)

Confidence: qué tan seguro estás. <0.6 marca para revisión.

Si la bio menciona "envíos a todo el país" + ropa → confianza alta.
Si dice "showroom" + categoría textil → confianza alta.
Si es solo nombre + foto sin más datos → confianza <0.5.
NO inventes — si no hay datos, devolvé descartar con confianza alta.`

export function buildUserPrompt(p: ProfileData): string {
  return `Username: @${p.ig_username}
Nombre: ${p.full_name ?? '—'}
Categoría IG: ${p.business_category ?? '—'}
Bio:
"""
${(p.biography ?? '').slice(0, 500)}
"""
Followers: ${p.followers_count}  Posts: ${p.posts_count}
External URL: ${p.external_url ?? '—'}`
}
