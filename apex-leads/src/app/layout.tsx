import type { Metadata } from 'next'
import './globals.css'
import { Sidebar } from '@/components/layout/sidebar'

const appUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'APEX Lead Engine',
  description: 'Sistema de prospección y agente de ventas IA',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="dark" style={{ colorScheme: 'dark' }}>
      <body className="bg-apex-black text-neutral-200 antialiased">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen">
          <div className="p-6 lg:p-10 max-w-7xl">
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
