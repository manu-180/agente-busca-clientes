# SESSION-EVO-07 — Dashboard de Capacidad UI Premium

**Modelo:** claude-sonnet-4-6
**Repo:** `C:\MisProyectos\bots_ia\agente_busca_clientes` — branch `main`
**App:** `apex-leads/`
**Estimado:** 45-60 min

---

## Lectura obligatoria al inicio

1. `docs/superpowers/specs/2026-04-29-evolution-pool-design.md` — sección 3.5 (frontend)
2. `docs/migration/evolution-api/PROGRESS.md` — confirmar EVO-04, 05, 06 completas
3. `apex-leads/src/app/leads/nuevo/NuevoLeadClient.tsx` — el stats bar actual (queremos extender, no reemplazar)
4. `apex-leads/src/app/senders/page.tsx` — la grilla actual (agregar header con stats)
5. `apex-leads/src/lib/sender-pool.ts` — la función `getCapacityStats` que vamos a exponer

---

## Contexto

Hoy en `/leads/nuevo` Manuel ve un stats bar con 4 cards: `[En cola] [Hoy enviados/fallidos] [Horario] [Sistema]`. No ve cuánto cupo le queda al pool ni cuál SIM está más cargada.

En `/senders` Manuel ve una grilla de cards con stats por sender, pero no ve resumen agregado en el header.

**Esta sesión:** crear endpoint `/api/senders/capacity`, extender el stats bar de `/leads/nuevo`, agregar header con stats a `/senders`. Pulir cards de senders con progress bar de daily_limit.

**Pre-requisito:** EVO-04, 05 y 06 mergeadas.

---

## TAREA 1 — Endpoint `/api/senders/capacity` (10 min)

Crear `apex-leads/src/app/api/senders/capacity/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { getCapacityStats } from '@/lib/sender-pool'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServer()
  const stats = await getCapacityStats(supabase)
  return NextResponse.json(stats)
}
```

Sin auth (es read-only del estado público de los senders, no expone API keys).

---

## TAREA 2 — Stats bar extendido en `/leads/nuevo` (15 min)

Editar `apex-leads/src/app/leads/nuevo/NuevoLeadClient.tsx`.

### Cambios

**A. Agregar tipo y state nuevo:**

```typescript
interface CapacityStats {
  total_today: number
  used_today: number
  remaining: number
  active_connected: number
  active_total: number
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
  }>
}

const [capacity, setCapacity] = useState<CapacityStats | null>(null)
```

**B. Función para cargar y polling de capacity:**

```typescript
async function cargarCapacity() {
  try {
    const res = await fetch('/api/senders/capacity', { cache: 'no-store' })
    if (res.ok) setCapacity(await res.json() as CapacityStats)
  } catch {}
}

useEffect(() => {
  cargarCapacity()
  const intervalo = setInterval(cargarCapacity, 30_000)
  return () => clearInterval(intervalo)
}, [])
```

**C. Extender el stats bar (después del bloque `{queueStats && (...)}`):**

```tsx
{capacity && (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div className="bg-apex-card border border-apex-border rounded-lg p-3">
      <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">Pool restante</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-2xl font-bold text-apex-lime tabular-nums">{capacity.remaining}</span>
        <span className="text-sm text-apex-muted font-mono">de {capacity.total_today} msgs</span>
      </div>
      <div className="w-full h-1 bg-apex-border rounded-full overflow-hidden mt-2">
        <div
          className="h-full bg-apex-lime rounded-full transition-all"
          style={{ width: `${capacity.total_today > 0 ? (capacity.used_today / capacity.total_today) * 100 : 0}%` }}
        />
      </div>
    </div>

    <div className="bg-apex-card border border-apex-border rounded-lg p-3">
      <div className="text-xs text-apex-muted font-mono uppercase tracking-wider">SIMs activas</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-2xl font-bold text-apex-lime tabular-nums">{capacity.active_connected}</span>
        <span className="text-sm text-apex-muted font-mono">de {capacity.active_total} conectadas</span>
      </div>
      <div className="flex gap-1 mt-2">
        {capacity.per_sender.map(s => (
          <div
            key={s.id}
            className={`w-2 h-2 rounded-full ${s.connected ? 'bg-apex-lime' : 'bg-red-500/50'}`}
            title={`${s.alias} — ${s.connected ? 'conectada' : 'desconectada'}`}
          />
        ))}
      </div>
    </div>

    {/* Las otras 2 cards ya existían, las dejás como están: Horario / Sistema o las que correspondan */}
  </div>
)}
```

**D. Mini-grid por SIM (debajo del stats bar):**

```tsx
{capacity && capacity.per_sender.length > 0 && (
  <div className="bg-apex-card/60 border border-apex-border/60 rounded-xl p-4">
    <h3 className="text-xs font-mono uppercase tracking-wider text-apex-muted mb-3">
      Capacidad por SIM
    </h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {capacity.per_sender.map(s => {
        const pct = s.daily_limit > 0 ? (s.msgs_today / s.daily_limit) * 100 : 0
        return (
          <div key={s.id} className="flex items-center gap-3 bg-apex-black/40 rounded-lg p-3">
            <div
              className={`w-2 h-8 rounded-full flex-shrink-0 ${s.connected ? '' : 'opacity-30'}`}
              style={{ background: s.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-syne font-semibold truncate">{s.alias}</span>
                <span className="text-xs font-mono text-apex-muted tabular-nums whitespace-nowrap">
                  {s.msgs_today}/{s.daily_limit}
                </span>
              </div>
              <div className="w-full h-1 bg-apex-border rounded-full overflow-hidden mt-1.5">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, pct)}%`, background: s.color, opacity: s.connected ? 1 : 0.3 }}
                />
              </div>
              {!s.connected && (
                <span className="text-[10px] font-mono text-red-400/80">desconectada</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  </div>
)}
```

---

## TAREA 3 — Header de stats en `/senders` (10 min)

Editar `apex-leads/src/app/senders/page.tsx`.

Antes de la grilla de cards (después del header con título y botón "Agregar"), agregar el bloque de stats. Reusar fetch a `/api/senders/capacity`.

```tsx
{capacity && (
  <div className="flex flex-wrap items-center gap-4 px-4 py-3 bg-apex-card border border-apex-border rounded-lg">
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono uppercase tracking-wider text-apex-muted">Pool hoy</span>
      <span className="text-lg font-syne font-bold tabular-nums">
        <span className="text-apex-lime">{capacity.used_today}</span>
        <span className="text-apex-muted text-sm">/</span>
        <span>{capacity.total_today}</span>
      </span>
      <span className="text-xs font-mono text-apex-muted">
        ({capacity.remaining} restantes)
      </span>
    </div>

    <div className="h-4 w-px bg-apex-border" />

    <div className="flex items-center gap-2">
      <span className="text-xs font-mono uppercase tracking-wider text-apex-muted">SIMs</span>
      <span className="text-lg font-syne font-bold tabular-nums">
        <span className="text-apex-lime">{capacity.active_connected}</span>
        <span className="text-apex-muted text-sm">/</span>
        <span>{capacity.active_total}</span>
      </span>
      <div className="flex gap-1">
        {capacity.per_sender.map(s => (
          <div
            key={s.id}
            className={`w-2 h-2 rounded-full ${s.connected ? 'bg-apex-lime' : 'bg-red-500/50'}`}
          />
        ))}
      </div>
    </div>
  </div>
)}
```

---

## TAREA 4 — Pulir cards de sender con progress de daily_limit (15 min)

En `apex-leads/src/app/senders/page.tsx`, reemplazar la barra de progreso actual de la card (que muestra ratio de conversaciones) por barra de `msgs_today / daily_limit`.

```tsx
{/* Stats — bloque nuevo, reemplaza la barra de conversaciones */}
<div className="space-y-2">
  <div className="flex items-center justify-between text-xs font-mono">
    <span className="text-apex-muted">{convCount(s)} conversaciones</span>
    <span className="text-apex-muted tabular-nums">
      <span className={s.msgs_today >= s.daily_limit ? 'text-amber-400' : 'text-apex-lime'}>
        {s.msgs_today}
      </span>
      <span className="text-apex-muted">/{s.daily_limit}</span>
      <span className="text-apex-muted ml-1">msgs hoy</span>
    </span>
  </div>
  <div className="w-full h-1.5 bg-apex-border rounded-full overflow-hidden">
    <div
      className="h-full rounded-full transition-all"
      style={{
        width: `${Math.min(100, (s.msgs_today / Math.max(1, s.daily_limit)) * 100)}%`,
        background: s.msgs_today >= s.daily_limit ? '#f59e0b' : s.color,
      }}
    />
  </div>
  {s.msgs_today >= s.daily_limit && (
    <p className="text-[10px] text-amber-400/90 font-mono">Límite diario alcanzado</p>
  )}
</div>
```

(El tipo `Sender` necesita ahora incluir `msgs_today` y `daily_limit` — ajustar la interface.)

---

## TAREA 5 — Smoke visual (5 min)

`npm run dev` en apex-leads. Ir a `/senders` y `/leads/nuevo`. Verificar:
- Stats agregados aparecen.
- Mini-grid de SIMs con barras de color correcto.
- Cards de sender muestran `msgs_today/daily_limit`.
- Una SIM "vacía" (msgs_today=0) muestra barra vacía. Una SIM "llena" muestra naranja.

---

## Verificación final

- [ ] Endpoint `/api/senders/capacity` funciona (`curl http://localhost:3000/api/senders/capacity | jq .`).
- [ ] Stats bar de `/leads/nuevo` muestra Pool restante + SIMs activas.
- [ ] Mini-grid de SIMs visible en `/leads/nuevo`.
- [ ] Header de `/senders` con stats agregados.
- [ ] Cards de senders muestran progress bar de daily_limit.
- [ ] Polling cada 30s funciona (verificar en Network tab).
- [ ] `tsc --noEmit` sin errores.
- [ ] PROGRESS.md actualizado.
- [ ] Commit: `feat(evolution): SESSION-EVO-07 — dashboard de capacidad UI premium`

---

## Fuera de scope

- Cleanup de claves viejas. EVO-08.
- Tests E2E. EVO-08.
- Sacar 💳 del template. EVO-08.

---

## Al cerrar la sesión

1. PROGRESS.md (EVO-07 completa, próxima EVO-08 es la última).
2. Commit en main.
3. Mostrar a Manuel: próxima sesión `SESSION-EVO-08.md`.
