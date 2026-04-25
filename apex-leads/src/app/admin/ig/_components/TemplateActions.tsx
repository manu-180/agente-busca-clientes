'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  id: string
  status: string
}

export function TemplateActions({ id, status }: Props) {
  const [pending, start] = useTransition()
  const router = useRouter()

  const patch = (newStatus: string) =>
    start(async () => {
      await fetch(`/api/admin/templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      router.refresh()
    })

  return (
    <div className="flex gap-1">
      {status === 'active' && (
        <button
          onClick={() => patch('paused')}
          disabled={pending}
          className="text-xs font-mono px-2 py-0.5 rounded border border-amber-700 text-amber-400 hover:bg-amber-950 transition-colors disabled:opacity-50"
        >
          Pause
        </button>
      )}
      {status === 'paused' && (
        <button
          onClick={() => patch('active')}
          disabled={pending}
          className="text-xs font-mono px-2 py-0.5 rounded border border-emerald-700 text-emerald-400 hover:bg-emerald-950 transition-colors disabled:opacity-50"
        >
          Resume
        </button>
      )}
      {status === 'draft' && (
        <button
          onClick={() => patch('active')}
          disabled={pending}
          className="text-xs font-mono px-2 py-0.5 rounded border border-emerald-700 text-emerald-400 hover:bg-emerald-950 transition-colors disabled:opacity-50"
        >
          Promote
        </button>
      )}
      {status !== 'killed' && (
        <button
          onClick={() => patch('killed')}
          disabled={pending}
          className="text-xs font-mono px-2 py-0.5 rounded border border-rose-800 text-rose-400 hover:bg-rose-950 transition-colors disabled:opacity-50"
        >
          Kill
        </button>
      )}
      {pending && <span className="text-xs text-apex-muted">...</span>}
    </div>
  )
}
