import { normalizarTelefonoArg } from '@/lib/phone'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

export type VerificacionResult =
  | { valido: true; normalizado: string }
  | { valido: false; razon: string; normalizado?: string }

/**
 * Verifica si un número es apto para recibir WhatsApp antes de intentar enviar.
 * Validaciones gratuitas en orden:
 * 1. Normalización E.164 argentina — debe producir dígitos
 * 2. Prefijo móvil — debe arrancar con 549 (fijos no tienen WA)
 * 3. Longitud — 13 dígitos exactos (54 + 9 + área + número)
 * 4. Lista de bloqueo interna
 */
export function verificarNumeroWhatsApp(telefonoRaw: string): VerificacionResult {
  const normalizado = normalizarTelefonoArg(String(telefonoRaw ?? ''))

  if (!normalizado) {
    return { valido: false, razon: 'formato_invalido' }
  }

  if (!normalizado.startsWith('549')) {
    return { valido: false, razon: 'no_es_movil', normalizado }
  }

  if (normalizado.length !== 13) {
    return { valido: false, razon: 'longitud_invalida', normalizado }
  }

  if (isTelefonoHardBlocked(normalizado)) {
    return { valido: false, razon: 'telefono_bloqueado', normalizado }
  }

  return { valido: true, normalizado }
}
