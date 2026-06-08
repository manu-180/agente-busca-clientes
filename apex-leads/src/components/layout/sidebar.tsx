'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, UserPlus, MessageSquare,
  Settings, Menu, X, Zap, Sparkles, Instagram, FileText, Smartphone, Briefcase,
  FolderKanban, ChevronDown, ChevronRight,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { usePolling } from '@/hooks/usePolling'

interface ProjectNav {
  id: string
  slug: string
  nombre: string
}

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads WA', icon: Users },
  { href: '/leads/nuevo', label: 'Nuevo Lead', icon: UserPlus },
  { href: '/conversaciones', label: 'Inbox WA', icon: MessageSquare, showBadge: true },
  { href: '/demos', label: 'Demos', icon: Sparkles },
  { href: '/admin/ig', label: 'Instagram', icon: Instagram },
  { href: '/logs', label: 'Logs', icon: FileText },
  { href: '/senders', label: 'Senders', icon: Smartphone },
  { href: '/trabajos', label: 'Trabajos', icon: Briefcase },
  { href: '/configuracion', label: 'Config', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [simInactiveCount, setSimInactiveCount] = useState<number | null>(null)
  const [projects, setProjects] = useState<ProjectNav[]>([])
  const [projectsOpen, setProjectsOpen] = useState(true)

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/conversaciones/unread')
      const data = await res.json()
      setUnreadTotal(data.total ?? 0)
    } catch {}
  }, [])

  usePolling(fetchUnread, 60_000)

  useEffect(() => {
    fetchUnread()
  }, [pathname, fetchUnread])

  useEffect(() => {
    window.addEventListener('inbox:mark-read', fetchUnread)
    return () => window.removeEventListener('inbox:mark-read', fetchUnread)
  }, [fetchUnread])

  const fetchSimStatus = useCallback(async () => {
    try {
      // EGRESS: ?slim=1 devuelve solo id/alias/activo/project_id y omite el
      // join conversaciones(count). Acá solo leemos alias + activo.
      const res = await fetch('/api/senders?slim=1')
      const data = await res.json()
      if (!Array.isArray(data)) return
      const simSenders = data.filter((s: { alias: string }) =>
        s.alias?.toLowerCase().includes('sim')
      )
      const inactive = simSenders.filter((s: { activo: boolean }) => !s.activo).length
      setSimInactiveCount(inactive)
    } catch {}
  }, [])

  usePolling(fetchSimStatus, 120_000)

  // Cargar proyectos para el dropdown
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(({ projects }) => setProjects(projects ?? []))
      .catch(() => {})
  }, [])

  // Abrir el dropdown automáticamente si estás dentro de /proyectos
  useEffect(() => {
    if (pathname?.startsWith('/proyectos')) setProjectsOpen(true)
  }, [pathname])

  const proyectosActivo = pathname?.startsWith('/proyectos') ?? false

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-50 p-2 bg-apex-card rounded-lg border border-apex-border text-neutral-200 lg:hidden"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-64 bg-apex-dark border-r border-apex-border z-40',
          'flex flex-col transition-transform duration-200',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-6 border-b border-apex-border">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 bg-apex-lime rounded-lg flex items-center justify-center">
              <Zap size={18} className="text-apex-black" />
            </div>
            <div>
              <h1 className="font-syne font-bold text-lg text-white tracking-tight">APEX</h1>
              <p className="text-[10px] font-mono text-apex-muted tracking-widest uppercase">Lead Engine</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const badgeCount = item.showBadge ? unreadTotal : 0
            const isSenders = item.href === '/senders'
            const simDotColor =
              simInactiveCount === null
                ? null
                : simInactiveCount === 0
                ? 'bg-emerald-400'
                : 'bg-red-500'
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-apex-lime/15 text-apex-lime border border-apex-lime/35'
                    : 'text-apex-muted hover:text-white hover:bg-apex-card'
                )}
              >
                <item.icon size={18} />
                <span className="flex-1">{item.label}</span>
                {isSenders && simDotColor && (
                  simInactiveCount! > 1 ? (
                    <span className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${simDotColor} shrink-0`} />
                      <span className="text-[10px] font-bold text-red-400">{simInactiveCount}</span>
                    </span>
                  ) : (
                    <span className={`w-2 h-2 rounded-full ${simDotColor} shrink-0`} />
                  )
                )}
                {badgeCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </Link>
            )
          })}

          {/* Sección Proyectos (dropdown) */}
          <div className="pt-2">
            <button
              onClick={() => setProjectsOpen(o => !o)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all',
                proyectosActivo
                  ? 'bg-apex-lime/15 text-apex-lime border border-apex-lime/35'
                  : 'text-apex-muted hover:text-white hover:bg-apex-card'
              )}
            >
              <FolderKanban size={18} />
              <span className="flex-1 text-left">Proyectos</span>
              {projectsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {projectsOpen && (
              <div className="mt-1 ml-3 pl-3 border-l border-apex-border space-y-0.5">
                {projects.length === 0 && (
                  <p className="px-3 py-2 text-xs text-apex-muted italic">Cargando...</p>
                )}
                {projects.map(p => {
                  const href = `/proyectos/${p.slug}`
                  const isActive = pathname === href
                  return (
                    <Link
                      key={p.id}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'block px-3 py-2 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-apex-lime/10 text-apex-lime'
                          : 'text-apex-muted hover:text-white hover:bg-apex-card'
                      )}
                    >
                      {p.nombre}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </nav>

        <div className="p-4 border-t border-apex-border">
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 pulse-lime" />
            <span className="text-xs font-mono text-apex-muted">Sistema activo</span>
          </div>
        </div>
      </aside>
    </>
  )
}
