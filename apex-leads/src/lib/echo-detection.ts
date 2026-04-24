/**
 * Detecta si el mensaje del cliente es mayormente texto copiado de una respuesta
 * previa del bot, y extrae solo el contenido nuevo que el cliente agregó al final.
 *
 * Caso real: el cliente copia una respuesta del bot, agrega su pregunta abajo,
 * y lo envía todo junto. Sin esto, el bot recibe su propio texto como input.
 */

function calcularSolapamiento(clienteLower: string, agenteLower: string): number {
  const wordsCliente = new Set(clienteLower.split(/\s+/).filter(w => w.length > 2))
  const wordsAgente = agenteLower.split(/\s+/).filter(w => w.length > 2)
  if (!wordsAgente.length) return 0
  const coincidencias = wordsAgente.filter(w => wordsCliente.has(w)).length
  return coincidencias / wordsAgente.length
}

export interface ResultadoEco {
  /** Contenido limpio a procesar. Vacío si el cliente no agregó nada nuevo. */
  texto: string
  /** true si se detectó que el mensaje contenía eco de una respuesta previa del bot */
  eraEco: boolean
}

/**
 * @param mensajeCliente  Texto combinado recibido del cliente en este turno
 * @param ultimosMensajesAgente  Array de los últimos mensajes enviados por el bot (más reciente primero)
 */
export function extraerContenidoNuevo(
  mensajeCliente: string,
  ultimosMensajesAgente: string[]
): ResultadoEco {
  const clienteLower = mensajeCliente.toLowerCase().trim()

  for (const msgAgente of ultimosMensajesAgente) {
    if (!msgAgente || msgAgente.length < 15) continue
    const agenteLower = msgAgente.toLowerCase().trim()

    // 1. Coincidencia literal: el texto del bot aparece textualmente en el mensaje del cliente
    const fingerprint = agenteLower.slice(0, Math.min(40, agenteLower.length))
    const idxInicio = clienteLower.indexOf(fingerprint)
    if (idxInicio !== -1) {
      const idxFin = idxInicio + msgAgente.length
      const sufijo = mensajeCliente.slice(idxFin).trim()
      return { texto: sufijo.length > 3 ? sufijo : '', eraEco: true }
    }

    // 2. Solapamiento de palabras clave ≥ 60%
    const solapamiento = calcularSolapamiento(clienteLower, agenteLower)
    if (solapamiento >= 0.6) {
      // Buscar las últimas 3 palabras del bot como ancla para extraer el sufijo
      const wordsAgente = agenteLower.split(/\s+/).filter(w => w.length > 2)
      if (wordsAgente.length >= 3) {
        const ancla = wordsAgente.slice(-3).join(' ')
        const idxAncla = clienteLower.indexOf(ancla)
        if (idxAncla !== -1) {
          const sufijo = mensajeCliente.slice(idxAncla + ancla.length).trim()
          return { texto: sufijo.length > 3 ? sufijo : '', eraEco: true }
        }
      }
      return { texto: '', eraEco: true }
    }
  }

  return { texto: mensajeCliente, eraEco: false }
}
