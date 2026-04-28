/**
 * GET /api/agente/diagnostico
 *
 * Endpoint de diagnóstico para verificar rápidamente por qué el agente
 * no responde. Requiere header Authorization: Bearer <ADMIN_PASSWORD>.
 *
 * Verifica:
 *  - Variables de entorno críticas
 *  - Config en Supabase (agente_activo, decision_engine_enabled, etc.)
 *  - Conectividad con Anthropic (ping rápido)
 *  - Últimos errores en conversational_events
 *  - Estadísticas de leads y conversaciones recientes
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function autenticar(req: NextRequest): boolean {
  const pwd = process.env.ADMIN_PASSWORD
  if (!pwd) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${pwd}` || auth === pwd
}

async function pingAnthropic(apiKey: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now()
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    const ms = Date.now() - t0
    if (res.ok) return { ok: true, ms }
    const body = await res.text()
    return { ok: false, ms, error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e) }
  }
}

export async function GET(req: NextRequest) {
  if (!autenticar(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()
  const ahora = new Date()
  const hace1h = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // ── Env vars ──────────────────────────────────────────────────────────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? ''
  const evolutionUrl = process.env.EVOLUTION_API_URL ?? ''
  const evolutionKey = process.env.EVOLUTION_API_KEY ?? ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const envVars = {
    ANTHROPIC_API_KEY: anthropicKey ? `SET (${anthropicKey.slice(0, 12)}...)` : 'FALTA',
    EVOLUTION_API_URL: evolutionUrl || 'FALTA',
    EVOLUTION_API_KEY: evolutionKey ? 'SET' : 'FALTA',
    SUPABASE_URL: supabaseUrl ? `SET ${supabaseUrl}` : 'FALTA',
    APP_URL: appUrl || 'NO SETEADA (usa default leads.theapexweb.com)',
    NODE_ENV: process.env.NODE_ENV ?? '?',
  }

  // ── Config Supabase ────────────────────────────────────────────────────────
  const { data: configs } = await supabase
    .from('configuracion')
    .select('clave, valor')
    .in('clave', [
      'agente_activo',
      'first_contact_activo',
      'decision_engine_enabled',
      'emoji_no_reply_enabled',
      'conversation_auto_close_enabled',
    ])

  const configMap: Record<string, string> = {}
  for (const c of configs ?? []) {
    configMap[c.clave] = c.valor
  }

  const configDiag = {
    agente_activo: configMap['agente_activo'] === 'true' ? '✅ true' : `❌ "${configMap['agente_activo'] ?? 'NO EXISTE'}"`,
    first_contact_activo: configMap['first_contact_activo'] === 'true' ? '✅ true' : `⚠️ "${configMap['first_contact_activo'] ?? 'NO EXISTE'}"`,
    decision_engine_enabled: configMap['decision_engine_enabled'] ?? 'default=true',
    emoji_no_reply_enabled: configMap['emoji_no_reply_enabled'] ?? 'default=true',
    conversation_auto_close_enabled: configMap['conversation_auto_close_enabled'] ?? 'default=true',
  }

  // ── Ping Anthropic ─────────────────────────────────────────────────────────
  const anthropicPing = anthropicKey
    ? await pingAnthropic(anthropicKey)
    : { ok: false, ms: 0, error: 'API key no configurada' }

  // ── Últimos errores del webhook (última 1h) ────────────────────────────────
  const { data: errores } = await supabase
    .from('conversational_events')
    .select('created_at, lead_id, telefono, metadata')
    .eq('event_name', 'webhook_error')
    .gte('created_at', hace1h)
    .order('created_at', { ascending: false })
    .limit(10)

  // ── Estadísticas de respuestas últimas 24h ────────────────────────────────
  const { data: eventStats } = await supabase
    .from('conversational_events')
    .select('event_name')
    .gte('created_at', hace24h)

  const eventCounts: Record<string, number> = {}
  for (const e of eventStats ?? []) {
    eventCounts[e.event_name] = (eventCounts[e.event_name] ?? 0) + 1
  }

  // ── Leads en estado "respondio" sin respuesta agente (últimas 24h) ─────────
  const { data: leadsRespondio } = await supabase
    .from('leads')
    .select('id, nombre, telefono, created_at, agente_activo')
    .eq('estado', 'respondio')
    .gte('created_at', hace24h)
    .order('created_at', { ascending: false })
    .limit(20)

  // ── Leads con lock atascado (procesando_hasta en el pasado hace > 5min) ───
  const hace5min = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data: locksAtascados } = await supabase
    .from('leads')
    .select('id, nombre, procesando_hasta')
    .not('procesando_hasta', 'is', null)
    .lt('procesando_hasta', hace5min)
    .limit(10)

  // ── Últimas conversaciones del agente ─────────────────────────────────────
  const { data: ultimasRespuestas } = await supabase
    .from('conversaciones')
    .select('lead_id, mensaje, timestamp, manual')
    .eq('rol', 'agente')
    .eq('manual', false)
    .gte('timestamp', hace24h)
    .order('timestamp', { ascending: false })
    .limit(5)

  const resultado = {
    timestamp: ahora.toISOString(),
    env_vars: envVars,
    config_supabase: configDiag,
    anthropic_ping: {
      ...anthropicPing,
      status: anthropicPing.ok ? `✅ OK (${anthropicPing.ms}ms)` : `❌ FALLA: ${anthropicPing.error}`,
    },
    errores_webhook_ultima_hora: errores ?? [],
    eventos_ultimas_24h: Object.entries(eventCounts)
      .sort(([, a], [, b]) => b - a)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as Record<string, number>),
    leads_respondio_sin_respuesta: (leadsRespondio ?? []).map(l => ({
      id: l.id,
      nombre: l.nombre,
      agente_activo: l.agente_activo,
    })),
    locks_atascados: locksAtascados ?? [],
    ultimas_respuestas_agente: (ultimasRespuestas ?? []).map(r => ({
      lead_id: r.lead_id,
      preview: (r.mensaje as string)?.slice(0, 80),
      timestamp: r.timestamp,
    })),
    resumen: {
      agente_global_activo: configMap['agente_activo'] === 'true',
      evolution_configurado: !!(evolutionUrl && evolutionKey),
    anthropic_ok: anthropicPing.ok,
      errores_recientes: (errores ?? []).length,
      respuestas_ultimas_24h: eventCounts['full_reply_sent'] ?? 0,
      fallbacks_ultimas_24h: eventCounts['fallback_message_sent'] ?? 0,
    },
  }

  return NextResponse.json(resultado, { status: 200 })
}

/**
 * POST /api/agente/diagnostico
 * Fuerza la limpieza de locks atascados.
 */
export async function POST(req: NextRequest) {
  if (!autenticar(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()
  const hace5min = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data: limpiados, error } = await supabase
    .from('leads')
    .update({ procesando_hasta: null })
    .not('procesando_hasta', 'is', null)
    .lt('procesando_hasta', hace5min)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    locks_limpiados: (limpiados ?? []).length,
    ids: (limpiados ?? []).map(l => l.id),
  })
}
