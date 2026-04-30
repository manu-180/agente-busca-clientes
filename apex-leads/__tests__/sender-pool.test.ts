// Unit tests para `lib/sender-pool.ts`.
//
// Estrategia de mock: cada función del pool hace una secuencia muy específica
// de calls sobre el cliente Supabase. En lugar de un mock genérico (frágil),
// cada describe block construye un mock chainable mínimo que devuelve los
// datos que la query SQL real devolvería para ese caso.

import {
  selectNextSender,
  incrementMsgsToday,
  resetDailyCountersIfNeeded,
  getCapacityStats,
  markDisconnected,
  markConnected,
  incrementSendFailures,
  resetSendFailures,
  updateHealthCheck,
  todayInArgentina,
} from '@/lib/sender-pool'
import type { SupabaseClient } from '@supabase/supabase-js'

// ───────────────────────────────────────────────────────────────────────────
// Helpers de mock
// ───────────────────────────────────────────────────────────────────────────

type SelectChain = {
  data: unknown
  error: unknown
}

/**
 * Mock para `selectNextSender`: la query es
 * `.from('senders').select(...).eq().eq().eq().order().order()`
 * y devuelve la lista al final.
 */
function makeSelectMock(rows: unknown[] | null, error: unknown = null): SupabaseClient {
  const chain: SelectChain & {
    select: jest.Mock
    eq: jest.Mock
    order: jest.Mock
    or: jest.Mock
    update: jest.Mock
    maybeSingle: jest.Mock
    then: undefined
  } = {
    data: rows,
    error,
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    or: jest.fn(() => chain),
    update: jest.fn(() => chain),
    maybeSingle: jest.fn(),
    then: undefined,
  }
  // El `await` sobre el builder debería devolver { data, error }. Lo
  // simulamos haciendo que el último `.order()` retorne un objeto thenable.
  // Para simplicidad, hacemos que el chain mismo sea thenable.
  ;(chain as unknown as { then: (cb: (v: SelectChain) => void) => void }).then = (cb) =>
    cb({ data: rows, error })
  return { from: jest.fn(() => chain) } as unknown as SupabaseClient
}

// ───────────────────────────────────────────────────────────────────────────
// todayInArgentina
// ───────────────────────────────────────────────────────────────────────────

describe('todayInArgentina', () => {
  it('devuelve YYYY-MM-DD', () => {
    const r = todayInArgentina()
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('cruza correctamente la frontera AR para una hora UTC dada', () => {
    // 2026-04-29 02:00 UTC = 2026-04-28 23:00 AR
    const utcDate = new Date('2026-04-29T02:00:00Z')
    expect(todayInArgentina(utcDate)).toBe('2026-04-28')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// selectNextSender
// ───────────────────────────────────────────────────────────────────────────

describe('selectNextSender', () => {
  const baseRow = {
    id: '00000000-0000-0000-0000-000000000001',
    alias: 'SIM 01',
    instance_name: 'wa-sim01',
    phone_number: '+5491111111111',
    daily_limit: 15,
    msgs_today: 0,
    last_sent_at: null,
    connected: true,
    activo: true,
  }

  it('devuelve null si no hay senders activos', async () => {
    const supa = makeSelectMock([])
    expect(await selectNextSender(supa)).toBeNull()
  })

  it('devuelve null si todos llegaron al daily_limit', async () => {
    const supa = makeSelectMock([
      { ...baseRow, id: 'a', msgs_today: 15, daily_limit: 15 },
      { ...baseRow, id: 'b', msgs_today: 20, daily_limit: 20 },
    ])
    expect(await selectNextSender(supa)).toBeNull()
  })

  it('elige el sender con menor msgs_today', async () => {
    const supa = makeSelectMock([
      { ...baseRow, id: 'a', msgs_today: 5, last_sent_at: '2026-04-29T10:00:00Z' },
      { ...baseRow, id: 'b', msgs_today: 2, last_sent_at: '2026-04-29T11:00:00Z' },
      { ...baseRow, id: 'c', msgs_today: 8, last_sent_at: '2026-04-29T12:00:00Z' },
    ])
    const r = await selectNextSender(supa)
    expect(r?.id).toBe('b')
  })

  it('en empate de msgs_today, elige el de last_sent_at más viejo', async () => {
    const supa = makeSelectMock([
      { ...baseRow, id: 'a', msgs_today: 3, last_sent_at: '2026-04-29T11:00:00Z' },
      { ...baseRow, id: 'b', msgs_today: 3, last_sent_at: '2026-04-29T09:00:00Z' },
      { ...baseRow, id: 'c', msgs_today: 3, last_sent_at: '2026-04-29T10:00:00Z' },
    ])
    const r = await selectNextSender(supa)
    expect(r?.id).toBe('b')
  })

  it('NULLS FIRST: si dos están sin last_sent_at, devuelve el primero del array', async () => {
    const supa = makeSelectMock([
      { ...baseRow, id: 'a', msgs_today: 0, last_sent_at: null },
      { ...baseRow, id: 'b', msgs_today: 0, last_sent_at: null },
      { ...baseRow, id: 'c', msgs_today: 0, last_sent_at: '2026-04-29T10:00:00Z' },
    ])
    const r = await selectNextSender(supa)
    expect(['a', 'b']).toContain(r?.id)
    // Y nunca elige al que tiene last_sent_at no nulo cuando hay nulls.
    expect(r?.id).not.toBe('c')
  })

  it('throwea si Supabase devuelve error', async () => {
    const supa = makeSelectMock(null, { message: 'boom' })
    await expect(selectNextSender(supa)).rejects.toThrow(/boom/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// incrementMsgsToday
// ───────────────────────────────────────────────────────────────────────────

describe('incrementMsgsToday', () => {
  /**
   * Mock que separa el read (`.maybeSingle()`) del UPDATE (chain con `.select()`).
   * - `readResult` es lo que devuelve `.maybeSingle()`.
   * - `updateResult` es lo que devuelve el chain del UPDATE al hacer `await`.
   */
  function makeIncrementMock(
    readResult: { data: unknown; error: unknown },
    updateResult?: { data: unknown; error: unknown }
  ): SupabaseClient {
    let mode: 'read' | 'update' = 'read'

    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      update: jest.fn(() => {
        mode = 'update'
        return chain
      }),
      eq: jest.fn(() => chain),
      maybeSingle: jest.fn(() => readResult),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb(mode === 'update' ? (updateResult ?? { data: [], error: null }) : readResult)

    return { from: jest.fn(() => chain) } as unknown as SupabaseClient
  }

  it('retorna true si el sender está disponible y el UPDATE afectó la fila', async () => {
    const supa = makeIncrementMock(
      { data: { msgs_today: 3, daily_limit: 15, activo: true, connected: true }, error: null },
      { data: [{ id: 'sender-1' }], error: null }
    )
    expect(await incrementMsgsToday(supa, 'sender-1')).toBe(true)
  })

  it('retorna false si el sender ya llegó al daily_limit', async () => {
    const supa = makeIncrementMock(
      { data: { msgs_today: 15, daily_limit: 15, activo: true, connected: true }, error: null }
    )
    expect(await incrementMsgsToday(supa, 'sender-1')).toBe(false)
  })

  it('retorna false si el sender no existe', async () => {
    const supa = makeIncrementMock({ data: null, error: null })
    expect(await incrementMsgsToday(supa, 'sender-1')).toBe(false)
  })

  it('retorna false si está disconnected (no incrementa)', async () => {
    const supa = makeIncrementMock(
      { data: { msgs_today: 3, daily_limit: 15, activo: true, connected: false }, error: null }
    )
    expect(await incrementMsgsToday(supa, 'sender-1')).toBe(false)
  })

  it('retorna false si está inactivo (no incrementa)', async () => {
    const supa = makeIncrementMock(
      { data: { msgs_today: 3, daily_limit: 15, activo: false, connected: true }, error: null }
    )
    expect(await incrementMsgsToday(supa, 'sender-1')).toBe(false)
  })

  it('retorna false si race: UPDATE devuelve 0 filas', async () => {
    const supa = makeIncrementMock(
      { data: { msgs_today: 3, daily_limit: 15, activo: true, connected: true }, error: null },
      { data: [], error: null }
    )
    expect(await incrementMsgsToday(supa, 'sender-1')).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// resetDailyCountersIfNeeded
// ───────────────────────────────────────────────────────────────────────────

describe('resetDailyCountersIfNeeded', () => {
  function makeUpdateMock(error: unknown = null) {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      or: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error })

    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient
    return { supa, chain }
  }

  it('llama UPDATE con or(last_reset_date.is.null, last_reset_date.lt.today_AR)', async () => {
    const { supa, chain } = makeUpdateMock()
    await resetDailyCountersIfNeeded(supa)
    const today = todayInArgentina()
    expect(chain.update).toHaveBeenCalledWith({ msgs_today: 0, last_reset_date: today })
    expect(chain.or).toHaveBeenCalledWith(
      `last_reset_date.is.null,last_reset_date.lt.${today}`
    )
  })

  it('throwea si Supabase devuelve error', async () => {
    const { supa } = makeUpdateMock({ message: 'db down' })
    await expect(resetDailyCountersIfNeeded(supa)).rejects.toThrow(/db down/)
  })

  it('no toca nada si todos ya tienen last_reset_date = hoy (UPDATE devuelve 0 rows pero no es error)', async () => {
    const { supa } = makeUpdateMock()
    await expect(resetDailyCountersIfNeeded(supa)).resolves.toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// getCapacityStats
// ───────────────────────────────────────────────────────────────────────────

describe('getCapacityStats', () => {
  it('suma correctamente totales y por sender', async () => {
    const supa = makeSelectMock([
      {
        id: 'a',
        alias: 'SIM 01',
        instance_name: 'wa-sim01',
        phone_number: '+5491111',
        color: '#84cc16',
        daily_limit: 15,
        msgs_today: 5,
        connected: true,
        activo: true,
      },
      {
        id: 'b',
        alias: 'SIM 02',
        instance_name: 'wa-sim02',
        phone_number: '+5492222',
        color: '#3b82f6',
        daily_limit: 20,
        msgs_today: 8,
        connected: true,
        activo: true,
      },
    ])
    const stats = await getCapacityStats(supa)
    expect(stats.total_today).toBe(35) // 15 + 20
    expect(stats.used_today).toBe(13) // 5 + 8
    expect(stats.remaining).toBe(22)
    expect(stats.active_connected).toBe(2)
    expect(stats.active_total).toBe(2)
    expect(stats.per_sender).toHaveLength(2)
    expect(stats.per_sender[0].remaining).toBe(10)
    expect(stats.per_sender[1].remaining).toBe(12)
  })

  it('excluye senders disconnected del total_today pero los incluye en active_total', async () => {
    const supa = makeSelectMock([
      {
        id: 'a',
        alias: 'A',
        instance_name: 'wa-a',
        phone_number: '+1',
        color: '#000',
        daily_limit: 15,
        msgs_today: 3,
        connected: true,
        activo: true,
      },
      {
        id: 'b',
        alias: 'B',
        instance_name: 'wa-b',
        phone_number: '+2',
        color: '#000',
        daily_limit: 20,
        msgs_today: 0,
        connected: false, // desconectado: no aporta a total_today
        activo: true,
      },
    ])
    const stats = await getCapacityStats(supa)
    expect(stats.total_today).toBe(15) // solo A
    expect(stats.used_today).toBe(3)
    expect(stats.active_connected).toBe(1)
    expect(stats.active_total).toBe(2) // ambos activos
  })

  it('lista vacía produce stats en cero', async () => {
    const supa = makeSelectMock([])
    const stats = await getCapacityStats(supa)
    expect(stats).toEqual({
      total_today: 0,
      used_today: 0,
      remaining: 0,
      active_connected: 0,
      active_total: 0,
      per_sender: [],
    })
  })

  it('remaining nunca es negativo aunque msgs_today supere daily_limit', async () => {
    const supa = makeSelectMock([
      {
        id: 'a',
        alias: 'A',
        instance_name: 'wa-a',
        phone_number: '+1',
        color: '#000',
        daily_limit: 15,
        msgs_today: 20, // anomalía
        connected: true,
        activo: true,
      },
    ])
    const stats = await getCapacityStats(supa)
    expect(stats.per_sender[0].remaining).toBe(0)
    expect(stats.remaining).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// markDisconnected
// ───────────────────────────────────────────────────────────────────────────

describe('markDisconnected', () => {
  it('llama UPDATE { connected:false, disconnection_reason, disconnected_at } WHERE id', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await markDisconnected(supa, 'sender-1', 'device_removed')
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(call.connected).toBe(false)
    expect(call.disconnection_reason).toBe('device_removed')
    expect(typeof call.disconnected_at).toBe('string')
    expect(chain.eq).toHaveBeenCalledWith('id', 'sender-1')
  })

  it('default reason="unknown" cuando no se pasa', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await markDisconnected(supa, 'sender-1')
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(call.disconnection_reason).toBe('unknown')
  })

  it('throwea si Supabase devuelve error', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: { message: 'boom' } })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await expect(markDisconnected(supa, 'sender-1', 'foo')).rejects.toThrow(/boom/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// markConnected
// ───────────────────────────────────────────────────────────────────────────

describe('markConnected', () => {
  it('setea connected=true, limpia disconnection_reason y resetea failures', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await markConnected(supa, 'sender-1')
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(call.connected).toBe(true)
    expect(call.disconnection_reason).toBeNull()
    expect(call.disconnected_at).toBeNull()
    expect(call.consecutive_send_failures).toBe(0)
    expect(typeof call.connected_at).toBe('string')
    expect(typeof call.health_checked_at).toBe('string')
  })

  it('actualiza phone_number si se pasa', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await markConnected(supa, 'sender-1', { phoneNumber: '+5491111' })
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(call.phone_number).toBe('+5491111')
  })

  it('NO actualiza phone_number si phoneNumber=null', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await markConnected(supa, 'sender-1', { phoneNumber: null })
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect('phone_number' in call).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// incrementSendFailures / resetSendFailures
// ───────────────────────────────────────────────────────────────────────────

describe('incrementSendFailures', () => {
  it('lee actual y suma 1, devolviendo el nuevo valor', async () => {
    let phase: 'read' | 'update' = 'read'
    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      update: jest.fn((_arg) => {
        phase = 'update'
        return chain
      }),
      eq: jest.fn(() => chain),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: { consecutive_send_failures: 2 }, error: null })
      ),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then = (cb) =>
      cb(phase === 'update' ? { data: null, error: null } : { data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    const next = await incrementSendFailures(supa, 'sender-1')
    expect(next).toBe(3)
    expect(chain.update).toHaveBeenCalledWith({ consecutive_send_failures: 3 })
  })

  it('si el sender no existe, devuelve 0', async () => {
    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
    }
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient
    const next = await incrementSendFailures(supa, 'sender-noexiste')
    expect(next).toBe(0)
  })

  it('arranca desde 0 si consecutive_send_failures es null', async () => {
    let phase: 'read' | 'update' = 'read'
    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      update: jest.fn(() => {
        phase = 'update'
        return chain
      }),
      eq: jest.fn(() => chain),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: { consecutive_send_failures: null }, error: null })
      ),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then = (cb) =>
      cb(phase === 'update' ? { data: null, error: null } : { data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient
    const next = await incrementSendFailures(supa, 'sender-1')
    expect(next).toBe(1)
  })
})

describe('resetSendFailures', () => {
  it('setea consecutive_send_failures=0', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await resetSendFailures(supa, 'sender-1')
    expect(chain.update).toHaveBeenCalledWith({ consecutive_send_failures: 0 })
    expect(chain.eq).toHaveBeenCalledWith('id', 'sender-1')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// updateHealthCheck
// ───────────────────────────────────────────────────────────────────────────

describe('updateHealthCheck', () => {
  it('connected=true: limpia disconnection_reason y resetea failures', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await updateHealthCheck(supa, 'sender-1', { connected: true })
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(call.connected).toBe(true)
    expect(call.disconnection_reason).toBeNull()
    expect(call.consecutive_send_failures).toBe(0)
    expect(typeof call.health_checked_at).toBe('string')
  })

  it('connected=false: setea disconnection_reason, NO toca consecutive_send_failures', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await updateHealthCheck(supa, 'sender-1', { connected: false, reason: 'health_check_close' })
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(call.connected).toBe(false)
    expect(call.disconnection_reason).toBe('health_check_close')
    expect('consecutive_send_failures' in call).toBe(false)
  })

  it('connected omitido: solo refresca health_checked_at', async () => {
    const chain: Record<string, unknown> = {
      update: jest.fn(() => chain),
      eq: jest.fn(() => chain),
    }
    ;(chain as { then: (cb: (v: { data: unknown; error: unknown }) => void) => void }).then =
      (cb) => cb({ data: null, error: null })
    const supa = { from: jest.fn(() => chain) } as unknown as SupabaseClient

    await updateHealthCheck(supa, 'sender-1', {})
    const call = (chain.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect('connected' in call).toBe(false)
    expect(typeof call.health_checked_at).toBe('string')
  })
})
