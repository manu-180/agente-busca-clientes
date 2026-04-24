const URL_REGEX =
  /\bhttps?:\/\/[^\s]+/gi

const WHATSAPP_FORMATTING_REGEX = /[*_~]/g

const PUNCTUATION_REGEX = /[.,!?:;()\[\]{}"']/g

function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeTextForMatch(input: string): string {
  if (!input) return ''

  let text = input.toLowerCase()

  // remover URLs primero para que no contaminen keywords
  text = text.replace(URL_REGEX, ' ')

  // remover formato de WhatsApp (*negrita*, _cursiva_, ~tachado~)
  text = text.replace(WHATSAPP_FORMATTING_REGEX, '')

  // remover puntuación básica
  text = text.replace(PUNCTUATION_REGEX, ' ')

  // normalizar tildes
  text = removeDiacritics(text)

  // colapsar espacios
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

