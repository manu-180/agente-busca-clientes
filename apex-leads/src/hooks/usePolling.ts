'use client'

import { useEffect, useRef } from 'react'

/**
 * Opciones de configuración del hook `usePolling`.
 */
export type UsePollingOptions = {
  /**
   * Si es `false`, el hook no ejecuta `fn` ni programa el interval.
   * Default: `true`.
   */
  enabled?: boolean
  /**
   * Si es `true`, ejecuta `fn` inmediatamente al mount (o al volverse elegible
   * tras un cambio en `enabled`). Default: `true`.
   */
  immediate?: boolean
  /**
   * Si es `true`, cuando la pestaña vuelve a ser visible ejecuta un tick
   * inmediato (refresca con datos frescos al volver). Default: `true`.
   */
  runOnVisible?: boolean
}

/**
 * Polea `fn` cada `intervalMs` milisegundos respetando `document.visibilityState`.
 *
 * - Cuando la pestaña pasa a `hidden`, el interval se pausa y NO se ejecuta `fn`.
 * - Cuando vuelve a `visible`, dispara un tick inmediato (si `runOnVisible !== false`)
 *   y reanuda el interval.
 * - En SSR (sin `document`) es un noop.
 * - La función puede ser sync o async. Si lanza, se swallow el error y se sigue
 *   polleando — el caller es responsable de su propio logging / manejo.
 *
 * @example
 * usePolling(fetchUnread, 60_000)
 * usePolling(pollQrState, 2_000, { enabled: !loadingQr })
 */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  options?: UsePollingOptions,
): void {
  const { enabled = true, immediate = true, runOnVisible = true } = options ?? {}

  // Guardamos siempre la versión más reciente de `fn` para evitar tener que
  // re-crear el interval cuando el caller no usa `useCallback`.
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    // SSR / entornos sin DOM: noop.
    if (typeof document === 'undefined') return
    if (!enabled) return

    let intervalId: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    const safeRun = async () => {
      if (cancelled) return
      try {
        await fnRef.current()
      } catch {
        // Swallow: cada caller maneja su error como prefiera (try/catch interno,
        // logger propio, etc.). No queremos interrumpir el ciclo del polling.
      }
    }

    const start = () => {
      if (intervalId !== null) return
      if (intervalMs > 0) {
        intervalId = setInterval(safeRun, intervalMs)
      }
    }

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    const isVisible = () => document.visibilityState === 'visible'

    const onVisibilityChange = () => {
      if (cancelled) return
      if (isVisible()) {
        if (runOnVisible) void safeRun()
        start()
      } else {
        stop()
      }
    }

    // Setup inicial
    if (isVisible()) {
      if (immediate) void safeRun()
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    // `pageshow` / `pagehide` cubren Safari mobile (bfcache), donde
    // `visibilitychange` puede no dispararse al restaurar desde back-forward cache.
    window.addEventListener('pageshow', onVisibilityChange)
    window.addEventListener('pagehide', onVisibilityChange)

    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onVisibilityChange)
      window.removeEventListener('pagehide', onVisibilityChange)
    }
  }, [enabled, immediate, intervalMs, runOnVisible])
}
