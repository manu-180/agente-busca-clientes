/**
 * Cache en memoria con TTL para datos casi-estáticos que el hot path del webhook
 * (cada mensaje de WhatsApp) lee una y otra vez: `projects`, `project_info`,
 * `configuracion`. Re-leer esa config en cada mensaje era un consumidor grande de
 * egress de Supabase sin ningún beneficio (cambia rara vez).
 *
 * Persistencia: a nivel de módulo. En Vercel/serverless el caché sobrevive entre
 * invocaciones "calientes" de la misma instancia; un cold start simplemente lo
 * re-puebla. El TTL acota la ventana de staleness (editar la knowledge base / un
 * flag de config tarda como mucho `ttlMs` en propagar).
 *
 * Notas:
 * - Sólo se cachean resultados exitosos; los errores nunca se guardan, así un
 *   fallo transitorio no queda "pegado".
 * - Devuelve la MISMA referencia en cada hit: los consumidores deben tratar el
 *   valor como inmutable (en este repo se usa sólo para leer, nunca para mutar).
 */
type Entry<V> = { value: V; expiresAt: number }

export interface TtlCache<V> {
  get(key: string): V | undefined
  set(key: string, value: V): void
  delete(key: string): void
  clear(): void
}

export function createTtlCache<V>(ttlMs: number): TtlCache<V> {
  const store = new Map<string, Entry<V>>()

  const get = (key: string): V | undefined => {
    const e = store.get(key)
    if (!e) return undefined
    if (Date.now() > e.expiresAt) {
      store.delete(key)
      return undefined
    }
    return e.value
  }

  const set = (key: string, value: V): void => {
    store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  return {
    get,
    set,
    delete: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  }
}
