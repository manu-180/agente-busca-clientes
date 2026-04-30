# SESSION-EVO-05 — Sender Pool LRU (round-robin algorithm)

**Modelo:** claude-sonnet-4-6
**Repo:** `C:\MisProyectos\bots_ia\agente_busca_clientes` — branch `main`
**App:** `apex-leads/`
**Estimado:** 30-45 min

---

## Lectura obligatoria al inicio

1. `docs/superpowers/specs/2026-04-29-evolution-pool-design.md` — sección 3.2 (módulos backend, sender-pool)
2. `docs/migration/evolution-api/PROGRESS.md` — confirmar que SESSION-EVO-04 está marcada completa
3. `apex-leads/src/lib/evolution-instance.ts` — para entender el contrato con Evolution

---

## Contexto

**Lo que ya está hecho (EVO-04):**
- Schema `senders` con: `daily_limit, msgs_today, last_reset_date, last_sent_at, connected, connected_at, qr_requested_at`.
- Helpers de gestión de instancias en `lib/evolution-instance.ts`.
- UI premium del QR onboarding.

**Esta sesión:** crear el módulo de pool — la lógica que decide qué SIM usar en cada envío, cómo se incrementa el contador atómicamente, y cómo se resetea diariamente.

**Pre-requisito:** EVO-04 mergeado en main. Verificar:
```bash
git log --oneline -3 | grep "SESSION-EVO-04"
```

---

## TAREA 1 — `apex-leads/src/lib/sender-pool.ts` (25 min)

Nuevo archivo. Funciones puras que operan sobre Supabase. Sin estado interno.

### Tipo

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export type PoolSender = {
  id: string
  alias: string | null
  instance_name: string
  phone_number: string
  daily_limit: number
  msgs_today: number
  last_sent_at: string | null
  connected: boolean
  activo: boolean
}
```

### Funciones a implementar

#### `selectNextSender(supabase): Promise<PoolSender | null>`

```sql
SELECT id, alias, instance_name, phone_number, daily_limit, msgs_today,
       last_sent_at, connected, activo
FROM senders
WHERE provider = 'evolution'
  AND activo = true
  AND connected = true
  AND msgs_today < daily_limit
ORDER BY msgs_today ASC, last_sent_at ASC NULLS FIRST
LIMIT 1;
```

Retorna `null` si no hay sender disponible.

#### `incrementMsgsToday(supabase, senderId): Promise<boolean>`

UPDATE atómico. Devuelve `true` si la fila fue actualizada (sender disponible), `false` si la condición no se cumplió (race con otro cron, sender ya llegó al límite entre `selectNext` y este UPDATE).

```sql
UPDATE senders
SET msgs_today = msgs_today + 1, last_sent_at = NOW()
WHERE id = $1
  AND msgs_today < daily_limit
  AND activo = true
  AND connected = true
RETURNING id;
```

`return data !== null`.

#### `resetDailyCountersIfNeeded(supabase): Promise<void>`

UPDATE bulk. Idempotente: si `last_reset_date` ya es hoy_AR para todos, no hace nada (UPDATE devuelve 0 rows).

```sql
UPDATE senders
SET msgs_today = 0, last_reset_date = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
WHERE provider = 'evolution'
  AND (last_reset_date IS NULL
       OR last_reset_date < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
```

#### `getCapacityStats(supabase): Promise<CapacityStats>`

```typescript
export type CapacityStats = {
  total_today: number       // sum(daily_limit) de SIMs activas y conectadas
  used_today: number        // sum(msgs_today) de SIMs activas
  remaining: number         // total_today - used_today
  active_connected: number  // count de SIMs activas y connected
  active_total: number      // count de SIMs activas (incluye disconnected)
  per_sender: Array<{
    id: string
    alias: string | null
    instance_name: string
    phone_number: string
    color: string
    msgs_today: number
    daily_limit: number
    remaining: number
    connected: boolean
    activo: boolean
  }>
}
```

Una sola query a `senders` con `provider='evolution' AND activo=true ORDER BY created_at`, después agregaciones en JS.

#### `markDisconnected(supabase, senderId): Promise<void>`

```sql
UPDATE senders SET connected = false WHERE id = $1;
```

Llamado desde EVO-06 cuando hay 10 fallos consecutivos.

---

## TAREA 2 — Tests unitarios del pool (15 min)

Nuevo archivo `apex-leads/__tests__/sender-pool.test.ts`. Usar el patrón Jest existente (ver `apex-leads/__tests__/` para patrones — hay tests con mocks de Supabase).

### Tests requeridos

```typescript
describe('selectNextSender', () => {
  it('devuelve null si no hay senders activos', ...)
  it('devuelve null si todos llegaron al daily_limit', ...)
  it('devuelve null si todos están disconnected', ...)
  it('elige el sender con menor msgs_today', ...)
  it('en empate de msgs_today, elige el de last_sent_at más viejo', ...)
  it('NULLS FIRST: si dos están en 0 sin last_sent_at, elige el primero por orden natural', ...)
})

describe('incrementMsgsToday', () => {
  it('retorna true si el sender está disponible', ...)
  it('retorna false si el sender ya llegó al daily_limit', ...)
  it('retorna false si el sender no existe', ...)
  it('NO incrementa si está disconnected', ...)
})

describe('resetDailyCountersIfNeeded', () => {
  it('resetea cuando last_reset_date es ayer ART', ...)
  it('no toca nada si todos ya tienen last_reset_date = hoy', ...)
  it('resetea cuando last_reset_date es null (sender nuevo)', ...)
})

describe('getCapacityStats', () => {
  it('suma correctamente totales y por sender', ...)
  it('excluye senders inactivos del active_connected pero los incluye en active_total si activo=true', ...)
})
```

**Mock de Supabase:** usar el patrón que ya está en otros tests del repo (probablemente `jest.mock('@/lib/supabase-server')` con mocks de `.from().select()...`). Si no encontrás el patrón, usá un mock simple en cada test.

### Smoke test integrativo (round-robin de 30 ticks)

Nuevo archivo `apex-leads/__tests__/sender-pool-roundrobin.test.ts`:

```typescript
describe('round-robin distribution', () => {
  it('con 3 senders (15/15/20 daily_limit), 30 ticks reparten 10/10/10', async () => {
    // Setup: 3 senders en memoria simulando la DB.
    // Loop 30 veces: select → increment → registrar
    // Asserts: distribución es exactamente la esperada (los primeros 45 ticks: 15 a A, 15 a B, 20 a C en orden round-robin)
  })

  it('cuando una SIM se desconecta a mitad, el resto absorbe sin saltarse turnos', ...)
})
```

**No necesita Supabase real** — mockear los métodos del pool con un objeto en memoria.

---

## TAREA 3 — Tipos exportados de `lib/evolution.ts` (5 min)

Para que EVO-06 pueda importar `PoolSender` sin importar también `lib/sender-pool.ts`, re-exportá el tipo desde `lib/evolution.ts`:

```typescript
// apex-leads/src/lib/evolution.ts
export type { PoolSender } from './sender-pool'
```

(Pequeño cleanup que evita imports cíclicos en EVO-06.)

---

## Verificación final

- [ ] `lib/sender-pool.ts` creado, todas las funciones con JSDoc.
- [ ] Tests unitarios verdes: `npx jest sender-pool` desde `apex-leads/`.
- [ ] Smoke round-robin verde.
- [ ] `tsc --noEmit` sin errores nuevos.
- [ ] PROGRESS.md actualizado.
- [ ] Commit: `feat(evolution): SESSION-EVO-05 — sender-pool LRU + tests round-robin`

---

## Fuera de scope

- Refactor del cron. EVO-06.
- UI dashboard. EVO-07.
- Llamar a `markDisconnected` desde el cron en caso de fallo. Eso lo cablea EVO-06.

---

## Al cerrar la sesión

1. Update PROGRESS.md (marcar EVO-05 completa, próxima EVO-06).
2. Commit en main.
3. Mostrar a Manuel: próxima sesión `SESSION-EVO-06.md`, modelo Sonnet.
