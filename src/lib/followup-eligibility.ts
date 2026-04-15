export type MensajeCron = {
  timestamp: string
  rol: 'agente' | 'cliente'
  es_followup?: boolean | null
}

const MS_48H = 48 * 60 * 60 * 1000

function parseTs(ts: string): number {
  return new Date(ts).getTime()
}

/**
 * Follow-up solo si pasaron ≥48h desde el instante de referencia (silencio del lead o tiempo desde el último follow-up).
 */
export function evaluarFollowup({
  mensajes,
  followupsEnviados,
  ahora = Date.now(),
}: {
  mensajes: MensajeCron[]
  followupsEnviados: number
  ahora?: number
}): { elegible: boolean; motivo: string; referenciaTs?: number } {
  if (followupsEnviados >= 2) {
    return { elegible: false, motivo: 'max_followups' }
  }

  const ordenados = [...mensajes].sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp))
  if (ordenados.length === 0) {
    return { elegible: false, motivo: 'sin_mensajes' }
  }

  const ultimo = ordenados[ordenados.length - 1]
  if (ultimo.rol === 'cliente') {
    return { elegible: false, motivo: 'ultimo_mensaje_es_cliente' }
  }

  const indicesCliente = ordenados
    .map((m, i) => (m.rol === 'cliente' ? i : -1))
    .filter(i => i >= 0)
  const hayCliente = indicesCliente.length > 0

  let referenciaTs: number

  if (followupsEnviados === 0) {
    if (!hayCliente) {
      const agentes = ordenados.filter(m => m.rol === 'agente')
      const primerAgente = agentes[0]
      if (!primerAgente) {
        return { elegible: false, motivo: 'sin_mensaje_agente' }
      }
      referenciaTs = parseTs(primerAgente.timestamp)
    } else {
      const ultimoCliente = ordenados.filter(m => m.rol === 'cliente').pop()!
      referenciaTs = parseTs(ultimoCliente.timestamp)
    }
  } else {
    const followups = ordenados.filter(m => m.es_followup === true)
    const ultimoFollowup = followups.pop()
    if (!ultimoFollowup) {
      return { elegible: false, motivo: 'sin_followup_previo_registrado' }
    }
    referenciaTs = parseTs(ultimoFollowup.timestamp)
  }

  if (ahora - referenciaTs < MS_48H) {
    return {
      elegible: false,
      motivo: 'menos_de_48h',
      referenciaTs,
    }
  }

  return { elegible: true, motivo: 'ok', referenciaTs }
}
