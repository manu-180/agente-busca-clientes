import { normalizarTelefonoArg, soloDigitos, variantesTelefonoMismaLinea } from '@/lib/phone'

/**
 * Destinos que no deben recibir ningún outbound (Twilio, cola, manual, web UI).
 * Valores en dígitos canónicos AR (mismo criterio que el resto del sistema).
 */
const SEEDS_BLOQUEO: string[] = ['5491124842720']

let cacheBloqueados: Set<string> | null = null

function construirSetBloqueados(): Set<string> {
  const s = new Set<string>()
  for (const seed of SEEDS_BLOQUEO) {
    for (const v of variantesTelefonoMismaLinea(seed)) s.add(v)
  }
  const extra = process.env.BLOCKED_PHONE_DIGITS
  if (extra) {
    for (const part of extra.split(/[,\s]+/)) {
      const raw = soloDigitos(part)
      if (!raw) continue
      const n = normalizarTelefonoArg(raw) || raw
      for (const v of variantesTelefonoMismaLinea(n)) s.add(v)
    }
  }
  return s
}

function setBloqueados(): Set<string> {
  if (!cacheBloqueados) cacheBloqueados = construirSetBloqueados()
  return cacheBloqueados
}

/** true si este teléfono (cualquier formato) está en la lista dura de bloqueo. */
export function isTelefonoHardBlocked(telefono: string): boolean {
  const d = soloDigitos(telefono)
  if (!d) return false
  const blocked = setBloqueados()
  for (const v of variantesTelefonoMismaLinea(d)) {
    if (blocked.has(v)) return true
  }
  const n = normalizarTelefonoArg(d)
  return !!(n && blocked.has(n))
}
