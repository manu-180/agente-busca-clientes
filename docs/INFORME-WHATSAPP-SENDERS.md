# Informe: APEX Lead Engine + Evolution API + flota de senders WhatsApp

**Fecha:** 2026-04-30
**Contexto:** post-mortem del incidente de hoy (SIM 1 desconectada) y plan operativo para escalar a muchos senders.

---

## 1. Qué hace APEX Lead Engine

Sistema para captar leads B2B y conversar con ellos por WhatsApp de forma semi-automática.

**Stack:**
- Frontend + API: Next.js 15 (App Router) en Vercel — `leads.theapexweb.com`.
- DB: Supabase (Postgres).
- WhatsApp: Evolution API (Baileys) en Railway — `evolution-api-production-3571.up.railway.app`.
- LLM: Claude API.

**Flujo de un lead:**
1. APEX guarda un lead en la tabla `leads` (manual o desde scraper de Google Maps).
2. Vos enviás el primer mensaje desde el inbox de APEX, eligiendo qué SIM usar (sender-pool LRU).
3. APEX llama a Evolution: `POST /message/sendText/{instanceName}` → Evolution lo manda por el WhatsApp del SIM.
4. Cuando el lead responde:
   - WhatsApp entrega el mensaje al cliente Multi-Device de Evolution.
   - Evolution dispara webhook `messages.upsert` a `https://leads.theapexweb.com/api/webhook/evolution`.
   - El handler guarda el mensaje en `conversaciones` con `rol='cliente'`.
   - Dispara el agente IA en background (`procesarEnBackground`) que decide si responder con Claude.
   - Si el agente decide responder, llama de nuevo a Evolution para enviar.
5. La UI de "Inbox WA" muestra la conversación y los mensajes nuevos vía polling cada 10 s + Realtime de Supabase.

**Tabla clave:** `senders` — una fila por número de WhatsApp (SIM), con `instance_name` que mapea a la instancia de Evolution.

---

## 2. Cómo funciona Evolution API

Evolution es una capa que envuelve Baileys (cliente no-oficial de WhatsApp) y expone una REST API.

**Conceptos:**
- **Instance**: una sesión de Baileys conectada a un número de WhatsApp. Cada SIM = una instance.
- **Webhook**: URL que Evolution llama cuando pasa algo (mensaje recibido, status, conexión). Configurable por instance.
- **connectionStatus**: estado de la sesión Multi-Device.
  - `open` — vinculada y operativa.
  - `connecting` — esperando QR o sincronizando.
  - `close` — caída. Outbound y entrantes mueren.

**Eventos que APEX escucha (definidos en [`evolution-instance.ts:15`](apex-leads/src/lib/evolution-instance.ts:15)):**
- `MESSAGES_UPSERT` — mensaje nuevo (entrante o eco de saliente).
- `MESSAGES_UPDATE` — cambio de status (delivered/read/error).
- `CONNECTION_UPDATE` — cambios de estado de la sesión.

**Cómo Evolution recibe mensajes:**
Evolution se vincula a WhatsApp como un **dispositivo vinculado** (Multi-Device), igual que WhatsApp Web pero corriendo en Railway. Para hacerlo, escanea un QR generado desde el celular "principal" del SIM. Una vez vinculado, recibe los mensajes del WhatsApp del SIM en tiempo real vía socket Baileys.

---

## 3. Qué pasó hoy 30/4

**Timeline:**
- ~13:58 AR — enviaste mensaje a "Kala Todo Moda" desde APEX usando SIM 1 (`wa-sim01`, número `5491164707233`). Outbound OK.
- 14:15 AR — la instancia `wa-sim01` se desconectó:
  ```
  disconnectionReasonCode: 401
  disconnectionObject: device_removed / Stream Errored (conflict)
  ```
- ~14:20 AR — Kala respondió con auto-reply ("Gracias por comunicarte..."). Llegó al celular pero **no a Evolution**, porque la sesión ya estaba muerta.
- 14:18 AR — creaste `wa-sim-2` (otra SIM, `5491164707543`). Esa quedó `open`.
- Tarde — viste en APEX que no aparecía la respuesta del lead, ni el agente IA contestaba.

**Causa raíz:** al sacar SIM 1 del celular y darle **"Eliminar cuenta"** en WhatsApp Business para meter SIM 2, WhatsApp borra la cuenta del lado del servidor y eso mata todas las sesiones Multi-Device asociadas — incluida la de Evolution. La sesión de SIM 1 quedó como `close` con `device_removed` y no se recupera sola; hay que vincularla de nuevo.

**Lo que NO fue:** WhatsApp Web abierto en la compu. Esa hipótesis cae porque vos no tenías Web abierto sobre el SIM. Fue el "Eliminar cuenta" del celular.

---

## 4. Tu objetivo: muchos senders en paralelo

Querés flota de SIMs/números enviando y recibiendo mensajes para spawn de leads, sin tener que mantener un celular pegado a cada SIM ni andar abriendo WhatsApp todo el día.

### Restricciones reales de WhatsApp Multi-Device

1. **Cada número necesita un dispositivo "principal" registrado** (el celular que recibió el SMS de verificación). No es opcional.
2. El principal **no tiene que estar siempre abierto**, pero sí prendido y conectado a internet **al menos una vez cada ~14 días**, o WhatsApp empieza a expulsar dispositivos vinculados (Evolution incluido).
3. **"Eliminar cuenta" en el principal mata Multi-Device.** Definitivo.
4. **Cambiar SIM física en el principal sin "eliminar" la cuenta no es soportado**: WhatsApp Business asocia la cuenta al dispositivo, no a la SIM. Si sacás la SIM, la cuenta sigue ahí; si la "eliminás" para registrar otro número, perdés la primera.
5. **WhatsApp Business permite hasta 2 cuentas por dispositivo** (multi-cuenta nativa, desde 2023). Es decir: 1 celular = hasta 2 senders.

### Patrón operativo recomendado

**Hardware:**
- 1 celular Android usado (Android 9+, wifi) cada **2 SIMs**. Modelo barato (Moto E, Samsung A05, etc., US$60-100 usado).
- Si querés 10 senders → 5 celulares. Si querés 20 senders → 10 celulares.

**Setup por celular:**
1. Insertás SIM A, instalás WhatsApp Business, registrás con SMS.
2. Multi-cuenta → "Agregar otra cuenta" → insertás SIM B (o usás otro celular para recibir SMS si no podés tener las 2 SIMs juntas), registrás.
3. Para cada cuenta: **Configuración → Dispositivos vinculados → Vincular dispositivo**. Escaneás el QR que genera el Manager de Evolution para esa instance.
4. Guardás el celular en un cajón conectado a wifi y al cargador. **No lo tocás más.**

**Mantenimiento:**
- 1 vez por semana: prendés el celular un rato para que WhatsApp "vea" al principal y renueve los Multi-Device.
- Si una instance se cae (`connectionStatus=close`), agarrás el celular correspondiente, abrís la cuenta, vas a Dispositivos Vinculados → Vincular nuevo. 2 minutos por sender.

**Lo que NUNCA hacés:**
- "Eliminar cuenta" desde el celular principal.
- Sacar la SIM y meter otra para "reusar" el celular.
- Tener WhatsApp Web abierto sobre un SIM que está vinculado a Evolution (no es fatal pero compite por recursos Multi-Device).

### Por qué la opción "celulares descartables" gana

| Estrategia | Inversión | Problemas |
|---|---|---|
| 1 celular para todas las SIMs (cambiando SIMs) | US$0-100 | Rompe Multi-Device cada vez que cambiás. **No funciona.** |
| Números virtuales (Twilio, textverified) | US$1-5/número/mes | WhatsApp banea VoIP en días/semanas. **No escala.** |
| 1 celular usado por cada 2 SIMs | US$30-50 por sender | Funciona. **Es el camino.** |
| Servicios "WhatsApp BSP oficial" (360dialog, Twilio WA Business API) | US$50-300/mes/número + tarifas por mensaje | Solo soporta plantillas pre-aprobadas, no chat libre con leads fríos. **No sirve para outreach.** |

---

## 5. Estado actual de tu Evolution API

```
wa-sim-2  — connectionStatus=open  — owner=5491164707543 — operativa
wa-sim01  — connectionStatus=close — owner=5491164707233 — caída desde 14:15 AR (device_removed)
```

Para recuperar SIM 1: ya no podés (la cuenta fue eliminada en el celular). Tenés que decidir si querés volver a usar ese número:
- Si tenés la SIM física, ponela de nuevo en un celular, registrá WhatsApp Business, volvé a vincular Evolution.
- Si no, descartá `wa-sim01` de la tabla `senders` y usá `wa-sim-2` y futuras.

---

## 6. Próximos pasos sugeridos

**Inmediato:**
1. Decidir qué hacer con `wa-sim01` (recuperar o descartar).
2. Si vas a expandir, comprar 1-2 Androids usados y armar el setup multi-cuenta.

**Código (cuando quieras):**
1. **Health check de instancias.** Cron en Vercel que cada 5 min llama a Evolution `GET /instance/fetchInstances`, detecta `connectionStatus !== 'open'` y notifica (email/Slack/dashboard). Hoy te enteraste 4 h tarde, esto lo baja a 5 min.
2. **Indicador visual en /senders.** Bullet rojo + tooltip con `disconnectionReasonCode` cuando una instance esté caída. Botón "Reconectar" que regenere QR.
3. **Re-trigger del agente IA cuando una instance se reconecta.** Cuando una SIM vuelve a `open`, hacer un sweep de los últimos N mensajes que pudieron llegar mientras estaba caída (Evolution mantiene mensajes pendientes en algunos casos) y meterlos al inbox.
4. **Failover de envío.** Si la SIM elegida por el LRU está `close`, saltarla y usar la siguiente. Hoy el sender-pool no chequea estado.

**Operacional:**
1. Documentar el procedimiento de "agregar nuevo sender" como checklist (comprar SIM → registrar en celular → vincular Evolution → registrar en `senders`).
2. Agendar recordatorio semanal de "prender los celulares de senders" para mantener Multi-Device vivo.
