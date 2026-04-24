'use client'

import { useState } from 'react'
import { Zap, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      window.location.href = '/dashboard'
    } else {
      setError('Contraseña incorrecta')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-apex-black p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="w-16 h-16 bg-apex-lime rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Zap size={28} className="text-apex-black" />
          </div>
          <h1 className="font-syne font-bold text-2xl">APEX Lead Engine</h1>
          <p className="text-apex-muted text-sm mt-1 font-mono">Acceso al panel</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Contraseña"
            className="w-full bg-apex-card border border-apex-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-apex-lime/50 text-center tracking-widest"
            autoFocus
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-apex-lime text-apex-black py-3 rounded-xl font-semibold text-sm hover:bg-apex-lime-hover transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}
