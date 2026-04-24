'use client'

import { useState, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KeywordsChipsProps {
  label: string
  placeholder: string
  value: string[]
  onChange: (value: string[]) => void
  variant?: 'strong' | 'weak' | 'negative'
}

export function KeywordsChips({
  label,
  placeholder,
  value,
  onChange,
  variant = 'weak',
}: KeywordsChipsProps) {
  const [input, setInput] = useState('')

  const handleAdd = (raw: string) => {
    const text = raw.trim().toLowerCase()
    if (!text) return
    if (value.includes(text)) return
    onChange([...value, text])
    setInput('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      handleAdd(input)
    }
  }

  const badgeClasses =
    variant === 'strong'
      ? 'bg-apex-lime/15 text-apex-lime border-apex-lime/30'
      : variant === 'negative'
      ? 'bg-red-500/10 text-red-300 border-red-500/30'
      : 'bg-blue-500/10 text-blue-300 border-blue-500/30'

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5 mb-1">
        {value.map((kw) => (
          <span
            key={kw}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px]',
              badgeClasses
            )}
          >
            <span>{kw}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== kw))}
              className="hover:opacity-70"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-[11px] text-apex-muted italic">Sin keywords</span>
        )}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-apex-black border border-apex-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-apex-lime/50"
      />
      <p className="text-[11px] text-apex-muted">
        Escribí y presioná Enter o coma para agregar una keyword.
      </p>
    </div>
  )
}

