'use client'

import { useEffect, useState } from 'react'
import { Bot, BotOff, CheckCircle } from 'lucide-react'

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [guardado, setGuardado] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/agente/config')
      .then(r => r.json())
      .then(setConfig)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const guardar = async (clave: string, valor: string) => {
    await fetch('/api/agente/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave, valor }),
    })
    setConfig(prev => ({ ...prev, [clave]: valor }))
    setGuardado(true)
    setTimeout(() => setGuardado(false), 2000)
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-syne font-bold text-3xl tracking-tight">Configuración</h1>
          <p className="text-apex-muted text-sm mt-1 font-mono">API keys y ajustes del sistema</p>
        </div>
        {guardado && (
          <span className="flex items-center gap-1.5 text-emerald-400 text-sm animate-fade-in">
            <CheckCircle size={14} />
            Guardado
          </span>
        )}
      </div>

      {/* API Keys */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-6">
        <h2 className="font-syne font-semibold text-lg">API Keys</h2>
        <p className="text-sm text-apex-muted">
          Las API keys se configuran como variables de entorno en Vercel. Estos campos son solo de referencia.
        </p>

        {[
          { clave: 'anthropic_key_status', label: 'Anthropic API Key', desc: 'Se configura en .env.local como ANTHROPIC_API_KEY' },
        ].map(item => (
          <div key={item.clave} className="space-y-1.5">
            <label className="text-xs text-apex-muted font-mono uppercase tracking-wider block">
              {item.label}
            </label>
            <p className="text-sm text-apex-muted">{item.desc}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-apex-black border border-apex-border rounded-lg px-4 py-2.5 text-sm font-mono text-apex-muted">
                ••••••••••••••••
              </div>
              <span className="text-xs text-emerald-400">Configurada en env</span>
            </div>
          </div>
        ))}
      </div>

      {/* Primer contacto (outbound) — fijo en código del cron */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-4">
        <h2 className="font-syne font-semibold text-lg">Primer contacto (WhatsApp)</h2>

        {/* Franja horaria visual */}
        <div className="space-y-2">
          <p className="text-xs text-apex-muted font-mono uppercase tracking-wider">Ventana de envío — horario laboral</p>
          <div className="flex items-center gap-2">
            {/* Barra de 24 horas */}
            <div className="relative flex-1 h-6 bg-apex-black rounded-full overflow-hidden border border-apex-border">
              {/* Franja activa 9–18 → 9/24 * 100% = 37.5%, ancho = 9/24 * 100% = 37.5% */}
              <div
                className="absolute top-0 h-full bg-apex-lime/25 border-x border-apex-lime/50"
                style={{ left: `${(9 / 24) * 100}%`, width: `${(9 / 24) * 100}%` }}
              />
              {/* Tick 9h */}
              <div
                className="absolute top-0 h-full border-l border-apex-lime"
                style={{ left: `${(9 / 24) * 100}%` }}
              />
              {/* Tick 18h */}
              <div
                className="absolute top-0 h-full border-l border-apex-lime"
                style={{ left: `${(18 / 24) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex justify-between text-xs text-apex-muted font-mono px-0.5">
            <span>0:00</span>
            <span className="text-apex-lime font-semibold">9:00 → 18:00</span>
            <span>24:00</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1.5 bg-apex-lime/10 border border-apex-lime/30 text-apex-lime text-xs font-mono px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-apex-lime inline-block" />
              09:00 – 18:00 (Argentina)
            </span>
            <span className="text-xs text-apex-muted">Lun–Dom · 9 hs activas</span>
          </div>
        </div>

        <p className="text-sm text-apex-muted">
          El cron <span className="font-mono text-apex-lime/90">/api/cron/leads-pendientes</span> envía mensajes
          solo en horario laboral. Los senders rotan en round-robin intercalado: cada sender envía uno
          por turno hasta completar su cuota diaria. El otro freno es tener{' '}
          <span className="font-mono">first_contact_activo</span> en pausa. Usá{' '}
          <span className="font-mono">?force=true</span> solo para pruebas fuera de ventana.
        </p>
      </div>

      {/* Toggle global del agente */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              (config.agente_activo ?? 'true') === 'true' ? 'bg-apex-lime/10' : 'bg-apex-border'
            }`}
          >
            {(config.agente_activo ?? 'true') === 'true' ? (
              <Bot size={24} className="text-apex-lime" />
            ) : (
              <BotOff size={24} className="text-apex-muted" />
            )}
          </div>
          <div>
            <h2 className="font-semibold">
              Agente IA {(config.agente_activo ?? 'true') === 'true' ? 'ACTIVO' : 'INACTIVO'}
            </h2>
            <p className="text-sm text-apex-muted">
              {(config.agente_activo ?? 'true') === 'true'
                ? 'Respondiendo automáticamente a todas las conversaciones'
                : 'No responde a ninguna conversación (de ningún proyecto)'}
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            guardar(
              'agente_activo',
              (config.agente_activo ?? 'true') === 'true' ? 'false' : 'true'
            )
          }
          className={`relative w-14 h-7 rounded-full transition-colors ${
            (config.agente_activo ?? 'true') === 'true' ? 'bg-apex-lime' : 'bg-apex-border'
          }`}
        >
          <div
            className={`absolute top-0.5 w-6 h-6 rounded-full bg-apex-black transition-transform ${
              (config.agente_activo ?? 'true') === 'true' ? 'left-[30px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {/* Inteligencia del agente */}
      <div className="bg-apex-card border border-apex-border rounded-xl p-6 space-y-4">
        <h2 className="font-syne font-semibold text-lg">Inteligencia premium</h2>
        <p className="text-sm text-apex-muted">
          Ajustes del motor de criterio conversacional para evitar respuestas innecesarias.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              clave: 'decision_engine_enabled',
              label: 'Motor de decisión',
            },
            {
              clave: 'emoji_no_reply_enabled',
              label: 'Silencio en emoji-only',
            },
            {
              clave: 'conversation_auto_close_enabled',
              label: 'Cierre automático suave',
            },
          ].map(item => {
            const activo = (config[item.clave] ?? 'true') === 'true'
            return (
              <button
                key={item.clave}
                onClick={() => guardar(item.clave, activo ? 'false' : 'true')}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  activo
                    ? 'border-emerald-400/50 bg-emerald-500/10'
                    : 'border-apex-border bg-apex-black'
                }`}
              >
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-apex-muted mt-1">{activo ? 'Activo' : 'Desactivado'}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
