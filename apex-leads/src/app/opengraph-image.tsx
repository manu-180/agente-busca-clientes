import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'APEX Lead Engine — Sistema de prospección y agente de ventas IA'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: '#0a0a0a',
          display: 'flex',
          alignItems: 'stretch',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Ambient glow top-left */}
        <div
          style={{
            position: 'absolute',
            top: -180,
            left: -180,
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(200,241,53,0.07) 0%, transparent 65%)',
            display: 'flex',
          }}
        />

        {/* Left: Logo mark */}
        <div
          style={{
            width: 480,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="260" height="260" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="15.5" stroke="#c8f135" stroke-width="0.3" opacity="0.12" />
            <circle cx="16" cy="16" r="11" stroke="#c8f135" stroke-width="0.3" opacity="0.07" />
            <path d="M16 5 L29 27 L3 27 Z" stroke="#c8f135" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round" />
            <path d="M16 5 L29 27 L3 27 Z" fill="#c8f135" opacity="0.04" />
            <circle cx="16" cy="5" r="5.5" fill="#c8f135" opacity="0.09" />
            <circle cx="16" cy="5" r="3.2" fill="#c8f135" opacity="0.2" />
            <circle cx="16" cy="5" r="1.6" fill="#c8f135" />
            <circle cx="3" cy="27" r="0.8" fill="#c8f135" opacity="0.45" />
            <circle cx="29" cy="27" r="0.8" fill="#c8f135" opacity="0.45" />
            <line x1="3" y1="27.5" x2="29" y2="27.5" stroke="#c8f135" stroke-width="0.4" opacity="0.3" />
          </svg>
        </div>

        {/* Vertical divider */}
        <div
          style={{
            width: 1,
            background: 'rgba(200, 241, 53, 0.15)',
            alignSelf: 'center',
            height: 340,
            flexShrink: 0,
            display: 'flex',
          }}
        />

        {/* Right: Brand text */}
        <div
          style={{
            flex: 1,
            paddingLeft: 72,
            paddingRight: 80,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: '#c8f135',
              letterSpacing: 4,
              textTransform: 'uppercase',
              opacity: 0.65,
              marginBottom: 20,
              display: 'flex',
            }}
          >
            AI · Sales prospecting
          </div>

          <div
            style={{
              fontSize: 100,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 0.88,
              letterSpacing: -4,
              display: 'flex',
            }}
          >
            APEX
          </div>

          <div
            style={{
              fontSize: 48,
              fontWeight: 600,
              color: '#c8f135',
              lineHeight: 1,
              marginTop: 10,
              letterSpacing: -1,
              display: 'flex',
            }}
          >
            Lead Engine
          </div>

          <div
            style={{
              width: 48,
              height: 1,
              background: '#c8f135',
              opacity: 0.3,
              marginTop: 36,
              marginBottom: 30,
              display: 'flex',
            }}
          />

          <div
            style={{
              fontSize: 20,
              color: '#555555',
              lineHeight: 1.5,
              display: 'flex',
            }}
          >
            Prospección automatizada con agente de ventas IA
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
            {['WhatsApp', 'Instagram', 'Claude AI', 'Automatización'].map((tag) => (
              <div
                key={tag}
                style={{
                  fontSize: 13,
                  color: '#c8f135',
                  border: '1px solid rgba(200, 241, 53, 0.35)',
                  borderRadius: 6,
                  padding: '5px 14px',
                  display: 'flex',
                  opacity: 0.85,
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>

        {/* Decorative radar arcs (right edge) */}
        <div
          style={{
            position: 'absolute',
            right: -35,
            top: 195,
            display: 'flex',
          }}
        >
          <svg width="120" height="240" viewBox="0 0 120 240" fill="none">
            <circle cx="120" cy="120" r="50" stroke="#c8f135" stroke-width="0.8" opacity="0.12" />
            <circle cx="120" cy="120" r="75" stroke="#c8f135" stroke-width="0.5" opacity="0.07" />
            <circle cx="120" cy="120" r="100" stroke="#c8f135" stroke-width="0.3" opacity="0.04" />
          </svg>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
