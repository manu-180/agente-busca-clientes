/**
 * Modelo usado en conversación, sugerencias, follow-ups, etc.
 * Default: Haiku 4.5 (aprox. ~3× más barato que Sonnet, calidad adecuada con los prompts actuales).
 * Para forzar Sonnet: ANTHROPIC_MODEL=claude-sonnet-4-5 en .env
 */
const DEFAULT = 'claude-haiku-4-5-20251001'

export const ANTHROPIC_CHAT_MODEL = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT
