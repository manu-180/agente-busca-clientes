/**
 * Clasifica errores esperables de Postgres/Supabase para fallbacks (bulk insert, upsert).
 */
export function esErrorOnConflictSinIndice(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null | undefined
  const code = e?.code
  const msg = (e?.message || '').toLowerCase()
  return code === '42P10' || msg.includes('no unique or exclusion constraint matching')
}

export function esErrorDuplicadoLead(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null | undefined
  const code = e?.code
  const msg = e?.message || ''
  if (code === '23505') return true
  if (msg.includes('LEAD_DUPLICADO')) return true
  if (/duplicate key/i.test(msg)) return true
  return false
}
