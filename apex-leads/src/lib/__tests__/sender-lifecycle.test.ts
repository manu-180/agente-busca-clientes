import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BAN_REASONS,
  classifyDisconnection,
  warmingDailyLimit,
  isWarmupComplete,
  markBanned,
  promoteFromReserve,
  tickWarming,
} from '@/lib/sender-lifecycle'

// ── Helpers de fechas ─────────────────────────────────────────────────────────
// `start` fijo + helper para construir "ahora" a N días (irrelevante la zona).
const START = '2026-06-01T12:00:00.000Z'
function nowAfterDays(days: number, extraHours = 0): Date {
  return new Date(new Date(START).getTime() + days * 86_400_000 + extraHours * 3_600_000)
}

// ── classifyDisconnection ─────────────────────────────────────────────────────

describe('classifyDisconnection', () => {
  it('device_removed y code_403 son baneos terminales', () => {
    expect(classifyDisconnection('device_removed')).toBe('banned')
    expect(classifyDisconnection('code_403')).toBe('banned')
  })

  it('razones transitorias y desconocidas son temporary', () => {
    expect(classifyDisconnection('preflight_close')).toBe('temporary')
    expect(classifyDisconnection('timeout')).toBe('temporary')
    expect(classifyDisconnection('health_check_close')).toBe('temporary')
    expect(classifyDisconnection('connection_replaced')).toBe('temporary')
    expect(classifyDisconnection('cualquier_otra')).toBe('temporary')
  })

  it('null es temporary (no asumimos baneo sin evidencia)', () => {
    expect(classifyDisconnection(null)).toBe('temporary')
  })

  it('BAN_REASONS contiene exactamente los dos códigos de baneo', () => {
    expect(BAN_REASONS.has('device_removed')).toBe(true)
    expect(BAN_REASONS.has('code_403')).toBe(true)
    expect(BAN_REASONS.size).toBe(2)
  })
})

// ── warmingDailyLimit (ramp determinista) ─────────────────────────────────────

describe('warmingDailyLimit', () => {
  const TARGET = 30

  it('día 0 y 1 → 5', () => {
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(0))).toBe(5)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(0, 5))).toBe(5)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(1))).toBe(5)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(1, 23))).toBe(5)
  })

  it('día 2 y 3 → 10', () => {
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(2))).toBe(10)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(3))).toBe(10)
  })

  it('día 4, 5 y 6 → 15', () => {
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(4))).toBe(15)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(5))).toBe(15)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(6))).toBe(15)
  })

  it('día 7, 8 y 9 → 20', () => {
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(7))).toBe(20)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(8))).toBe(20)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(9))).toBe(20)
  })

  it('día 10 a 13 → 25', () => {
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(10))).toBe(25)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(13))).toBe(25)
  })

  it('día 14+ → target', () => {
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(14))).toBe(30)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(30))).toBe(30)
    expect(warmingDailyLimit(START, TARGET, nowAfterDays(365))).toBe(30)
  })

  it('capea a target cuando el target es bajo (nunca lo supera)', () => {
    // target=12: el ramp lo capea desde el tramo de 15 en adelante.
    expect(warmingDailyLimit(START, 12, nowAfterDays(0))).toBe(5)
    expect(warmingDailyLimit(START, 12, nowAfterDays(2))).toBe(10)
    expect(warmingDailyLimit(START, 12, nowAfterDays(4))).toBe(12) // 15 capeado a 12
    expect(warmingDailyLimit(START, 12, nowAfterDays(20))).toBe(12)
  })

  it('target por debajo del primer escalón también se capea', () => {
    expect(warmingDailyLimit(START, 3, nowAfterDays(0))).toBe(3) // 5 capeado a 3
    expect(warmingDailyLimit(START, 3, nowAfterDays(14))).toBe(3)
  })

  it('warmupStartedAt null se trata como día 0', () => {
    expect(warmingDailyLimit(null, TARGET, nowAfterDays(99))).toBe(5)
  })

  it('fecha futura / reloj desfasado clampa a día 0 (no negativo)', () => {
    const start = '2026-06-10T00:00:00.000Z'
    const now = new Date('2026-06-01T00:00:00.000Z') // antes del start
    expect(warmingDailyLimit(start, TARGET, now)).toBe(5)
  })
})

// ── isWarmupComplete ──────────────────────────────────────────────────────────

describe('isWarmupComplete', () => {
  it('false mientras el ramp no llegó al target (target normal)', () => {
    expect(isWarmupComplete(START, 30, nowAfterDays(0))).toBe(false)
    expect(isWarmupComplete(START, 30, nowAfterDays(9))).toBe(false)
    expect(isWarmupComplete(START, 30, nowAfterDays(13))).toBe(false)
  })

  it('true en día 14+ con target normal', () => {
    expect(isWarmupComplete(START, 30, nowAfterDays(14))).toBe(true)
    expect(isWarmupComplete(START, 30, nowAfterDays(40))).toBe(true)
  })

  it('completa antes si el target es bajo (el cap lo alcanza)', () => {
    // target=10 → se alcanza en día 2 (tramo de 10).
    expect(isWarmupComplete(START, 10, nowAfterDays(1))).toBe(false)
    expect(isWarmupComplete(START, 10, nowAfterDays(2))).toBe(true)
  })

  it('null se trata como día 0 → incompleto salvo target ≤ 5', () => {
    expect(isWarmupComplete(null, 30)).toBe(false)
    expect(isWarmupComplete(null, 5)).toBe(true) // día 0 ya da 5 == target
  })
})

// ── Mock de Supabase (estilo orchestrator.test.ts) ────────────────────────────
// Builder encadenable: select/eq/in/order/update devuelven el mismo objeto; los
// terminales (maybeSingle, o el await directo de update/select) resuelven el
// resultado canónico. Registra los UPDATE para inspeccionarlos en los asserts.

type CapturedUpdate = { table: string; payload: Record<string, unknown> }

interface MockOptions {
  // Resultado de cada lectura .maybeSingle() o await de .select(), en orden de llamada.
  selectResults?: Array<{ data: unknown; error?: { message: string } | null }>
  // Resultado de cada .update(...).<...>.select() o await de update, en orden.
  updateResults?: Array<{ data: unknown; error?: { message: string } | null }>
}

function makeSupabase(opts: MockOptions = {}) {
  const captured: CapturedUpdate[] = []
  const selectResults = [...(opts.selectResults ?? [])]
  const updateResults = [...(opts.updateResults ?? [])]

  function nextSelect() {
    return selectResults.shift() ?? { data: null, error: null }
  }
  function nextUpdate() {
    return updateResults.shift() ?? { data: [{ id: 'x' }], error: null }
  }

  const supabase = {
    from: jest.fn().mockImplementation((table: string) => {
      // Cadena de UPDATE: .update(payload).eq(...).eq(...).select(...) → thenable.
      const makeUpdateChain = (payload: Record<string, unknown>) => {
        captured.push({ table, payload })
        const result = nextUpdate()
        const chain: Record<string, unknown> = {
          eq: jest.fn(() => chain),
          neq: jest.fn(() => chain),
          in: jest.fn(() => chain),
          select: jest.fn(() => Promise.resolve(result)),
          // Permite `await supabase.from().update().eq()` sin .select().
          then: (resolve: (v: unknown) => unknown) => resolve(result),
        }
        return chain
      }

      // Cadena de SELECT (lectura): termina en .maybeSingle() o en await del builder.
      const makeSelectChain = () => {
        const result = nextSelect()
        const chain: Record<string, unknown> = {
          eq: jest.fn(() => chain),
          in: jest.fn(() => chain),
          order: jest.fn(() => chain),
          limit: jest.fn(() => chain),
          maybeSingle: jest.fn(() => Promise.resolve(result)),
          then: (resolve: (v: unknown) => unknown) => resolve(result),
        }
        return chain
      }

      return {
        select: jest.fn(() => makeSelectChain()),
        update: jest.fn((payload: Record<string, unknown>) => makeUpdateChain(payload)),
      }
    }),
  }

  return { supabase: supabase as unknown as SupabaseClient, captured }
}

// ── markBanned ────────────────────────────────────────────────────────────────

describe('markBanned', () => {
  it('transición a banned: setea status/banned_at/ban_reason/activo/connected y devuelve true', async () => {
    const { supabase, captured } = makeSupabase({
      // UPDATE ... WHERE id AND status<>'banned' afectó la fila → transicionó.
      updateResults: [{ data: [{ id: 's1' }] }],
    })

    const transiciono = await markBanned(supabase, 's1', 'device_removed')

    expect(transiciono).toBe(true)
    expect(captured).toHaveLength(1)
    const payload = captured[0].payload
    expect(payload.status).toBe('banned')
    expect(payload.activo).toBe(false)
    expect(payload.connected).toBe(false)
    expect(payload.ban_reason).toBe('device_removed')
    expect(typeof payload.banned_at).toBe('string')
  })

  it('idempotente: si ya estaba banned el guard .neq frena el UPDATE (0 filas) → devuelve false', async () => {
    const { supabase } = makeSupabase({
      updateResults: [{ data: [] }], // 0 filas: ya estaba banned, no transiciona
    })
    expect(await markBanned(supabase, 's1', 'device_removed')).toBe(false)
  })

  it('sender inexistente: UPDATE afecta 0 filas → devuelve false', async () => {
    const { supabase } = makeSupabase({ updateResults: [{ data: [] }] })
    expect(await markBanned(supabase, 'nope', 'device_removed')).toBe(false)
  })

  it('propaga error del UPDATE', async () => {
    const { supabase } = makeSupabase({
      updateResults: [{ data: null, error: { message: 'boom' } }],
    })
    await expect(markBanned(supabase, 's1', 'code_403')).rejects.toThrow(/markBanned failed: boom/)
  })
})

// ── promoteFromReserve ────────────────────────────────────────────────────────

describe('promoteFromReserve', () => {
  it('promueve el reserve más viejo: warming + warmup_started_at + daily_limit day-0 (5)', async () => {
    const candidatos = [
      { id: 'r-old', alias: 'Reserva vieja', instance_name: 'wa-r-old', status: 'reserve', warmup_started_at: null, daily_limit_target: 30 },
      { id: 'r-new', alias: 'Reserva nueva', instance_name: 'wa-r-new', status: 'reserve', warmup_started_at: null, daily_limit_target: 30 },
    ]
    const { supabase, captured } = makeSupabase({
      selectResults: [{ data: candidatos }],
      updateResults: [
        { data: [{ id: 'r-old', alias: 'Reserva vieja', instance_name: 'wa-r-old', status: 'warming', warmup_started_at: '2026-06-15T00:00:00.000Z', daily_limit_target: 30 }] },
      ],
    })

    const promovido = await promoteFromReserve(supabase)

    expect(promovido).not.toBeNull()
    expect(promovido?.id).toBe('r-old')
    expect(promovido?.status).toBe('warming')
    // El UPDATE setea warming + warmup_started_at + el límite day-0 del ramp.
    expect(captured).toHaveLength(1)
    expect(captured[0].payload.status).toBe('warming')
    expect(typeof captured[0].payload.warmup_started_at).toBe('string')
    // Arranca en 5/día (day-0), NO en el límite viejo de la reserva (evita el blast
    // al entrar al pool justo después de un baneo).
    expect(captured[0].payload.daily_limit).toBe(5)
  })

  it('el límite day-0 capea a daily_limit_target si el target es menor que 5', async () => {
    const candidatos = [
      { id: 'r1', alias: null, instance_name: 'wa-r', status: 'reserve', warmup_started_at: null, daily_limit_target: 3 },
    ]
    const { supabase, captured } = makeSupabase({
      selectResults: [{ data: candidatos }],
      updateResults: [{ data: [{ id: 'r1', status: 'warming', daily_limit_target: 3 }] }],
    })

    await promoteFromReserve(supabase)
    expect(captured[0].payload.daily_limit).toBe(3)
  })

  it('prefiere reserve sobre warming aunque el warming sea más viejo', async () => {
    // order asc por created_at: el warming llega primero, pero debe elegir el reserve.
    const candidatos = [
      { id: 'w-old', alias: null, instance_name: 'wa-w', status: 'warming', warmup_started_at: '2026-06-01T00:00:00.000Z', daily_limit_target: 30 },
      { id: 'r-1', alias: null, instance_name: 'wa-r', status: 'reserve', warmup_started_at: null, daily_limit_target: 30 },
    ]
    const { supabase, captured } = makeSupabase({
      selectResults: [{ data: candidatos }],
      updateResults: [{ data: [{ id: 'r-1', alias: null, instance_name: 'wa-r', status: 'warming', warmup_started_at: '2026-06-15T00:00:00.000Z', daily_limit_target: 30 }] }],
    })

    const promovido = await promoteFromReserve(supabase)
    expect(promovido?.id).toBe('r-1')
    expect(captured).toHaveLength(1) // hizo la transición reserve→warming
  })

  it('si no hay reserve, devuelve el warming más viejo SIN tocar la DB', async () => {
    const candidatos = [
      { id: 'w-1', alias: null, instance_name: 'wa-w1', status: 'warming', warmup_started_at: '2026-06-05T00:00:00.000Z', daily_limit_target: 30 },
    ]
    const { supabase, captured } = makeSupabase({
      selectResults: [{ data: candidatos }],
    })

    const promovido = await promoteFromReserve(supabase)
    expect(promovido?.id).toBe('w-1')
    expect(promovido?.status).toBe('warming')
    expect(captured).toHaveLength(0) // no UPDATE: ya estaba rampeando
  })

  it('sin candidatos → null', async () => {
    const { supabase } = makeSupabase({ selectResults: [{ data: [] }] })
    expect(await promoteFromReserve(supabase)).toBeNull()
  })

  it('race perdida en la transición → reintenta y eventualmente null si nadie queda', async () => {
    // 1er intento: hay un reserve, pero el UPDATE no afecta filas (otro tick ganó).
    // 2do intento: ya no queda ninguno → null.
    const { supabase } = makeSupabase({
      selectResults: [
        { data: [{ id: 'r-1', alias: null, instance_name: 'wa-r', status: 'reserve', warmup_started_at: null, daily_limit_target: 30 }] },
        { data: [] },
      ],
      updateResults: [{ data: [] }], // UPDATE no afectó filas → race perdida
    })

    const promovido = await promoteFromReserve(supabase, { maxRetries: 3 })
    expect(promovido).toBeNull()
  })
})

// ── tickWarming ───────────────────────────────────────────────────────────────

describe('tickWarming', () => {
  it('recalcula daily_limit del que avanzó de escalón', async () => {
    // start hace 4 días → corresponde 15; tenía 10 → debe actualizar a 15.
    const start = new Date(Date.now() - 4 * 86_400_000).toISOString()
    const { supabase, captured } = makeSupabase({
      selectResults: [
        { data: [{ id: 's1', daily_limit: 10, daily_limit_target: 30, warmup_started_at: start }] },
      ],
      updateResults: [{ data: [{ id: 's1' }] }],
    })

    const resumen = await tickWarming(supabase)

    expect(resumen.procesados).toBe(1)
    expect(resumen.actualizados).toBe(1)
    expect(resumen.graduados).toBe(0)
    expect(captured).toHaveLength(1)
    expect(captured[0].payload.daily_limit).toBe(15)
    expect('status' in captured[0].payload).toBe(false) // no gradúa todavía
  })

  it('gradúa a active cuando el ramp llegó al target (día 14+)', async () => {
    const start = new Date(Date.now() - 20 * 86_400_000).toISOString()
    const { supabase, captured } = makeSupabase({
      selectResults: [
        { data: [{ id: 's1', daily_limit: 25, daily_limit_target: 30, warmup_started_at: start }] },
      ],
      updateResults: [{ data: [{ id: 's1' }] }],
    })

    const resumen = await tickWarming(supabase)

    expect(resumen.graduados).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].payload.status).toBe('active')
    expect(captured[0].payload.daily_limit).toBe(30)
  })

  it('idempotente: si el daily_limit ya es el correcto y no completa, no hace UPDATE', async () => {
    // start hace 5 días → corresponde 15; ya tiene 15 y target 30 (no completa).
    const start = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const { supabase, captured } = makeSupabase({
      selectResults: [
        { data: [{ id: 's1', daily_limit: 15, daily_limit_target: 30, warmup_started_at: start }] },
      ],
    })

    const resumen = await tickWarming(supabase)

    expect(resumen.procesados).toBe(1)
    expect(resumen.actualizados).toBe(0)
    expect(resumen.graduados).toBe(0)
    expect(captured).toHaveLength(0)
  })

  it('sin senders en warming → resumen en cero', async () => {
    const { supabase, captured } = makeSupabase({ selectResults: [{ data: [] }] })
    const resumen = await tickWarming(supabase)
    expect(resumen).toEqual({ procesados: 0, actualizados: 0, graduados: 0 })
    expect(captured).toHaveLength(0)
  })

  it('procesa varios senders y resume bien (uno avanza, uno gradúa, uno estable)', async () => {
    const d4 = new Date(Date.now() - 4 * 86_400_000).toISOString()  // → 15
    const d20 = new Date(Date.now() - 20 * 86_400_000).toISOString() // → target (gradúa)
    const d5 = new Date(Date.now() - 5 * 86_400_000).toISOString()  // → 15 (ya está)
    const { supabase, captured } = makeSupabase({
      selectResults: [
        {
          data: [
            { id: 'a', daily_limit: 10, daily_limit_target: 30, warmup_started_at: d4 },
            { id: 'b', daily_limit: 25, daily_limit_target: 30, warmup_started_at: d20 },
            { id: 'c', daily_limit: 15, daily_limit_target: 30, warmup_started_at: d5 },
          ],
        },
      ],
      updateResults: [{ data: [{ id: 'a' }] }, { data: [{ id: 'b' }] }],
    })

    const resumen = await tickWarming(supabase)

    expect(resumen.procesados).toBe(3)
    expect(resumen.actualizados).toBe(1) // solo 'a' cambió daily_limit (15) sin graduar
    expect(resumen.graduados).toBe(1)    // 'b' graduó
    expect(captured).toHaveLength(2)     // 'c' no generó UPDATE
  })
})
