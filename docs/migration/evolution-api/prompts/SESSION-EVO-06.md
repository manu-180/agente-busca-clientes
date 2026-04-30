# SESSION-EVO-06 — Refactor del Cron a 1-msg-per-tick (round-robin)

**Modelo:** claude-sonnet-4-6
**Repo:** `C:\MisProyectos\bots_ia\agente_busca_clientes` — branch `main`
**App:** `apex-leads/`
**Estimado:** 45-60 min

---

## Lectura obligatoria al inicio

1. `docs/superpowers/specs/2026-04-29-evolution-pool-design.md` — sección 3.4 (refactor del cron)
2. `docs/migration/evolution-api/PROGRESS.md` — confirmar EVO-04 y EVO-05 completas
3. `apex-leads/src/app/api/cron/leads-pendientes/route.ts` — el archivo que vamos a reescribir
4. `apex-leads/src/lib/sender-pool.ts` — el módulo que vamos a usar

---

## Contexto

**Comportamiento actual del cron** (que vamos a reemplazar):
- Loopea por todos los senders activos en orden de `created_at`.
- Por sender: chequea ventana, lee contador `${instance}_primer_enviados_hoy` de tabla `configuracion`, claim atómico de 1 lead, envía, incrementa.
- En un solo tick se mandan N mensajes (N = senders activos).

**Comportamiento nuevo (esta sesión):**
- Por tick: 1 reset diario bulk → 1 select del próximo sender → 1 claim de lead → 1 envío → 1 increment atómico.
- Si race condition (increment retorna false), reintenta select hasta 3 veces.
- 5 crons defasados a 1 min sobre el mismo pool = 5 msgs/min distribuidos round-robin.

**Pre-requisito:** EVO-04 y EVO-05 mergeadas. Verificar:
```bash
git log --oneline -5 | grep -E "SESSION-EVO-(04|05)"
```

---

## TAREA 0 — Backup y revisión (5 min)

Leer `apex-leads/src/app/api/cron/leads-pendientes/route.ts` completo. Identificar:
- La función `procesarSender` (vamos a deprecarla, reemplazada por `procesarUnTick`).
- El handler `GET` (lo vamos a reescribir).
- Las funciones de `leerDailyCount` / `incrementarDailyCount` / `escribirConfig` que leían/escribían `tabla configuracion` con clave `${key}_primer_enviados_hoy` — vamos a dejarlas como **fallback de lectura** por si necesitamos rollback rápido. NO eliminarlas en esta sesión (eso es EVO-08).

NO commit todavía.

---

## TAREA 1 — Reescribir `cron/leads-pendientes/route.ts` (35 min)

### Estructura del archivo nuevo

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { variantesTelefonoMismaLinea } from '@/lib/phone'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'
import { verificarNumeroWhatsApp } from '@/lib/phone-verify'
import {
  estaEnVentanaPrimerContacto,
  getHoraArgentina,
  PRIMER_CONTACTO_HORA_FIN_AR,
  PRIMER_CONTACTO_HORA_INICIO_AR,
} from '@/lib/first-contact-window'
import {
  extraerRatingParaPlantilla,
  resolveWhatsAppDemoHost,
  SITIO_PRINCIPAL_APEX,
} from '@/lib/whatsapp-template-demos'
import { enviarMensajeEvolution } from '@/lib/evolution'
import {
  selectNextSender,
  incrementMsgsToday,
  resetDailyCountersIfNeeded,
  markDisconnected,
} from '@/lib/sender-pool'

export const dynamic = 'force-dynamic'
export const maxDuration = 30  // bajamos: ahora es 1 envío por tick, no 10

const MAX_REINTENTOS_LEAD = 3
const MAX_REINTENTOS_POOL = 3   // si selectNext+increment falla por race
const MAX_FALLOS_CONSECUTIVOS = 10  // umbral para markDisconnected

// ─── Helpers (mover construirMensajePrimerContacto sin tocar) ────
// (copiar tal cual del archivo viejo)

// ─── Handler nuevo ────────────────────────────────────────────────
async function procesarUnTick(sup, forced): Promise<Record<string, unknown>> {
  // 1. Reset diario
  await resetDailyCountersIfNeeded(sup)

  // 2. Verificar ventana global y switch
  const { data: cfgActivo } = await sup
    .from('configuracion').select('valor').eq('clave', 'first_contact_activo').maybeSingle()
  if (cfgActivo?.valor !== 'true') return { status: 'skipped_first_contact_inactivo' }

  if (!forced && !estaEnVentanaPrimerContacto()) {
    return {
      status: 'fuera_de_ventana',
      hora_argentina: getHoraArgentina(),
      ventana: { inicio: PRIMER_CONTACTO_HORA_INICIO_AR, fin: PRIMER_CONTACTO_HORA_FIN_AR }
    }
  }

  // 3. Loop con reintentos por race condition del pool
  for (let intentoPool = 0; intentoPool < MAX_REINTENTOS_POOL; intentoPool++) {
    const sender = await selectNextSender(sup)
    if (!sender) {
      return { status: 'pool_agotado', intento: intentoPool + 1 }
    }

    // 4. Claim atómico de un lead disponible
    const leadResult = await claimYEnviarLead(sup, sender)

    if (leadResult.status === 'sin_pendientes') {
      return { status: 'sin_pendientes', sender_intentado: sender.alias }
    }

    if (leadResult.status === 'race_pool') {
      // El sender se nos escapó entre select e increment. Reintento.
      continue
    }

    return {
      ...leadResult,
      sender: { id: sender.id, alias: sender.alias, instance_name: sender.instance_name }
    }
  }

  return { status: 'race_pool_max_reintentos' }
}

async function claimYEnviarLead(sup, sender): Promise<Record<string, unknown>> {
  // Buscar candidato (igual que en cron viejo)
  const { data: candidatos } = await sup
    .from('leads')
    .select('*')
    .eq('origen', 'outbound')
    .eq('mensaje_enviado', false)
    .eq('estado', 'pendiente')
    .lt('primer_envio_intentos', MAX_REINTENTOS_LEAD)
    .not('telefono', 'is', null)
    .order('created_at', { ascending: true })
    .limit(50)

  // Para cada candidato, intentar claim → enviar (similar al viejo, pero solo 1 envío exitoso, después return)
  for (const lead of candidatos ?? []) {
    const verif = verificarNumeroWhatsApp(String(lead.telefono))
    if (!verif.valido) {
      await sup.from('leads').update({
        estado: 'descartado',
        primer_envio_error: verif.razon,
        primer_envio_fallido_at: new Date().toISOString(),
      }).eq('id', lead.id)
      continue
    }

    const telefono = verif.normalizado
    if (isTelefonoHardBlocked(telefono)) {
      await sup.from('leads').update({
        estado: 'descartado',
        primer_envio_error: 'telefono_bloqueado',
      }).eq('id', lead.id)
      continue
    }

    // Chequeos de duplicados (igual al viejo: yaConv, yaLead, yaConvPorLead)
    const telsMismaLinea = variantesTelefonoMismaLinea(telefono)
    const [{ data: yaConv }, { data: yaLead }] = await Promise.all([
      sup.from('conversaciones').select('id').in('telefono', telsMismaLinea).limit(1).maybeSingle(),
      sup.from('leads').select('id').in('telefono', telsMismaLinea).eq('mensaje_enviado', true).neq('id', lead.id).limit(1).maybeSingle(),
    ])
    if (yaConv || yaLead) {
      await sup.from('leads').update({
        estado: 'contactado',
        mensaje_enviado: true,
        primer_envio_error: 'telefono_ya_contactado',
      }).eq('id', lead.id)
      continue
    }

    // Lock atómico del lead (igual al viejo)
    const procesandoHasta = new Date(Date.now() + 5 * 60_000).toISOString()
    const { data: claimed } = await sup
      .from('leads')
      .update({ procesando_hasta: procesandoHasta })
      .eq('id', lead.id)
      .eq('mensaje_enviado', false)
      .eq('estado', 'pendiente')
      .or(`procesando_hasta.is.null,procesando_hasta.lt.${new Date().toISOString()}`)
      .select('id')
      .maybeSingle()

    if (!claimed) continue  // alguien más se lo llevó

    // INCREMENT ANTES de enviar (porque si el envío falla, sigue contando como intento de uso de la SIM
    // — ALTERNATIVA: incrementar después. Decisión: incrementar DESPUÉS del envío exitoso, así un fallo
    // de Evolution no consume cupo del día.)

    // Enviar
    try {
      const mensajeTexto = construirMensajePrimerContacto(lead)
      const result = await enviarMensajeEvolution(telefono, mensajeTexto, sender.instance_name)

      // Increment atómico DESPUÉS del envío exitoso
      const incrementOk = await incrementMsgsToday(sup, sender.id)
      if (!incrementOk) {
        // Race: el sender se desconectó o llegó al límite entre nuestro select y el increment.
        // El mensaje YA fue enviado, así que no hay rollback. Solo loggear.
        console.warn(`[cron] Race en increment tras envío exitoso. sender=${sender.id} lead=${lead.id}`)
      }

      // Insertar conversación (igual al viejo)
      await sup.from('conversaciones').insert({
        lead_id: lead.id,
        telefono,
        mensaje: mensajeTexto,
        rol: 'agente',
        tipo_mensaje: 'texto',
        manual: false,
        sender_id: sender.id,
        twilio_message_sid: result.messageId,
      })

      // Update lead
      await sup.from('leads').update({
        mensaje_enviado: true,
        estado: 'contactado',
        mensaje_inicial: mensajeTexto,
        primer_envio_completado_at: new Date().toISOString(),
        primer_envio_error: null,
        procesando_hasta: null,
      }).eq('id', lead.id)

      // Reset contador de fallos consecutivos del sender
      await sup.from('configuracion')
        .upsert({ clave: `${sender.instance_name}_primer_fallos`, valor: '0' }, { onConflict: 'clave' })

      return {
        status: 'ok',
        lead_id: lead.id,
        nombre: lead.nombre,
        message_id: result.messageId,
        race_increment: !incrementOk,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[cron] Error envío sender=${sender.instance_name} lead=${lead.id}:`, msg)

      // Update lead con error
      const nuevoIntentos = (lead.primer_envio_intentos ?? 0) + 1
      const esUltimoIntento = nuevoIntentos >= MAX_REINTENTOS_LEAD
      await sup.from('leads').update({
        primer_envio_intentos: nuevoIntentos,
        primer_envio_error: msg.slice(0, 500),
        procesando_hasta: null,
        ...(esUltimoIntento ? { estado: 'descartado', primer_envio_fallido_at: new Date().toISOString() } : {}),
      }).eq('id', lead.id)

      // Incrementar fallos consecutivos del sender
      const { data: cfgFallos } = await sup.from('configuracion').select('valor')
        .eq('clave', `${sender.instance_name}_primer_fallos`).maybeSingle()
      const fallosAntes = parseInt(cfgFallos?.valor ?? '0', 10) || 0
      const fallosAhora = fallosAntes + 1
      await sup.from('configuracion').upsert({
        clave: `${sender.instance_name}_primer_fallos`,
        valor: String(fallosAhora)
      }, { onConflict: 'clave' })

      // Si llegamos al umbral, marcar disconnected (NO desactivar — Manuel podrá reconectar desde UI)
      if (fallosAhora >= MAX_FALLOS_CONSECUTIVOS) {
        await markDisconnected(sup, sender.id)
        console.error(`[cron] sender ${sender.instance_name}: ${fallosAhora} fallos → markDisconnected`)
        return {
          status: 'sender_marcado_disconnected',
          sender_id: sender.id,
          fallos: fallosAhora,
          ultimo_error: msg,
        }
      }

      return { status: 'envio_fallido', lead_id: lead.id, error: msg, fallos_sender: fallosAhora }
    }
  }

  return { status: 'sin_pendientes' }
}

// ─── Handler ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const forced = req.nextUrl.searchParams.get('force') === 'true'
  const sup = createSupabaseServer()

  const result = await procesarUnTick(sup, forced)
  return NextResponse.json({ ok: true, tick: result })
}

export async function POST(req: NextRequest) {
  return GET(req)
}

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function construirMensajePrimerContacto(lead): string {
  // Copiar TAL CUAL del archivo viejo, sin cambios.
  const rating = extraerRatingParaPlantilla(lead.descripcion)
  const demoHost = resolveWhatsAppDemoHost(lead.rubro, lead.descripcion)
  return [
    `Hola ${lead.nombre}`,
    `Vi que tu negocio tiene ${rating}⭐ en Google Maps.`,
    `Hice este boceto para un negocio como el tuyo: ${demoHost}`,
    `Trabajo con negocios de ${lead.zona} haciendo páginas web para ${lead.rubro} - conocé mi trabajo en ${SITIO_PRINCIPAL_APEX}`,
    `¿Te lo armamos con tu marca?`,
  ].join('\n')
}
```

**Notas de implementación importantes:**
- El increment SÍ va DESPUÉS del envío exitoso (no antes). Razón: si Evolution falla, no consumimos cupo del día por algo que no se mandó.
- Race en increment después de envío exitoso → solo log, no rollback (el mensaje ya está). El siguiente tick recalcula igual.
- Las claves `${instance}_primer_fallos` en `tabla configuracion` se MANTIENEN — siguen siendo el contador de fallos consecutivos del sender. Solo `_primer_enviados_hoy` se deprecará en EVO-08 (la reemplazó `senders.msgs_today`).
- `_primer_next_slot_at` (cadencia per-sender) ya no se usa — el espaciado lo da el defasaje de los 5 crons. Se borra en EVO-08.

---

## TAREA 2 — Test smoke en dev (10 min)

Con dev server corriendo (`npm run dev` en `apex-leads/`):

```bash
# Asegurarse que first_contact_activo='true' en Supabase tabla configuracion
# Asegurarse que hay >= 5 leads pendientes en cola
# Asegurarse que hay >= 2 SIMs conectadas (msgs_today=0, daily_limit=15)

# Forzar 6 ticks consecutivos
for i in 1 2 3 4 5 6; do
  curl -s -X GET "http://localhost:3000/api/cron/leads-pendientes?force=true" \
    -H "Authorization: Bearer $CRON_SECRET" | jq .
  sleep 1
done

# Verificar en Supabase:
# - SELECT alias, msgs_today FROM senders WHERE provider='evolution';
# - Distribución debe ser tipo: SIM01=3, SIM02=3 (round-robin perfecto)
```

---

## Verificación final

- [ ] `cron/leads-pendientes/route.ts` reescrito.
- [ ] Smoke 6-tick verde con distribución round-robin verificada.
- [ ] Lógica de fallos consecutivos sigue funcionando (probar matando una SIM y verificando que tras 10 fallos se marca disconnected).
- [ ] `tsc --noEmit` sin errores.
- [ ] PROGRESS.md actualizado.
- [ ] Commit: `refactor(evolution): SESSION-EVO-06 — cron 1-msg-per-tick con sender-pool LRU`

---

## Fuera de scope

- Borrar `_primer_enviados_hoy` y `_primer_next_slot_at` de `tabla configuracion`. EVO-08.
- UI dashboard de capacidad. EVO-07.
- Tests Playwright. EVO-08.

---

## Al cerrar la sesión

1. PROGRESS.md update (EVO-06 completa, próxima EVO-07).
2. Commit en main.
3. Mostrar a Manuel: próxima sesión `SESSION-EVO-07.md`.
