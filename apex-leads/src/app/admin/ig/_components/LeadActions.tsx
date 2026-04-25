'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  username: string
  status: string
}

export function LeadActions({ username, status }: Props) {
  const [pending, start] = useTransition()
  const router = useRouter()

  const blacklist = () =>
    start(async () => {
      await fetch(`/api/admin/leads/${username}/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual_admin' }),
      })
      router.refresh()
    })

  const reclassify = () =>
    start(async () => {
      await fetch(`/api/admin/leads/${username}/reclassify`, { method: 'POST' })
      router.refresh()
    })

  return (
    <div className="flex gap-1">
      {status !== 'blacklisted' && (
        <button
          onClick={blacklist}
          disabled={pending}
          title="Blacklist"
          className="text-xs font-mono px-2 py-0.5 rounded border border-rose-800 text-rose-400 hover:bg-rose-950 transition-colors disabled:opacity-50"
        >
          ✕
        </button>
      )}
      <button
        onClick={reclassify}
        disabled={pending}
        title="Re-classify"
        className="text-xs font-mono px-2 py-0.5 rounded border border-indigo-700 text-indigo-400 hover:bg-indigo-950 transition-colors disabled:opacity-50"
      >
        ↺
      </button>
      {pending && <span className="text-xs text-apex-muted">...</span>}
    </div>
  )
}
