// Helpers para gestión de instancias de Evolution API.
// Aísla URLs/headers para que el resto del código no toque fetch directo.

function getConfig(): { url: string; key: string } {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!url || !key) throw new Error('EVOLUTION_API_URL o EVOLUTION_API_KEY no configuradas')
  return { url: url.replace(/\/$/, ''), key }
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, 'Content-Type': 'application/json' }
}

const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] as const

export type InstanceState = 'close' | 'connecting' | 'open' | 'unknown'

async function evoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = getConfig()
  const headers = { ...authHeaders(key), ...(init.headers as Record<string, string> | undefined) }
  return fetch(`${url}${path}`, { ...init, headers, cache: 'no-store' })
}

async function readErr(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return ''
  }
}

export async function createInstance(name: string, webhookUrl: string): Promise<{ ok: true }> {
  const res = await evoFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName: name,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: WEBHOOK_EVENTS,
      },
    }),
  })
  if (!res.ok) throw new Error(`createInstance(${name}) failed: ${res.status} ${await readErr(res)}`)
  return { ok: true }
}

interface ConnectResponseShape1 {
  base64?: string
  code?: string
  count?: number
}
interface ConnectResponseShape2 {
  qrcode?: { base64?: string; code?: string }
}

function stripDataUrl(b64: string | undefined | null): string | null {
  if (!b64) return null
  return b64.replace(/^data:image\/(png|jpeg);base64,/, '')
}

export async function connectInstance(name: string): Promise<{ base64: string | null; code: string | null }> {
  const res = await evoFetch(`/instance/connect/${encodeURIComponent(name)}`, { method: 'GET' })
  if (!res.ok) throw new Error(`connectInstance(${name}) failed: ${res.status} ${await readErr(res)}`)
  const data = (await res.json()) as ConnectResponseShape1 & ConnectResponseShape2
  const base64 = stripDataUrl(data?.base64) ?? stripDataUrl(data?.qrcode?.base64) ?? null
  const code = data?.code ?? data?.qrcode?.code ?? null
  return { base64, code }
}

export async function getInstanceState(name: string): Promise<InstanceState> {
  const res = await evoFetch(`/instance/connectionState/${encodeURIComponent(name)}`, { method: 'GET' })
  if (!res.ok) {
    if (res.status === 404) return 'unknown'
    throw new Error(`getInstanceState(${name}) failed: ${res.status} ${await readErr(res)}`)
  }
  const data = (await res.json()) as { instance?: { state?: string } }
  const state = data?.instance?.state
  if (state === 'open' || state === 'close' || state === 'connecting') return state
  return 'unknown'
}

export async function restartInstance(name: string): Promise<void> {
  const res = await evoFetch(`/instance/restart/${encodeURIComponent(name)}`, { method: 'POST' })
  if (!res.ok && res.status !== 404) {
    throw new Error(`restartInstance(${name}) failed: ${res.status} ${await readErr(res)}`)
  }
}

export async function logoutInstance(name: string): Promise<void> {
  const res = await evoFetch(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    throw new Error(`logoutInstance(${name}) failed: ${res.status} ${await readErr(res)}`)
  }
}

export async function deleteInstance(name: string): Promise<void> {
  const res = await evoFetch(`/instance/delete/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteInstance(${name}) failed: ${res.status} ${await readErr(res)}`)
  }
}

interface FetchInstanceItem {
  name?: string
  instanceName?: string
  instance?: { instanceName?: string; state?: string; owner?: string; profileName?: string }
  state?: string
  connectionStatus?: string
  ownerJid?: string
  owner?: string
  profileName?: string
  number?: string
}

function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null
  const digits = jid.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '').replace(/[^0-9]/g, '')
  if (!digits) return null
  return `+${digits}`
}

function normalizeInstanceItem(item: FetchInstanceItem): { name: string; state: string; phone: string | null } | null {
  const name = item.name ?? item.instanceName ?? item.instance?.instanceName
  if (!name) return null
  const state = item.state ?? item.connectionStatus ?? item.instance?.state ?? 'unknown'
  const ownerRaw = item.ownerJid ?? item.owner ?? item.instance?.owner ?? item.number ?? null
  const phone = jidToPhone(ownerRaw)
  return { name, state, phone }
}

export async function fetchAllInstances(): Promise<Array<{ name: string; state: string; phone: string | null }>> {
  const res = await evoFetch('/instance/fetchInstances', { method: 'GET' })
  if (!res.ok) throw new Error(`fetchAllInstances failed: ${res.status} ${await readErr(res)}`)
  const data = (await res.json()) as FetchInstanceItem[] | { instances?: FetchInstanceItem[] }
  const list = Array.isArray(data) ? data : (data?.instances ?? [])
  return list.map(normalizeInstanceItem).filter((x): x is NonNullable<typeof x> => x !== null)
}

export async function fetchPhoneNumber(name: string): Promise<string | null> {
  const all = await fetchAllInstances()
  const found = all.find(i => i.name === name)
  return found?.phone ?? null
}

export async function setWebhook(name: string, webhookUrl: string): Promise<void> {
  const res = await evoFetch(`/webhook/set/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: WEBHOOK_EVENTS,
      },
    }),
  })
  if (!res.ok) throw new Error(`setWebhook(${name}) failed: ${res.status} ${await readErr(res)}`)
}

export function buildWebhookUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL no configurada')
  return `${base}/api/webhook/evolution`
}

// Slug helper para alias → instance_name
export function slugifyAlias(alias: string): string {
  const base = alias
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const safe = base || 'sim'
  return `wa-${safe}`
}
