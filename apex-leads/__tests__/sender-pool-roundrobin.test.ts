// Smoke test integrativo: ejercita `selectNextSender` + `incrementMsgsToday`
// reales contra un mock de Supabase en memoria. Verifica que la distribución
// round-robin LRU efectivamente entrega el patrón 1A → 1B → 1C → 2A → ...
//
// El "Supabase" acá es un objeto plano que responde a la cadena exacta de
// llamadas que hacen las funciones del pool. No usa la red ni la DB real.

import { selectNextSender, incrementMsgsToday } from '@/lib/sender-pool'
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = {
  id: string
  alias: string
  instance_name: string
  phone_number: string
  daily_limit: number
  msgs_today: number
  last_sent_at: string | null
  connected: boolean
  activo: boolean
  provider: string
}

/**
 * Mock de SupabaseClient backed by un array mutable de filas.
 * Soporta exactamente las cadenas que el pool ejecuta:
 *  - SELECT (selectNextSender, incrementMsgsToday read)
 *  - UPDATE con .eq().eq().eq().eq().select() (incrementMsgsToday write)
 */
function makeInMemorySupabase(rows: Row[]): {
  client: SupabaseClient
  rows: Row[]
} {
  let clock = 0
  // Reloj sintético monotónico para `last_sent_at`. Reemplaza al
  // `new Date().toISOString()` que `incrementMsgsToday` produce, evitando
  // tener que mockear el global `Date` (que provoca recursión infinita).
  const nextTimestamp = () => {
    clock += 1
    const base = new Date('2026-04-29T07:00:00Z').getTime()
    return new Date(base + clock * 60_000).toISOString()
  }

  const fromImpl = (table: string) => {
    if (table !== 'senders') {
      throw new Error(`Tabla no esperada en mock: ${table}`)
    }

    type Op = 'select' | 'update'
    let op: Op = 'select'
    const filters: Array<(r: Row) => boolean> = []
    let updatePatch: Partial<Row> | null = null

    const chain: Record<string, unknown> = {
      select: jest.fn((_fields?: string) => {
        // No-op: solo registra que es una lectura.
        return chain
      }),
      update: jest.fn((patch: Partial<Row>) => {
        op = 'update'
        updatePatch = patch
        return chain
      }),
      eq: jest.fn((col: keyof Row, val: unknown) => {
        filters.push(r => r[col] === val)
        return chain
      }),
      order: jest.fn(() => chain),
      maybeSingle: jest.fn(() => {
        const matched = rows.filter(r => filters.every(f => f(r)))
        return Promise.resolve({
          data: matched[0] ?? null,
          error: null,
        })
      }),
    }

    // Hacer el chain thenable para `await`. Devuelve { data, error }
    // según sea SELECT o UPDATE.
    ;(chain as {
      then: (cb: (v: { data: Row[] | null; error: unknown }) => void) => void
    }).then = (cb) => {
      const matched = rows.filter(r => filters.every(f => f(r)))
      if (op === 'update') {
        if (updatePatch) {
          // Sustituye el `last_sent_at` real (Date.now()) por el reloj
          // sintético del mock, garantizando orden monotónico determinista.
          const patchToApply: Partial<Row> = { ...updatePatch }
          if ('last_sent_at' in patchToApply) {
            patchToApply.last_sent_at = nextTimestamp()
          }
          for (const r of matched) {
            Object.assign(r, patchToApply)
          }
        }
        cb({ data: matched.map(r => ({ ...r })), error: null })
      } else {
        // SELECT: ordenar por msgs_today asc, last_sent_at asc nulls first.
        matched.sort((a, b) => {
          if (a.msgs_today !== b.msgs_today) return a.msgs_today - b.msgs_today
          if (a.last_sent_at === null && b.last_sent_at === null) return 0
          if (a.last_sent_at === null) return -1
          if (b.last_sent_at === null) return 1
          return a.last_sent_at < b.last_sent_at ? -1 : 1
        })
        cb({ data: matched.map(r => ({ ...r })), error: null })
      }
    }

    return chain
  }

  const client = { from: jest.fn(fromImpl) } as unknown as SupabaseClient
  return { client, rows }
}

/**
 * Ejecuta un tick: selectNext → incrementMsgsToday.
 * Devuelve el id del sender que ganó el tick, o null si el pool se agotó.
 */
async function runTick(supa: SupabaseClient): Promise<string | null> {
  const sender = await selectNextSender(supa)
  if (!sender) return null
  const ok = await incrementMsgsToday(supa, sender.id)
  if (!ok) {
    // En la vida real reintentaríamos; en el mock single-thread no debería pasar.
    return null
  }
  return sender.id
}

describe('round-robin distribution', () => {
  it('con 3 senders (15/15/20 daily_limit), 30 ticks reparten 10/10/10 en orden A,B,C cíclico', async () => {
    const baseRow = {
      provider: 'evolution',
      activo: true,
      connected: true,
      msgs_today: 0,
      last_sent_at: null,
      phone_number: '+1',
      instance_name: 'wa-x',
    }
    const rows: Row[] = [
      { ...baseRow, id: 'A', alias: 'A', instance_name: 'wa-a', daily_limit: 15 },
      { ...baseRow, id: 'B', alias: 'B', instance_name: 'wa-b', daily_limit: 15 },
      { ...baseRow, id: 'C', alias: 'C', instance_name: 'wa-c', daily_limit: 20 },
    ]
    const { client } = makeInMemorySupabase(rows)

    const winners: string[] = []
    for (let i = 0; i < 30; i++) {
      const w = await runTick(client)
      expect(w).not.toBeNull()
      winners.push(w!)
    }

    // Distribución total: 30 ticks / 3 SIMs = 10/10/10 (todas debajo de su daily_limit).
    const counts = winners.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1
      return acc
    }, {})
    expect(counts).toEqual({ A: 10, B: 10, C: 10 })

    // Patrón cíclico: los primeros 3 ticks deben ser A, B, C (cualquier orden, son tie en 0)
    // y el ciclo se repite cada 3 ticks.
    const firstCycle = winners.slice(0, 3).sort()
    expect(firstCycle).toEqual(['A', 'B', 'C'])

    // Los últimos 3 ticks (28, 29, 30) también deben tener un sender de cada uno.
    const lastCycle = winners.slice(27, 30).sort()
    expect(lastCycle).toEqual(['A', 'B', 'C'])
  })

  it('cuando una SIM se desconecta a mitad, el resto absorbe sin saltarse turnos', async () => {
    const baseRow = {
      provider: 'evolution',
      activo: true,
      connected: true,
      msgs_today: 0,
      last_sent_at: null,
      phone_number: '+1',
      instance_name: 'wa-x',
    }
    const rows: Row[] = [
      { ...baseRow, id: 'A', alias: 'A', instance_name: 'wa-a', daily_limit: 15 },
      { ...baseRow, id: 'B', alias: 'B', instance_name: 'wa-b', daily_limit: 15 },
      { ...baseRow, id: 'C', alias: 'C', instance_name: 'wa-c', daily_limit: 15 },
    ]
    const { client } = makeInMemorySupabase(rows)

    const winners: string[] = []
    for (let i = 0; i < 9; i++) {
      const w = await runTick(client)
      expect(w).not.toBeNull()
      winners.push(w!)
    }
    // Tras 9 ticks → 3 a cada SIM.
    expect(winners.filter(x => x === 'A').length).toBe(3)
    expect(winners.filter(x => x === 'B').length).toBe(3)
    expect(winners.filter(x => x === 'C').length).toBe(3)

    // Desconectamos C.
    const cRow = rows.find(r => r.id === 'C')!
    cRow.connected = false

    for (let i = 0; i < 12; i++) {
      const w = await runTick(client)
      expect(w).not.toBeNull()
      winners.push(w!)
    }

    // Después de 21 ticks totales, C sigue en 3 (no avanzó), A y B se llevaron 6 cada uno extra.
    const counts = winners.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1
      return acc
    }, {})
    expect(counts.C).toBe(3) // se quedó donde estaba al desconectarse
    expect(counts.A).toBe(9) // 3 + 6
    expect(counts.B).toBe(9) // 3 + 6
  })

  it('cuando todas las SIMs llegan al daily_limit, runTick devuelve null', async () => {
    const baseRow = {
      provider: 'evolution',
      activo: true,
      connected: true,
      msgs_today: 0,
      last_sent_at: null,
      phone_number: '+1',
      instance_name: 'wa-x',
    }
    const rows: Row[] = [
      { ...baseRow, id: 'A', alias: 'A', instance_name: 'wa-a', daily_limit: 2 },
      { ...baseRow, id: 'B', alias: 'B', instance_name: 'wa-b', daily_limit: 2 },
    ]
    const { client } = makeInMemorySupabase(rows)

    // 4 ticks cubren el pool entero (2+2).
    for (let i = 0; i < 4; i++) {
      const w = await runTick(client)
      expect(w).not.toBeNull()
    }
    // El 5to debe devolver null (pool agotado).
    expect(await runTick(client)).toBeNull()
  })
})
