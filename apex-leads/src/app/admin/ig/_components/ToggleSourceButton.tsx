'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  id: string
  active: boolean
}

export function ToggleSourceButton({ id, active }: Props) {
  const [pending, start] = useTransition()
  const router = useRouter()

  const toggle = () =>
    start(async () => {
      await fetch(`/api/admin/sources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      router.refresh()
    })

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${
        active
          ? 'border-amber-700 text-amber-400 hover:bg-amber-950'
          : 'border-emerald-700 text-emerald-400 hover:bg-emerald-950'
      }`}
    >
      {pending ? '...' : active ? 'Pause' : 'Resume'}
    </button>
  )
}
