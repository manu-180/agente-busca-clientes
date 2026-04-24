# SESSION-11 — Motor de outreach completo: run-cycle real + poll-inbox + auto-reply

> **Modelo recomendado:** Opus
> **Duración estimada:** 1-2 sesiones
> **Prerequisitos:** SESSION-10 completada — `DRY_RUN=false` en Vercel, sidecar Railway respondiendo `"session": "loaded"`, scheduler Railway activo, `instagram_leads_raw` con rows de Apify real.

---

## Contexto del proyecto

Estamos construyendo un agente de Instagram para boutiques de moda en Argentina. El stack es:
- **Next.js** (`apex-leads`) en Vercel — API routes, UI
- **FastAPI sidecar** (`ig-sidecar`) en Railway — instagrapi, sesión Instagram
- **Supabase** — DB, auth, storage (proyecto `hpbxscfbnhspeckdmkvu`)
- **Python scheduler** (`ig-scheduler`) en Railway — cron `0 12 * * *` (9 AM ART)
- **Apify** — scraper de Instagram por hashtag

**Gap crítico identificado:** `apex-leads/src/app/api/ig/run-cycle/route.ts` es actualmente un stub. Solo verifica auth y DRY_RUN — no hay lógica de outreach real. Esta sesión lo implementa completo.

Estado al inicio de esta sesión:
- Sidecar Railway: `https://ig-sidecar-production.up.railway.app` ✅
- Endpoints sidecar: `POST /dm/send`, `POST /inbox/poll`, `GET /health` ✅
- `stats/route.ts`: implementado con queries reales a Supabase ✅
- `pause/route.ts`: implementado ✅
- `run-cycle/route.ts`: **STUB — implementar en esta sesión** ❌
- `poll-inbox/route.ts`: **no existe — crear en esta sesión** ❌
- `DRY_RUN=false`, `DAILY_DM_LIMIT=3`, `IG_WARMUP_MODE=true`

El estado completo del proyecto está en `docs/ig/PROGRESS.md`.

---

## Objetivo de esta sesión

Implementar el motor completo de outreach de punta a punta:

1. **Auditar schema de DB** — verificar que todas las tablas necesarias existen en Supabase
2. **Implementar `run-cycle` completo** — lógica real de scoreo, envío de DMs, follow-up y quotas
3. **Implementar `poll-inbox/route.ts`** — capturar respuestas de leads desde el sidecar
4. **Implementar auto-reply básico con Claude** — respuesta inteligente cuando un lead contesta
5. **Test E2E en vivo** — disparar ciclo manual y verificar DMs + respuestas en Supabase
6. Actualizar `PROGRESS.md`

---

## Paso 1 — Auditar schema de DB en Supabase

El `stats/route.ts` referencia tablas que deben existir. Verificar en Supabase SQL Editor (proyecto `hpbxscfbnhspeckdmkvu`):

```sql
-- Verificar tablas existentes
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'instagram_leads_raw',
    'instagram_leads',
    'instagram_conversations',
    'dm_daily_quota',
    'dm_queue',
    'account_health_log'
  )
ORDER BY table_name;
```

### 1a. Tablas requeridas y su schema mínimo

Si alguna tabla falta, crearla. Schema de referencia:

```sql
-- instagram_leads_raw: leads crudos de Apify (ya debe existir de SESSION-07)
-- instagram_leads: leads procesados y calificados
CREATE TABLE IF NOT EXISTS instagram_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_username TEXT NOT NULL UNIQUE,
  business_name TEXT,
  business_category TEXT,
  lead_score INT DEFAULT 0,
  status TEXT DEFAULT 'new'
    CHECK (status IN ('new','contacted','follow_up_sent','replied','interested',
                      'meeting_booked','owner_takeover','closed','blacklisted')),
  first_dm_at TIMESTAMPTZ,
  last_dm_at TIMESTAMPTZ,
  last_reply_at TIMESTAMPTZ,
  reply_count INT DEFAULT 0,
  contacted_at TIMESTAMPTZ,
  raw_lead_id UUID REFERENCES instagram_leads_raw(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- instagram_conversations: historial de mensajes
CREATE TABLE IF NOT EXISTS instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES instagram_leads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON instagram_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_direction ON instagram_conversations(direction);

-- dm_daily_quota: control de límite diario
CREATE TABLE IF NOT EXISTS dm_daily_quota (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_ig_username TEXT NOT NULL,
  day DATE NOT NULL,
  dms_sent INT DEFAULT 0,
  UNIQUE (sender_ig_username, day)
);

-- dm_queue: cola de DMs pendientes (follow-ups programados)
CREATE TABLE IF NOT EXISTS dm_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES instagram_leads(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  type TEXT DEFAULT 'follow_up' CHECK (type IN ('follow_up','reply','reactivation')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- account_health_log: eventos de salud (circuit breaker, blocks, cooldowns)
CREATE TABLE IF NOT EXISTS account_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_ig TEXT NOT NULL,
  event TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  cooldown_until TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_log_sender ON account_health_log(sender_ig, occurred_at DESC);
```

### 1b. Verificar columnas de `instagram_leads_raw`

```sql
-- Ver columnas existentes
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'instagram_leads_raw'
ORDER BY ordinal_position;
```

El run-cycle necesita al menos: `id`, `ig_username`, `processed` (bool), `raw_data` (jsonb con datos de Apify), `scraped_at`.

Si falta la columna `processed`:
```sql
ALTER TABLE instagram_leads_raw ADD COLUMN IF NOT EXISTS processed BOOLEAN DEFAULT false;
ALTER TABLE instagram_leads_raw ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
```

---

## Paso 2 — Implementar `run-cycle` completo

Reemplazar el stub actual en `apex-leads/src/app/api/ig/run-cycle/route.ts`:

```typescript
// apex-leads/src/app/api/ig/run-cycle/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { igConfig } from '@/lib/ig/config'
import { callSidecar } from '@/lib/ig/sidecar'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Calcula un score 0-100 para un lead crudo de Apify
function scoreRawLead(rawData: Record<string, unknown>): number {
  let score = 0

  // Tiene bio con texto (señal de cuenta real)
  const bio = String(rawData.biography ?? rawData.bio ?? '')
  if (bio.length > 20) score += 15

  // Follower count (boutiques reales: 500-50k)
  const followers = Number(rawData.followersCount ?? rawData.followers_count ?? 0)
  if (followers >= 500 && followers <= 50_000) score += 25
  else if (followers > 50_000) score += 10 // cuentas grandes, menor conversión
  else if (followers >= 200) score += 10

  // Tiene posts (cuenta activa)
  const posts = Number(rawData.postsCount ?? rawData.media_count ?? 0)
  if (posts >= 10) score += 15
  else if (posts >= 3) score += 8

  // Link en bio (señal de negocio real)
  const externalUrl = rawData.externalUrl ?? rawData.external_url ?? rawData.website
  if (externalUrl) score += 20

  // Palabras clave en bio relacionadas con moda/boutique
  const fashionKeywords = ['boutique', 'moda', 'ropa', 'indumentaria', 'vestidos', 'tienda',
                           'fashion', 'store', 'envíos', 'colección', 'outlet', 'talle']
  const bioLower = bio.toLowerCase()
  const keywordHits = fashionKeywords.filter(kw => bioLower.includes(kw)).length
  score += Math.min(keywordHits * 8, 25)

  // Cuenta verificada (celebrity, menos relevante para outreach)
  if (rawData.verified) score -= 10

  // Cuenta privada (no podemos ver posts, menor confianza)
  if (rawData.isPrivate ?? rawData.is_private) score -= 5

  return Math.max(0, Math.min(100, score))
}

// Genera el mensaje de apertura personalizado
function buildOpeningDM(igUsername: string, rawData: Record<string, unknown>): string {
  const businessName = String(rawData.fullName ?? rawData.full_name ?? igUsername)
  const bio = String(rawData.biography ?? rawData.bio ?? '')

  // Template base — directo, sin florituras
  const templates = [
    `Hola ${businessName}! Vi tu cuenta y me pareció muy buena la propuesta. Estamos trabajando con boutiques como la tuya para conseguir más clientas por Instagram — sin inversión en ads. ¿Te interesa saber cómo?`,
    `Hola! Encontré ${businessName} buscando boutiques en IG. Tenemos un sistema que conecta boutiques locales con clientas nuevas usando IA. ¿Tienes 2 min para ver cómo funciona?`,
    `Hola ${businessName}! Trabajo con boutiques de moda ayudándoles a crecer en Instagram de forma orgánica. Vi tu perfil y creo que podrías aprovechar esto. ¿Te cuento más?`,
  ]

  // Seleccionar template basado en bio (si menciona envíos, etc.)
  if (bio.toLowerCase().includes('envío') || bio.toLowerCase().includes('todo el país')) {
    return `Hola ${businessName}! Vi que hacen envíos — eso es clave para escalar. Trabajamos con boutiques para conseguir más pedidos sin depender de ads. ¿Hablo con quien maneja el Instagram?`
  }

  // Template rotativo basado en hash del username para consistencia
  const idx = igUsername.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % templates.length
  return templates[idx]
}

async function checkCircuitBreaker(supabase: ReturnType<typeof supabaseAdmin>, senderIg: string): Promise<boolean> {
  const { data } = await supabase
    .from('account_health_log')
    .select('cooldown_until')
    .eq('sender_ig', senderIg)
    .not('cooldown_until', 'is', null)
    .gte('cooldown_until', new Date().toISOString())
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return !!data // true = circuit abierto, no enviar
}

async function getDailyQuota(supabase: ReturnType<typeof supabaseAdmin>, senderIg: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('dm_daily_quota')
    .select('dms_sent')
    .eq('sender_ig_username', senderIg)
    .eq('day', today)
    .maybeSingle()
  return data?.dms_sent ?? 0
}

async function incrementDailyQuota(supabase: ReturnType<typeof supabaseAdmin>, senderIg: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  await supabase.rpc('increment_dm_quota', { sender: senderIg, day_val: today })
    .throwOnError()
    .catch(async () => {
      // Fallback si la función RPC no existe: upsert manual
      const { data } = await supabase
        .from('dm_daily_quota')
        .select('id, dms_sent')
        .eq('sender_ig_username', senderIg)
        .eq('day', today)
        .maybeSingle()

      if (data) {
        await supabase
          .from('dm_daily_quota')
          .update({ dms_sent: (data.dms_sent ?? 0) + 1 })
          .eq('id', data.id)
      } else {
        await supabase
          .from('dm_daily_quota')
          .insert({ sender_ig_username: senderIg, day: today, dms_sent: 1 })
      }
    })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (token !== cronSecret) return unauthorized()

  const config = igConfig
  const supabase = supabaseAdmin()
  const senderIg = config.IG_SENDER_USERNAME
  const MIN_SCORE = 40

  // Verificar circuit breaker
  const circuitOpen = await checkCircuitBreaker(supabase, senderIg)
  if (circuitOpen) {
    console.log('[run-cycle] Circuit breaker OPEN — skipping cycle')
    return NextResponse.json({ ok: true, skipped: true, reason: 'circuit_open' })
  }

  // Verificar cuota diaria
  const dmsSentToday = await getDailyQuota(supabase, senderIg)
  const limit = config.DAILY_DM_LIMIT
  const remaining = Math.max(0, limit - dmsSentToday)

  if (remaining === 0) {
    console.log(`[run-cycle] Daily quota reached (${dmsSentToday}/${limit})`)
    return NextResponse.json({ ok: true, skipped: true, reason: 'quota_reached', quota: { sent: dmsSentToday, limit } })
  }

  // ── OUTREACH: nuevos leads ──────────────────────────────────────────────────

  // Leer leads crudos sin procesar
  const { data: rawLeads, error: rawError } = await supabase
    .from('instagram_leads_raw')
    .select('id, ig_username, raw_data')
    .eq('processed', false)
    .order('scraped_at', { ascending: true })
    .limit(remaining * 5) // traer más de los que vamos a mandar para poder filtrar

  if (rawError) {
    console.error('[run-cycle] Error fetching raw leads', rawError)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }

  // Scorear y filtrar
  const candidates = (rawLeads ?? [])
    .map(row => ({
      ...row,
      score: scoreRawLead(row.raw_data ?? {}),
    }))
    .filter(r => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, remaining)

  let outreachSent = 0
  let outreachSkipped = 0

  for (const candidate of candidates) {
    // Verificar que no existe ya como lead (deduplicar)
    const { data: existing } = await supabase
      .from('instagram_leads')
      .select('id')
      .eq('ig_username', candidate.ig_username)
      .maybeSingle()

    if (existing) {
      // Marcar raw como procesado (ya existía)
      await supabase.from('instagram_leads_raw').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', candidate.id)
      outreachSkipped++
      continue
    }

    const message = buildOpeningDM(candidate.ig_username, candidate.raw_data ?? {})

    // Enviar DM via sidecar
    let messageId: string
    try {
      const result = await callSidecar<{ message_id: string }>('/dm/send', {
        username: candidate.ig_username,
        text: message,
      })
      messageId = result.message_id
    } catch (err) {
      console.error(`[run-cycle] DM failed for @${candidate.ig_username}`, err)
      // Registrar evento de fallo en circuit breaker si es ActionBlocked
      const errMsg = String(err)
      if (errMsg.includes('ActionBlocked') || errMsg.includes('circuit_open')) {
        await supabase.from('account_health_log').insert({
          sender_ig: senderIg,
          event: 'action_blocked',
          payload: { username: candidate.ig_username, error: errMsg },
          cooldown_until: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), // 2h cooldown
        })
        break // Detener el ciclo — cuenta posiblemente bloqueada
      }
      outreachSkipped++
      continue
    }

    const now = new Date().toISOString()

    // Crear lead
    const { data: newLead } = await supabase.from('instagram_leads').insert({
      ig_username: candidate.ig_username,
      business_name: String((candidate.raw_data as Record<string,unknown>)?.fullName ?? candidate.ig_username),
      business_category: 'moda',
      lead_score: candidate.score,
      status: 'contacted',
      first_dm_at: now,
      last_dm_at: now,
      contacted_at: now,
      raw_lead_id: candidate.id,
      metadata: { score_breakdown: candidate.score },
    }).select('id').single()

    if (!newLead) {
      console.error(`[run-cycle] Failed to insert lead @${candidate.ig_username}`)
      outreachSkipped++
      continue
    }

    // Guardar conversación
    await supabase.from('instagram_conversations').insert({
      lead_id: newLead.id,
      direction: 'outbound',
      role: 'assistant',
      content: message,
      metadata: { message_id: messageId },
    })

    // Incrementar quota
    await incrementDailyQuota(supabase, senderIg)

    // Marcar raw como procesado
    await supabase.from('instagram_leads_raw').update({ processed: true, processed_at: now }).eq('id', candidate.id)

    // Programar follow-up
    const followupHours = config.FOLLOWUP_HOURS
    const followupAt = new Date(Date.now() + followupHours * 3600 * 1000).toISOString()
    await supabase.from('dm_queue').insert({
      lead_id: newLead.id,
      message: `Hola! Te escribí hace ${followupHours}h. ¿Pudiste ver mi mensaje? Con gusto te cuento más 😊`,
      scheduled_at: followupAt,
      type: 'follow_up',
    })

    outreachSent++
    console.log(`[run-cycle] DM sent to @${candidate.ig_username} (score=${candidate.score}, msg_id=${messageId})`)
  }

  // ── FOLLOW-UP: leads que no respondieron ──────────────────────────────────

  const followupCandidates = remaining - outreachSent
  let followupSent = 0
  let ghostedClosed = 0

  if (followupCandidates > 0) {
    const { data: pendingFollowups } = await supabase
      .from('dm_queue')
      .select('id, lead_id, message')
      .is('sent_at', null)
      .lte('scheduled_at', new Date().toISOString())
      .limit(followupCandidates)

    for (const item of pendingFollowups ?? []) {
      // Verificar estado actual del lead (puede haber respondido ya)
      const { data: lead } = await supabase
        .from('instagram_leads')
        .select('ig_username, status, reply_count')
        .eq('id', item.lead_id)
        .single()

      if (!lead || ['replied', 'interested', 'meeting_booked', 'owner_takeover', 'closed', 'blacklisted'].includes(lead.status)) {
        // No hacer follow-up si ya respondió o está cerrado
        await supabase.from('dm_queue').update({ sent_at: new Date().toISOString() }).eq('id', item.id)
        continue
      }

      // Verificar cuota antes de cada follow-up
      const currentSent = await getDailyQuota(supabase, senderIg)
      if (currentSent >= limit) break

      let followupMessageId: string
      try {
        const result = await callSidecar<{ message_id: string }>('/dm/send', {
          username: lead.ig_username,
          text: item.message,
        })
        followupMessageId = result.message_id
      } catch (err) {
        console.error(`[run-cycle] Follow-up failed for @${lead.ig_username}`, err)
        const errMsg = String(err)
        if (errMsg.includes('ActionBlocked')) {
          await supabase.from('account_health_log').insert({
            sender_ig: senderIg,
            event: 'action_blocked',
            payload: { username: lead.ig_username, error: errMsg },
            cooldown_until: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
          })
          break
        }
        continue
      }

      const now = new Date().toISOString()

      await supabase.from('instagram_conversations').insert({
        lead_id: item.lead_id,
        direction: 'outbound',
        role: 'assistant',
        content: item.message,
        metadata: { message_id: followupMessageId, type: 'follow_up' },
      })

      await supabase.from('instagram_leads').update({
        status: 'follow_up_sent',
        last_dm_at: now,
        updated_at: now,
      }).eq('id', item.lead_id)

      await supabase.from('dm_queue').update({ sent_at: now }).eq('id', item.id)
      await incrementDailyQuota(supabase, senderIg)
      followupSent++
    }

    // Cerrar leads que ya recibieron follow-up y siguen sin responder
    const { data: ghosts } = await supabase
      .from('instagram_leads')
      .select('id')
      .eq('status', 'follow_up_sent')
      .lt('last_dm_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()) // 7 días sin respuesta

    if ((ghosts?.length ?? 0) > 0) {
      await supabase
        .from('instagram_leads')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .in('id', ghosts!.map(g => g.id))
      ghostedClosed = ghosts!.length
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: false,
    outreach: { sent: outreachSent, skipped: outreachSkipped },
    followup: { sent: followupSent, ghosted_closed: ghostedClosed },
    quota: { sent_today: dmsSentToday + outreachSent + followupSent, limit },
  })
}
```

### 2a. Verificar que `callSidecar` y `igConfig` están correctos

El run-cycle usa `callSidecar` de `@/lib/ig/sidecar`. Verificar que la función firma los requests con `IG_SIDECAR_SECRET` via HMAC antes de llamar al sidecar (SESSION-02 estableció este contrato).

Si `callSidecar` no existe o es stub, implementar en `apex-leads/src/lib/ig/sidecar.ts`:

```typescript
// apex-leads/src/lib/ig/sidecar.ts
import { igConfig } from './config'
import crypto from 'crypto'

export class SidecarError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'SidecarError'
  }
}

export async function callSidecar<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${igConfig.IG_SIDECAR_URL}${path}`
  const payload = JSON.stringify(body)
  const sig = crypto
    .createHmac('sha256', igConfig.IG_SIDECAR_SECRET)
    .update(payload)
    .digest('hex')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sidecar-Signature': `sha256=${sig}`,
    },
    body: payload,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown')
    throw new SidecarError(res.status, `Sidecar ${path} → ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}
```

---

## Paso 3 — Implementar `poll-inbox/route.ts`

Crear el endpoint que sondea el sidecar por respuestas de leads y las persiste en Supabase:

```typescript
// apex-leads/src/app/api/ig/poll-inbox/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callSidecar } from '@/lib/ig/sidecar'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  if (token !== cronSecret) return unauthorized()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Determinar timestamp desde cuándo buscar (último mensaje inbound recibido)
  const { data: lastInbound } = await supabase
    .from('instagram_conversations')
    .select('created_at')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const since = lastInbound?.created_at
    ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  // Llamar al sidecar
  let inboxResult: { messages: Array<{ ig_username: string; text: string; timestamp: string; message_id: string }> }
  try {
    inboxResult = await callSidecar<typeof inboxResult>('/inbox/poll', { since })
  } catch (err) {
    console.error('[poll-inbox] sidecar error', err)
    return NextResponse.json({ ok: false, error: 'sidecar_error' }, { status: 502 })
  }

  const messages = inboxResult.messages ?? []
  let inserted = 0
  const newReplies: string[] = []

  for (const msg of messages) {
    if (!msg.text?.trim()) continue

    // Buscar lead correspondiente
    const { data: lead } = await supabase
      .from('instagram_leads')
      .select('id, status, reply_count')
      .eq('ig_username', msg.ig_username)
      .maybeSingle()

    if (!lead) continue // mensaje de alguien que no está en el pipeline

    // Deduplicar por message_id
    const { data: existing } = await supabase
      .from('instagram_conversations')
      .select('id')
      .eq('metadata->>message_id', msg.message_id)
      .maybeSingle()

    if (existing) continue

    // Insertar mensaje inbound
    await supabase.from('instagram_conversations').insert({
      lead_id: lead.id,
      direction: 'inbound',
      role: 'user',
      content: msg.text,
      metadata: { message_id: msg.message_id, timestamp: msg.timestamp },
    })

    // Actualizar lead: status + reply_count
    const newReplyCount = (lead.reply_count ?? 0) + 1
    await supabase.from('instagram_leads').update({
      status: lead.status === 'contacted' || lead.status === 'follow_up_sent' ? 'replied' : lead.status,
      reply_count: newReplyCount,
      last_reply_at: msg.timestamp,
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id)

    newReplies.push(msg.ig_username)
    inserted++
  }

  console.log(`[poll-inbox] found=${messages.length} inserted=${inserted} new_replies=${newReplies.join(',')}`)
  return NextResponse.json({ ok: true, messages_found: messages.length, inserted, new_replies: newReplies })
}
```

---

## Paso 4 — Implementar auto-reply básico con Claude

Cuando `poll-inbox` encuentra una respuesta de un lead con status `replied`, disparar un auto-reply inteligente con Claude.

Crear `apex-leads/src/lib/ig/auto-reply.ts`:

```typescript
// apex-leads/src/lib/ig/auto-reply.ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function generateReply(
  igUsername: string,
  conversationHistory: ConversationMessage[],
  leadScore: number
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[auto-reply] ANTHROPIC_API_KEY not set — skipping')
    return null
  }

  const systemPrompt = `Sos el agente de ventas de APEX para boutiques de moda en Argentina.
Tu objetivo: agendar una demo o una llamada para mostrar cómo el sistema consigue clientas nuevas por Instagram sin ads.

Reglas:
- Tono: amigable, directo, sin bullshit
- Mensajes cortos (máximo 3 oraciones)
- Si preguntan el precio, decir "depende del plan — preferible que lo veamos en una llamada de 15 min"
- Si dicen que no les interesa, agradecerles y cerrar con clase
- Si muestran interés, proponer llamada: "¿Tenés 15 min esta semana para verlo?"
- No usar emojis en exceso (máximo 1 por mensaje)
- Escribir en español argentino informal (vos, che, etc.)
- Si preguntan qué hace el sistema: "conecta tu boutique con clientas nuevas usando IA que analiza Instagram"

Lead score: ${leadScore}/100 (mayor score = más interés probable)`

  const messages = conversationHistory.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', // Haiku: rápido y barato para replies
      max_tokens: 200,
      system: systemPrompt,
      messages,
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : null
    return text?.trim() ?? null
  } catch (err) {
    console.error('[auto-reply] Claude API error', err)
    return null
  }
}
```

Luego, en `poll-inbox/route.ts`, después de insertar el mensaje inbound, agregar el auto-reply:

```typescript
// Agregar al final del loop en poll-inbox, después de insertar mensaje:
if (inserted > 0 && process.env.ANTHROPIC_API_KEY) {
  // Traer historial completo del lead
  const { data: history } = await supabase
    .from('instagram_conversations')
    .select('role, content')
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: true })

  if (history && history.length > 0) {
    const reply = await generateReply(
      msg.ig_username,
      history as Array<{ role: 'user' | 'assistant'; content: string }>,
      lead.lead_score ?? 50
    )

    if (reply) {
      try {
        const replyResult = await callSidecar<{ message_id: string }>('/dm/send', {
          username: msg.ig_username,
          text: reply,
        })

        await supabase.from('instagram_conversations').insert({
          lead_id: lead.id,
          direction: 'outbound',
          role: 'assistant',
          content: reply,
          metadata: { message_id: replyResult.message_id, type: 'auto_reply' },
        })

        // Si el lead responde con interés, subir status
        await supabase.from('instagram_leads').update({
          status: 'interested',
          updated_at: new Date().toISOString(),
        }).eq('id', lead.id)
          .eq('status', 'replied') // solo si sigue en 'replied'

        console.log(`[poll-inbox] auto-reply sent to @${msg.ig_username}`)
      } catch (err) {
        console.error(`[poll-inbox] auto-reply send failed for @${msg.ig_username}`, err)
      }
    }
  }
}
```

> **Nota:** El auto-reply inicial puede ser conservador — si preferís revisar manualmente las respuestas antes de activarlo, setear `AUTO_REPLY=false` como env var y agregar el check en `poll-inbox`.

---

## Paso 5 — Agregar poll-inbox al scheduler

Después de `run-cycle`, el scheduler también debe llamar a `poll-inbox`. Actualizar `sidecar/scheduler/scheduler.py`:

```python
# sidecar/scheduler/scheduler.py — agregar poll-inbox call después de run-cycle
import httpx, os, sys

NEXT_APP_URL = os.environ["NEXT_APP_URL"].rstrip("/")
CRON_SECRET = os.environ["CRON_SECRET"]
HEADERS = {"Authorization": f"Bearer {CRON_SECRET}"}

def call(path: str, label: str) -> bool:
    url = f"{NEXT_APP_URL}{path}"
    print(f"[scheduler] POST {url}", flush=True)
    try:
        r = httpx.post(url, headers=HEADERS, timeout=120)
        print(f"[scheduler] {label}: {r.status_code} {r.text[:300]}", flush=True)
        return r.status_code == 200
    except Exception as e:
        print(f"[scheduler] {label} ERROR: {e}", flush=True)
        return False

if __name__ == "__main__":
    ok = call("/api/ig/run-cycle", "run-cycle")
    call("/api/ig/poll-inbox", "poll-inbox")  # siempre correr, independiente del resultado anterior
    sys.exit(0 if ok else 1)
```

---

## Paso 6 — Test E2E completo

### 6a. Verificar schema en Supabase

```sql
-- Confirmar que todas las tablas existen y tienen datos
SELECT 'instagram_leads_raw' as t, count(*) as rows FROM instagram_leads_raw
UNION ALL SELECT 'instagram_leads', count(*) FROM instagram_leads
UNION ALL SELECT 'instagram_conversations', count(*) FROM instagram_conversations
UNION ALL SELECT 'dm_daily_quota', count(*) FROM dm_daily_quota
UNION ALL SELECT 'dm_queue', count(*) FROM dm_queue
UNION ALL SELECT 'account_health_log', count(*) FROM account_health_log;
```

### 6b. Verificar sidecar health

```bash
curl -s https://ig-sidecar-production.up.railway.app/health | python -m json.tool
# Esperado: {"status": "ok", "session": "loaded", ...}
```

### 6c. Disparar run-cycle manual

```bash
VERCEL_URL=https://<tu-app>.vercel.app
CRON_SECRET=cba5184565ea5a17e01da6391dd9caf323e4fc97e2083f26c80c2b2f56f81bab

curl -s -X POST "$VERCEL_URL/api/ig/run-cycle" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Respuesta esperada:
```json
{
  "ok": true,
  "dry_run": false,
  "outreach": { "sent": 3, "skipped": 2 },
  "followup": { "sent": 0, "ghosted_closed": 0 },
  "quota": { "sent_today": 3, "limit": 3 }
}
```

### 6d. Verificar en Supabase

```sql
-- DMs enviados con message_id real
SELECT
  l.ig_username,
  l.lead_score,
  l.status,
  l.first_dm_at,
  c.metadata->>'message_id' AS message_id,
  LEFT(c.content, 120) AS dm_preview
FROM instagram_leads l
JOIN instagram_conversations c ON c.lead_id = l.id AND c.direction = 'outbound'
ORDER BY l.first_dm_at DESC
LIMIT 10;

-- Quota del día
SELECT * FROM dm_daily_quota WHERE day = CURRENT_DATE;
```

Verificar:
- `message_id` es alfanumérico real (no `dry-run-...`)
- `lead_score` es mayor a 40
- `dm_preview` tiene el mensaje correcto

### 6e. Verificar en Instagram

Abrir la app de Instagram con `@apex.stack` → revisar DMs salientes. Deben coincidir con los usernames de la query anterior.

### 6f. Test de poll-inbox

```bash
curl -s -X POST "$VERCEL_URL/api/ig/poll-inbox" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  | python -m json.tool
```

Si hay respuestas de leads desde el último `since`, aparecerán en `new_replies`.

---

## Paso 7 — Deploy y cierre de sesión

```bash
cd apex-leads
git add \
  src/app/api/ig/run-cycle/route.ts \
  src/app/api/ig/poll-inbox/route.ts \
  src/lib/ig/sidecar.ts \
  src/lib/ig/auto-reply.ts \
  docs/ig/PROGRESS.md
git commit -m "feat(ig): run-cycle real + poll-inbox + auto-reply con Claude SESSION-11"
git push origin master
```

Si el scheduler fue actualizado:
```bash
git add sidecar/scheduler/scheduler.py
git commit -m "feat(scheduler): add poll-inbox call after run-cycle"
git push origin master
```

Actualizar env vars en Vercel si `AUTO_REPLY` es una nueva variable.

---

## Criterios de éxito

1. Todas las tablas de DB existen con schema correcto ✅
2. `run-cycle` implementado — responde `{"ok": true, "outreach": {"sent": N}}` con `N > 0` ✅
3. DMs enviados tienen `message_id` real en `instagram_conversations` ✅
4. DMs visibles en inbox de `@apex.stack` en Instagram ✅
5. `poll-inbox` creado — responde `{"ok": true}` ✅
6. Auto-reply con Claude funciona cuando lead responde ✅
7. Scheduler llama a `run-cycle` + `poll-inbox` en secuencia ✅
8. `PROGRESS.md` actualizado con estado real del pipeline ✅

---

## Archivos modificados en esta sesión

- `apex-leads/src/app/api/ig/run-cycle/route.ts` — implementación completa (reemplaza stub)
- `apex-leads/src/app/api/ig/poll-inbox/route.ts` — nuevo endpoint
- `apex-leads/src/lib/ig/sidecar.ts` — `callSidecar` completo si era stub
- `apex-leads/src/lib/ig/auto-reply.ts` — nuevo módulo Claude
- `sidecar/scheduler/scheduler.py` — agregar poll-inbox call
- `docs/ig/PROGRESS.md` — actualizar estado

## Archivos de referencia

- `docs/ig/PROGRESS.md` — estado completo, env vars, decisiones
- `apex-leads/src/lib/ig/config.ts` — `igConfig` con `DAILY_DM_LIMIT`, `FOLLOWUP_HOURS`, `DRY_RUN`, `IG_WARMUP_MODE`
- `apex-leads/src/app/api/ig/stats/route.ts` — queries Supabase de referencia
- `apex-leads/src/app/api/ig/pause/route.ts` — pausa de emergencia
- `sidecar/app/routes/dm.py` — endpoint `/dm/send` del sidecar
- `sidecar/app/routes/inbox.py` — endpoint `/inbox/poll` del sidecar
- `docs/ig/SIDECAR-CONTRACT.md` — contrato HTTP del sidecar (HMAC, headers)
