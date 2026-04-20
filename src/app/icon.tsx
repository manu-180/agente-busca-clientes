import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: '#0a0a0a',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1.5px solid #c8f135',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {/* Triangle / upward arrow — "leads going up" */}
          <polygon
            points="10,2 18,18 2,18"
            fill="none"
            stroke="#c8f135"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <line
            x1="10"
            y1="8"
            x2="10"
            y2="14"
            stroke="#c8f135"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="10" cy="16.5" r="1" fill="#c8f135" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
