# Operación de senders WhatsApp (Evolution API)

**Última actualización:** 2026-04-30 (post SESSION-EVO-10)

Esta guía cubre cómo evitar que un sender se desconecte solo y qué hacer cuando pasa.

---

## TL;DR — antes de mandar el primer mensaje con un sender

Checklist obligatorio:

1. **WhatsApp del celular abierto y conectado a internet.** No tiene que estar al frente, pero el celular tiene que poder llegar a los servidores de WhatsApp.
2. **Cero WhatsApp Web abierto sobre la cuenta vinculada a Evolution.** WhatsApp Multi-Device tiene cupo limitado de dispositivos. Si tu Web está abierto, está compitiendo con Evolution por uno de los slots y WhatsApp puede tirar el más viejo.
3. **Solo una instancia Evolution por número.** Verificá en `/senders` que no haya senders duplicados con el mismo `phone_number`. Si una está soft-deleted (Inactivo), el sistema le hace `logout` automáticamente desde 2026-04-30 — no hace falta limpieza manual.
4. **Sender en estado `connected`** en `/senders`. Si está disconnected, apretá "Reconectar QR". Si la cuenta sigue vinculada en el celular, vuelve sin necesidad de re-escanear.

---

## Cómo funciona el blindaje (qué hace el sistema solo)

Desde SESSION-EVO-09 y SESSION-EVO-10:

- **Webhook non-blocking.** Cuando Evolution nos manda un evento (mensaje, status, conexión), respondemos `200` en < 200 ms y procesamos en background. Antes el webhook hacía 6 round-trips a Supabase sync y podía tardar segundos — eso hacía que Evolution interpretara "cliente caído" y reiniciara el socket Baileys ↔ WhatsApp.
- **Pre-flight antes de cada envío.** Si el sender no está `open` en Evolution, fallamos rápido sin tocar la API y elegimos otro sender del pool. Esto evita el bug de Baileys que devolvía `200` con buffer interno aunque el mensaje no se entregara.
- **Failover en el cron de envíos.** Si el sender elegido falla con `INSTANCE_NOT_CONNECTED` o supera 3 fallos consecutivos, se marca disconnected al instante y el siguiente sender del pool toma el envío (hasta 3 reintentos por tick).
- **Auto-restart de sockets caídos.** Cada 5 minutos, el cron `health-evolution` chequea contra Evolution. Si una instancia lleva > 3 min `close` o `connecting` y la razón **no** es `device_removed` (que requiere QR humano), llama `restartInstance` automáticamente. Tiempo total típico de recovery: 5–8 minutos sin tocar nada.
- **Webhook `connection.update`.** Detecta caídas en el momento exacto que ocurren (no esperamos al cron), con `disconnection_reason` (`device_removed`, `conflict`, `timeout`, etc.) y timestamp.
- **Logout automático al desactivar.** Cuando hacés "Inactivo" o soft-delete en `/senders`, llamamos `logoutInstance` para liberar el slot de Multi-Device. La cuenta sigue vinculada en el celular; si reactivás, basta con un Reconectar QR.

---

## Causas conocidas de desconexión (en orden de frecuencia)

| Síntoma | Causa probable | Auto-recovery |
|---|---|---|
| Cae solo al primer envío y vuelve con "Reconectar QR" sin re-escanear | Webhook lento → Evolution timeoutea → mata socket. **Mitigado**: webhook ahora es non-blocking. | Sí (auto-restart) |
| Cae solo en pleno horario laboral, vuelve con "Reconectar QR" sin re-escanear | Railway durmió el container o reinicio breve | Sí (auto-restart) |
| Cae y aparece `disconnection_reason=device_removed` | "Eliminar cuenta" en el celular o cuenta baneada | **No** — requiere QR nuevo |
| Cae y aparece `disconnection_reason=conflict` | WhatsApp Web abierto sobre la misma cuenta, o instancia duplicada | Sí, pero arregla la causa para que no vuelva a pasar |
| Cae y aparece `disconnection_reason=timeout` | Red del celular caída | Sí |

---

## Qué hacer cuando un sender se cae

### Caso 1: Esperá 5–8 min

El cron `health-evolution` corre cada 5 min. Si la causa es recoverable, va a hacer restart automático tras 3 min de caída. Si volvió, vas a ver `connected` en `/senders` sin haber hecho nada.

### Caso 2: Apretá "Reconectar QR"

Si estás apurado, apretá el botón directamente. Si la cuenta sigue vinculada en el celular, ni siquiera vas a tener que escanear: el QR aparece pero antes de los 40 s de timeout la sesión vuelve a `open` sola.

### Caso 3: `disconnection_reason=device_removed`

Acá no hay magia. Tenés que:

1. Volver a abrir WhatsApp Business en el celular sobre esa cuenta.
2. Configuración → Dispositivos vinculados → Vincular dispositivo.
3. Apretar "Reconectar QR" en `/senders` y escanear el código.

Si no querés recuperar ese número, marcá el sender como Inactivo (toggle en `/senders`).

---

## Endpoints relevantes

| Endpoint | Cuándo se dispara | Qué hace |
|---|---|---|
| `POST /api/webhook/evolution` | Cada evento que emite Evolution | Procesa eventos, responde 200 al instante, trabajo a `waitUntil` |
| `GET /api/cron/health-evolution` | Cron Vercel cada 5 min | Sincroniza estado real Evolution → DB; auto-restart si lleva > 3 min caído |
| `GET /api/cron/leads-pendientes` | Railway cron cada 1 min | Elige próximo sender del pool, envía 1 mensaje |
| `POST /api/senders/[id]/reconnect` | Botón "Reconectar QR" | Restart + nuevo QR |
| `GET /api/senders/[id]/state` | Polling del modal QR (cada 2 s) | Devuelve `state` y sincroniza DB |

---

## Columnas relevantes en tabla `senders`

| Columna | Significado |
|---|---|
| `connected` | Verdadero si Evolution reporta `state=open` |
| `disconnection_reason` | `device_removed`, `conflict`, `timeout`, `health_check_close`, `preflight_close`, `send_failure_threshold`, etc. NULL si nunca se cayó |
| `disconnected_at` | Timestamp de la última transición open→close. NULL si nunca cayó |
| `health_checked_at` | Última vez que el cron `health-evolution` verificó la instancia. Si está viejo, el cron no está corriendo |
| `consecutive_send_failures` | Contador de fallos de envío seguidos. Se resetea a 0 al primer envío exitoso o cuando vuelve a `state=open` |

---

## Decisiones de diseño

- **No usamos `deleteInstance` automáticamente.** `delete` borra la sesión Multi-Device y requiere QR humano para volver. Solo `logoutInstance`, que cierra el socket pero deja la cuenta vinculada.
- **Solo confiamos en Evolution para el estado real.** La columna `senders.connected` es un caché — el cron y el webhook la mantienen sincronizada con `GET /instance/connectionState`.
- **No retry de webhooks.** El webhook responde 200 sí o sí (incluso con auth error o JSON malformado) para evitar retry storms que rompan la sesión.
