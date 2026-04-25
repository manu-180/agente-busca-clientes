import Link from 'next/link'
import { Instagram } from 'lucide-react'

export default function AdminIgLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-apex-dark text-white">
      <nav className="bg-apex-card border-b border-apex-border px-6 py-3 flex items-center gap-6 sticky top-0 z-10">
        <div className="flex items-center gap-2 mr-4">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
            <Instagram size={14} className="text-white" />
          </div>
          <span className="font-bold text-sm tracking-tight">IG Admin</span>
        </div>
        <Link
          href="/admin/ig"
          className="text-sm text-apex-muted hover:text-white transition-colors"
        >
          Outreach
        </Link>
        <Link
          href="/admin/ig/discovery"
          className="text-sm text-apex-muted hover:text-white transition-colors"
        >
          Discovery
        </Link>
        <Link
          href="/admin/ig/sources"
          className="text-sm text-apex-muted hover:text-white transition-colors"
        >
          Sources
        </Link>
        <Link
          href="/admin/ig/templates"
          className="text-sm text-apex-muted hover:text-white transition-colors"
        >
          Templates
        </Link>
        <Link
          href="/admin/ig/leads"
          className="text-sm text-apex-muted hover:text-white transition-colors"
        >
          Leads
        </Link>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  )
}
