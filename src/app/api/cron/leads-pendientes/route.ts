import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { enviarMensajeWassenger, enviarVideoWassengerConReintentos } from '@/lib/wassenger'
import { generarPrimerMensaje } from '@/lib/generar-primer-mensaje'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Argentina = UTC-3 (no DST). Si cambia, ajustar.
const TZ_OFFSET_HOURS_AR = -3
const LEADS_TABLE = 'leads_apex_next'

type SupabaseClient = ReturnType<typeof createSupabaseServer>

interface LeadColaRow {
  id: string
  nombre: string
  rubro: string
  zona: string
  telefono: string
  instagram: string | null
  descripcion: string
  mensaje_inicial: string
  estado: string
  origen: string
  mensaje_enviado: boolean
  video_enviado: boolean
  primer_envio_intentos: number
  primer_envio_error: string | null
  primer_envio_completado_at: string | null
}

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

function horaArActual(): number {
  let hora = new Date().getUTCHours() + TZ_OFFSET_HOURS_AR
  if (hora < 0) hora += 24
  if (hora >= 24) hora -= 24
  return hora
}

// 00:00 hora AR del día actual, como Date UTC
function inicioDelDiaArUtc(): Date {
  const ahoraUtcMs = Date.now()
  const offsetMs = TZ_OFFSET_HOURS_AR * 60 * 60 * 1000
  const ahoraArMs = ahoraUtcMs + offsetMs
  const diaArMs = Math.floor(ahoraArMs / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
  return new Date(diaArMs - offsetMs)
}

function minAleatorio(minMin: number, maxMin: number): number {
  if (maxMin < minMin) return minMin
  return Math.floor(Math.random() * (maxMin - minMin + 1)) + minMin
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function leerConfig(
  supabase: SupabaseClient,
  clave: string,
  porDefecto: string
): Promise<string> {
  const { data } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', clave)
    .maybeSingle()
  return data?.valor ?? porDefecto
}

async function leerConfigInt(
  supabase: SupabaseClient,
  clave: string,
  porDefecto: number
): Promise<number> {
  const v = await leerConfig(supabase, clave, String(porDefecto))
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : porDefecto
}

async function escribirConfig(
  supabase: SupabaseClient,
  clave: string,
  valor: string
): Promise<void> {
  await supabase.from('configuracion').upsert({ clave, valor }, { onConflict: 'clave' })
}

async function actualizarLead(
  supabase: SupabaseClient,
  id: string,
  updates: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from(LEADS_TABLE).update(updates).eq('id', id)
  if (error) {
    console.error('[cron leads-pendientes] Error update lead:', error.message)
  }
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseServer()

  // 1. ¿Está activado el sistema?
  const activo = await leerConfig(supabase, 'first_contact_activo', 'true')
  if (activo !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'first_contact_inactivo' })
  }

  // 2. Ventana horaria (hora AR) — TEMPORALMENTE DESACTIVADA
  // const hora = horaArActual()
  // const horaInicio = await leerConfigInt(supabase, 'first_contact_hora_inicio', 9)
  // const horaFin = await leerConfigInt(supabase, 'first_contact_hora_fin', 21)
  // if (hora < horaInicio || hora >= horaFin) {
  //   return NextResponse.json({
  //     ok: true,
  //     skipped: 'fuera_de_horario',
  //     hora_ar: hora,
  //     ventana: `${horaInicio}-${horaFin}`,
  //   })
  // }

  // 3. Límite diario
  const limiteDiario = await leerConfigInt(supabase, 'first_contact_limite_diario', 30)
  const inicioDiaUtc = inicioDelDiaArUtc().toISOString()

  const { count: enviadosHoy } = await supabase
    .from(LEADS_TABLE)
    .select('*', { count: 'exact', head: true })
    .gte('primer_envio_completado_at', inicioDiaUtc)

  const yaEnviados = enviadosHoy ?? 0
  if (yaEnviados >= limiteDiario) {
    return NextResponse.json({
      ok: true,
      skipped: 'limite_diario_alcanzado',
      enviados_hoy: yaEnviados,
      limite: limiteDiario,
    })
  }

  // 4. Slot de cadencia (próximo envío)
  const nextSlotStr = await leerConfig(
    supabase,
    'first_contact_next_slot_at',
    '1970-01-01T00:00:00.000Z'
  )
  const nextSlotMs = new Date(nextSlotStr).getTime()
  if (Number.isFinite(nextSlotMs) && nextSlotMs > Date.now()) {
    const faltanMin = Math.ceil((nextSlotMs - Date.now()) / 60000)
    return NextResponse.json({
      ok: true,
      skipped: 'slot_no_alcanzado',
      next_slot_at: nextSlotStr,
      faltan_min: faltanMin,
    })
  }

  // 5. Tomar lead pendiente más antiguo
  const maxReintentos = await leerConfigInt(supabase, 'first_contact_max_reintentos', 3)
  const { data: leadData, error: errLead } = await supabase
    .from(LEADS_TABLE)
    .select('*')
    .eq('origen', 'outbound')
    .eq('mensaje_enviado', false)
    .eq('estado', 'pendiente')
    .lt('primer_envio_intentos', maxReintentos)
    .not('telefono', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (errLead) {
    return NextResponse.json({ error: `db: ${errLead.message}` }, { status: 500 })
  }

  const lead = leadData as LeadColaRow | null
  if (!lead) {
    return NextResponse.json({ ok: true, skipped: 'sin_pendientes' })
  }

  const telefono = String(lead.telefono).replace(/\D/g, '')
  if (!telefono) {
    await actualizarLead(supabase, lead.id, {
      estado: 'descartado',
      primer_envio_error: 'telefono_invalido',
    })
    return NextResponse.json({ ok: false, skipped: 'telefono_invalido', lead_id: lead.id })
  }

  // 6. Generar mensaje si todavía no hay
  let mensaje = (lead.mensaje_inicial ?? '').trim()
  if (!mensaje) {
    const generado = await generarPrimerMensaje({
      nombre: lead.nombre,
      rubro: lead.rubro,
      zona: lead.zona,
      descripcion: lead.descripcion,
      instagram: lead.instagram,
    })

    if (!generado) {
      await actualizarLead(supabase, lead.id, {
        primer_envio_intentos: (lead.primer_envio_intentos ?? 0) + 1,
        primer_envio_error: 'generar_mensaje_fallo',
      })
      return NextResponse.json({
        ok: false,
        lead_id: lead.id,
        error: 'no_se_generó_mensaje',
      })
    }

    mensaje = generado
    await actualizarLead(supabase, lead.id, { mensaje_inicial: mensaje })
  }

  // 7. Enviar texto
  try {
    await enviarMensajeWassenger(telefono, mensaje)
    await actualizarLead(supabase, lead.id, {
      mensaje_enviado: true,
      primer_envio_error: null,
    })
    await supabase.from('conversaciones').insert({
      lead_id: lead.id,
      telefono,
      mensaje,
      rol: 'agente',
      tipo_mensaje: 'texto',
      manual: false,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron leads-pendientes] Error enviando texto:', msg)
    await actualizarLead(supabase, lead.id, {
      primer_envio_intentos: (lead.primer_envio_intentos ?? 0) + 1,
      primer_envio_error: `texto: ${msg}`.slice(0, 500),
    })
    // NO avanzamos el slot: el próximo tick reintenta
    return NextResponse.json({
      ok: false,
      lead_id: lead.id,
      error: 'texto_fallo',
      detalle: msg,
    })
  }

  // 8. Pausa humana antes del video (2-4s)
  await sleep(2000 + Math.floor(Math.random() * 2000))

  // 9. Enviar video (con reintentos internos). No bloquea si falla.
  const videoUrl = process.env.VIDEO_PAGINA_URL
  let videoOk = false
  let videoError: string | null = null

  if (videoUrl) {
    const resultadoVideo = await enviarVideoWassengerConReintentos(telefono, videoUrl, 3)
    videoOk = resultadoVideo.ok
    videoError = resultadoVideo.error ?? null

    if (videoOk) {
      await actualizarLead(supabase, lead.id, { video_enviado: true })
      await supabase.from('conversaciones').insert({
        lead_id: lead.id,
        telefono,
        mensaje: '[VIDEO] Demo de landing — enviado automáticamente',
        rol: 'agente',
        tipo_mensaje: 'otro',
        manual: false,
      })
    } else {
      console.error(
        `[cron leads-pendientes] Video falló tras ${resultadoVideo.intentos} intentos:`,
        videoError
      )
      await actualizarLead(supabase, lead.id, {
        primer_envio_error: `video: ${videoError}`.slice(0, 500),
      })
    }
  } else {
    console.warn('[cron leads-pendientes] VIDEO_PAGINA_URL no configurada, salteando video')
  }

  // 10. Primer contacto completado (texto enviado = contactado, aunque el video falle)
  await actualizarLead(supabase, lead.id, {
    estado: 'contactado',
    primer_envio_completado_at: new Date().toISOString(),
  })

  // 11. Avanzar slot para próximo envío (10-15 min por defecto)
  const intMin = await leerConfigInt(supabase, 'first_contact_intervalo_min_min', 10)
  const intMax = await leerConfigInt(supabase, 'first_contact_intervalo_max_min', 15)
  const proximoMin = minAleatorio(intMin, intMax)
  const proximoSlot = new Date(Date.now() + proximoMin * 60 * 1000)
  await escribirConfig(supabase, 'first_contact_next_slot_at', proximoSlot.toISOString())

  return NextResponse.json({
    ok: true,
    lead_id: lead.id,
    nombre: lead.nombre,
    telefono,
    texto_enviado: true,
    video_enviado: videoOk,
    video_error: videoError,
    proximo_slot_at: proximoSlot.toISOString(),
    proximo_min: proximoMin,
    enviados_hoy: yaEnviados + 1,
    limite_diario: limiteDiario,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
