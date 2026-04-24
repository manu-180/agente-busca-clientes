export const WA_SIGNALS = [
  /wa\.me\//i,
  /api\.whatsapp\.com/i,
  /whatsapp\.com\/send/i,
  /\+54\s?9?\s?11[\s\-]?\d{4}[\s\-]?\d{4}/,
  /\+54\s?9?\s?(?:11|15)[\s\-]?\d{8}/,
  /envios?\s+por\s+whatsapp/i,
  /pedidos?\s+por\s+whatsapp/i,
  /consultas?\s+por\s+whatsapp/i,
  /escribinos?\s+al\s+whatsapp/i,
  /contacto\s+por\s+wp/i,
]

export function hasWhatsAppSignal(text: string): boolean {
  return WA_SIGNALS.some((re) => re.test(text))
}
