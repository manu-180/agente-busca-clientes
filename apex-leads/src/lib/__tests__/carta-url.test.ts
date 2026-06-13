import { normalizarPaginaUrlCarta, CARTA_CANONICAL_ORIGIN } from '@/lib/carta-url'

describe('normalizarPaginaUrlCarta — el primer mensaje nunca muestra un link de Vercel', () => {
  it('reescribe el dominio gratuito de Vercel al canónico, preservando /r/<slug>', () => {
    expect(normalizarPaginaUrlCarta('https://carta-tawny-alpha.vercel.app/r/el-club-de-la-milanesa')).toBe(
      'https://www.carta.it.com/r/el-club-de-la-milanesa',
    )
  })

  it('preserva querystring (p. ej. ?mesa=4) al reescribir el host', () => {
    expect(normalizarPaginaUrlCarta('https://carta-tawny-alpha.vercel.app/r/parrilla-don-juan?mesa=4')).toBe(
      'https://www.carta.it.com/r/parrilla-don-juan?mesa=4',
    )
  })

  it('cubre cualquier subdominio *.vercel.app (previews incluidos)', () => {
    expect(normalizarPaginaUrlCarta('https://carta-git-main-manu.vercel.app/r/x')).toBe(
      'https://www.carta.it.com/r/x',
    )
  })

  it('eleva carta.it.com (sin www) al canónico con www', () => {
    expect(normalizarPaginaUrlCarta('https://carta.it.com/r/sushi-go')).toBe(
      'https://www.carta.it.com/r/sushi-go',
    )
  })

  it('es idempotente: una URL ya canónica vuelve igual', () => {
    const ok = `${CARTA_CANONICAL_ORIGIN}/r/burger-house`
    expect(normalizarPaginaUrlCarta(ok)).toBe(ok)
  })

  it('vacío / null / undefined → null (el caller usa su fallback)', () => {
    expect(normalizarPaginaUrlCarta('')).toBeNull()
    expect(normalizarPaginaUrlCarta('   ')).toBeNull()
    expect(normalizarPaginaUrlCarta(null)).toBeNull()
    expect(normalizarPaginaUrlCarta(undefined)).toBeNull()
  })

  it('una web propia del lead ajena a Carta se deja intacta', () => {
    expect(normalizarPaginaUrlCarta('https://mirestaurante.com.ar/menu')).toBe(
      'https://mirestaurante.com.ar/menu',
    )
  })

  it('un host pelado no parseable se devuelve sin romper el envío', () => {
    // resolveWhatsAppDemoHost devuelve hosts sin esquema (ej. gym.theapexweb.com).
    // Si alguno llegara acá, no debe explotar ni mutarse.
    expect(normalizarPaginaUrlCarta('gym.theapexweb.com')).toBe('gym.theapexweb.com')
  })
})
