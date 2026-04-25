import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const STATUS_STYLE: Record<string, string> = {
  discovered:        'bg-zinc-800 text-zinc-400',
  qualified:         'bg-blue-950 text-blue-400',
  queued:            'bg-purple-950 text-purple-400',
  contacted:         'bg-sky-950 text-sky-400',
  follow_up_sent:    'bg-amber-950 text-amber-400',
  replied:           'bg-emerald-950 text-emerald-400',
  interested:        'bg-lime-950 text-lime-400',
  meeting_booked:    'bg-green-950 text-green-400',
  closed_positive:   'bg-green-900 text-green-300',
  closed_negative:   'bg-red-950 text-red-400',
  closed_ghosted:    'bg-zinc-900 text-zinc-500',
  wrong_niche:       'bg-zinc-800 text-zinc-500',
  blacklisted:       'bg-red-900 text-red-300',
  error:             'bg-rose-950 text-rose-400',
}

const NICHES = [
  'moda_femenina',
  'moda_masculina',
  'indumentaria_infantil',
  'accesorios',
  'calzado',
  'belleza_estetica',
  'joyeria',
  'otro',
  'descartar',
]

const STATUSES = [
  'discovered','qualified','queued','contacted','follow_up_sent',
  'replied','interested','meeting_booked','closed_positive',
  'closed_negative','closed_ghosted','wrong_niche','blacklisted','error',
]

interface LeadRow {
  id: string
  ig_username: string
  niche: string | null
  niche_confidence: number | null
  lead_score: number
  status: string
  last_dm_sent_at: string | null
  replied_at: string | null
  followers_count: number | null
  business_category: string | null
  created_at: string
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
  })
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { page?: string; niche?: string; status?: string; min_score?: string }
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10))
  const niche = searchParams.niche ?? ''
  const status = searchParams.status ?? ''
  const minScore = parseInt(searchParams.min_score ?? '0', 10)

  const supabase = createSupabaseServer()

  let query = supabase
    .from('instagram_leads')
    .select(
      'id,ig_username,niche,niche_confidence,lead_score,status,last_dm_sent_at,replied_at,followers_count,business_category,created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (niche) query = query.eq('niche', niche)
  if (status) query = query.eq('status', status)
  if (minScore > 0) query = query.gte('lead_score', minScore)

  const { data, count } = await query

  const rows = (data ?? []) as LeadRow[]
  const total = count ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  function buildUrl(params: Record<string, string | undefined>) {
    const p = new URLSearchParams()
    const merged = { page: String(page), niche, status, min_score: String(minScore || ''), ...params }
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v)
    }
    return `/admin/ig/leads?${p.toString()}`
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Leads</h1>
          <p className="text-sm text-apex-muted mt-0.5">{total} leads totales</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-apex-card border border-apex-border rounded-xl p-4">
        <label className="flex items-center gap-2 text-sm text-apex-muted">
          Nicho:
          <select
            name="niche"
            defaultValue={niche}
            className="bg-apex-dark border border-apex-border rounded px-2 py-1 text-sm text-white"
            onChange={undefined}
          >
            <option value="">Todos</option>
            {NICHES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-apex-muted">
          Status:
          <select
            name="status"
            defaultValue={status}
            className="bg-apex-dark border border-apex-border rounded px-2 py-1 text-sm text-white"
          >
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-apex-muted">
          Score min:
          <input
            type="number"
            name="min_score"
            defaultValue={minScore || ''}
            min={0}
            max={100}
            className="bg-apex-dark border border-apex-border rounded px-2 py-1 text-sm text-white w-20"
          />
        </label>
        <a
          href={buildUrl({ page: '1' })}
          className="px-3 py-1 bg-indigo-700 hover:bg-indigo-600 text-white text-sm rounded transition-colors"
        >
          Aplicar
        </a>
        {(niche || status || minScore > 0) && (
          <a
            href="/admin/ig/leads"
            className="px-3 py-1 bg-apex-dark border border-apex-border text-apex-muted hover:text-white text-sm rounded transition-colors"
          >
            Limpiar
          </a>
        )}
      </div>

      {/* Table */}
      <div className="bg-apex-card border border-apex-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-mono text-apex-muted border-b border-apex-border">
                <th className="text-left px-5 py-3">Usuario</th>
                <th className="text-left px-4 py-3">Nicho</th>
                <th className="text-right px-4 py-3">Score</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Seguidores</th>
                <th className="text-left px-4 py-3">Último DM</th>
                <th className="text-left px-4 py-3">Respondió</th>
                <th className="text-left px-4 py-3">Descubierto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-apex-border/50 hover:bg-white/[0.02] last:border-0"
                >
                  <td className="px-5 py-2.5">
                    <Link
                      href={`https://instagram.com/${l.ig_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      @{l.ig_username}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    {l.niche ? (
                      <span className="text-xs font-mono text-white/70">{l.niche}</span>
                    ) : (
                      <span className="text-xs text-apex-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    <span className={l.lead_score >= 60 ? 'text-emerald-400' : l.lead_score >= 30 ? 'text-amber-400' : 'text-apex-muted'}>
                      {l.lead_score}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                        STATUS_STYLE[l.status] ?? 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-apex-muted">
                    {l.followers_count?.toLocaleString('es-AR') ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-apex-muted">
                    {formatDate(l.last_dm_sent_at)}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono">
                    <span className={l.replied_at ? 'text-emerald-400' : 'text-apex-muted'}>
                      {formatDate(l.replied_at)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-apex-muted">
                    {formatDate(l.created_at)}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-apex-muted text-sm">
                    Sin leads con los filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-apex-border text-xs font-mono text-apex-muted">
            <span>
              Página {page} de {totalPages} · {total} leads
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={buildUrl({ page: String(page - 1) })}
                  className="px-3 py-1 bg-apex-dark border border-apex-border rounded hover:text-white transition-colors"
                >
                  Anterior
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={buildUrl({ page: String(page + 1) })}
                  className="px-3 py-1 bg-apex-dark border border-apex-border rounded hover:text-white transition-colors"
                >
                  Siguiente
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
