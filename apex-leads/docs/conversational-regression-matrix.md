# Matriz de Regresión Conversacional (Inteligencia Premium)

## Objetivo
Verificar que el bot tenga criterio para no sobre-responder, respete cierres y mantenga conversiones útiles.

## Casos críticos

| Caso | Entrada cliente | Resultado esperado |
| --- | --- | --- |
| Emoji only | `👍` | No respuesta (`no_reply_emoji`), sin reabrir flujo |
| Ack mínimo | `ok` / `gracias` | No respuesta (`no_reply_low_signal`) |
| Pregunta explícita | `¿Cuánto sale una web?` | Respuesta completa con CTA claro |
| Pedido humano | `quiero hablar con una persona` | Mensaje de derivación humana (`handoff_human`) |
| Opt-out | `no me interesa` | `agente_activo=false`, `estado=no_interesado`, conversación cerrada |
| Cierre suave | `dale gracias, te aviso` | Cierre conversacional sin insistencia posterior |
| Mensaje no texto | audio / imagen | Fallback de texto (sin romper flujo) |

## Validación de métricas (7 días)
- `no_reply_emoji` debe subir cuando hay reacciones.
- `no_reply_low_signal` debe reflejar silencios intencionales.
- `handoff_human_sent` debe existir cuando el usuario pide humano.
- `llm_blocked_guardrail` debe mantenerse bajo y estable.

## Rollout canario recomendado
1. Activar `decision_engine_enabled=true` en staging.
2. Activar `emoji_no_reply_enabled=true` y monitorear 24h.
3. Activar `conversation_auto_close_enabled=true` y monitorear follow-ups 48h.
4. Pasar a producción con revisión diaria de métricas durante la primera semana.

## Criterios de rollback
- Caída fuerte de respuestas útiles (preguntas explícitas sin respuesta).
- Aumento de quejas por silencio en mensajes accionables.
- Errores persistentes en webhook por nuevas ramas de decisión.
