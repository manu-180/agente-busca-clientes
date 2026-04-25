'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, UserPlus, MessageSquare,
  Bot, Settings, Menu, X, Zap, Sparkles, Instagram, FileText, Smartphone, Briefcase
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads WA', icon: Users },
  { href: '/leads/nuevo', label: 'Nuevo Lead', icon: UserPlus },
  { href: '/conversaciones', label: 'Inbox WA', icon: MessageSquare, showBadge: true },
  { href: '/agente', label: 'Agente IA', icon: Bot },
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

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/conversaciones/unread')
        const data = await res.json()
        setUnreadTotal(data.total ?? 0)
      } catch {}
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 30000)
    return () => clearInterval(interval)
  }, [pathname])

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-50 p-2 bg-apex-card rounded-lg border border-apex-border text-neutral-200 lg:hidden"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-64 bg-apex-dark border-r border-apex-border z-40',
          'flex flex-col transition-transform duration-200',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
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

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const badgeCount = item.showBadge ? unreadTotal : 0
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
                {badgeCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
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
