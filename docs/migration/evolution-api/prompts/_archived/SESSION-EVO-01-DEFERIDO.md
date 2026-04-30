# SESSION-EVO-01 — Infra Railway: deploy Evolution API + primera instancia QR

**Modelo:** claude-sonnet-4-6
**Repo:** github.com/manu-180/agente-busca-clientes (branch master)
**Tipo:** Solo infra. Cero cambios en codigo de la aplicacion Next.js.

---

## Contexto del proyecto

Estamos migrando el sistema de leads WhatsApp de Twilio a Evolution API. Esta es la primera sesion operativa: arrancar la infra de Evolution API en Railway.

**Lee antes de empezar:**
- `docs/migration/evolution-api/MASTER-PLAN.md` — plan completo
- `docs/migration/evolution-api/PROGRESS.md` — estado actual y decisiones

**Resumen de la arquitectura objetivo:**
- Evolution API self-hosted en Railway.
- N numeros de WhatsApp normales (SIM cards), cada uno conectado como una instancia Evolution API via QR scan. Sin limite de instancias — agregar una nueva = escanear QR + insertar fila en Supabase.
- La app Next.js en Vercel llama a Evolution API para enviar mensajes.
- Evolution API llama al webhook de Vercel cuando llegan mensajes.

---

## Objetivo de esta sesion

Tener Evolution API corriendo en Railway con la primera instancia (`sim01`) conectada via QR y una prueba de envio/recepcion manual confirmada.

---

## Tareas

### 1. Deploy Evolution API en Railway

Evolution API tiene imagen Docker oficial: `atendai/evolution-api:latest`

Crear un nuevo servicio en Railway con:
```
Imagen: atendai/evolution-api:latest
Variables de entorno:
  AUTHENTICATION_TYPE=apikey
  AUTHENTICATION_API_KEY=<generar un secret fuerte, anotar aqui>
  SERVER_TYPE=http
  SERVER_PORT=8080
  DATABASE_ENABLED=false       (usamos almacenamiento en memoria + volumen)
  STORE_MESSAGES=true
  STORE_MESSAGE_UP=true
  STORE_CONTACTS=true
  STORE_CHATS=true
  DEL_INSTANCE=false           (no borrar instancias automaticamente)
Puerto expuesto: 8080
Volumen: montar en /evolution/instances  (para persistir sesiones QR entre reinicios)
```

Verificar que el servicio arranca con `GET https://{railway-url}/` retornando algo (health check).

### 2. Crear instancia sim01

```bash
curl -X POST https://{EVOLUTION_API_URL}/instance/create \
  -H "apikey: {EVOLUTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "sim01",
    "integration": "WHATSAPP-BAILEYS",
    "qrcode": true
  }'
```

La respuesta incluye un `base64` con el QR code o una URL para escanearlo.

### 3. Escanear QR con SIM card 1

- Obtener el QR: `GET https://{EVOLUTION_API_URL}/instance/connect/sim01` con header `apikey`.
- La respuesta contiene `base64` del QR — renderizarlo o usar el dashboard de Evolution API.
- Escanear con WhatsApp del telefono que tiene la SIM card 1 (WhatsApp → tres puntos → Dispositivos vinculados → Vincular dispositivo).
- Verificar estado: `GET https://{EVOLUTION_API_URL}/instance/connectionState/sim01` debe retornar `state: "open"`.

### 4. Configurar webhook en sim01

Apuntar sim01 al endpoint de Vercel (para futuras sesiones):
```bash
curl -X POST https://{EVOLUTION_API_URL}/webhook/set/sim01 \
  -H "apikey: {EVOLUTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://leads.theapexweb.com/api/webhook/evolution",
    "webhook_by_events": false,
    "webhook_base64": false,
    "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"]
  }'
```

(El webhook Vercel aun no existe — se crea en SESSION-EVO-02. Esto solo preguarda la config.)

### 5. Conectar sim02 (opcional, si la SIM esta disponible)

Repetir pasos 2-3 para la segunda SIM card:
- Crear instancia `sim02`.
- Escanear QR con el segundo numero.
- Verificar estado `OPEN`.
- Configurar webhook apuntando al mismo endpoint que sim01.

### 6. Test de envio manual

Enviar un mensaje de prueba desde sim01 a tu propio numero (o a un numero de test):
```bash
curl -X POST https://{EVOLUTION_API_URL}/message/sendText/sim01 \
  -H "apikey: {EVOLUTION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "549XXXXXXXXXX",
    "text": "Test desde Evolution API sim01"
  }'
```

Confirmar que el mensaje llega al telefono de destino.

### 6. Documentar en PROGRESS.md

Actualizar `docs/migration/evolution-api/PROGRESS.md` con:
- URL Railway de Evolution API.
- EVOLUTION_API_KEY (sin mostrar el valor real, solo confirmar que esta guardado en Railway env).
- Estado de sim01: `OPEN` / fecha de conexion.
- Resultado del test de envio.
- Cualquier decision tomada (version de imagen, variables extras, etc.).

---

## Entregables de la sesion

- [ ] Servicio `evolution-api` corriendo en Railway (health check verde).
- [ ] Volumen montado en `/evolution/instances`.
- [ ] Instancia `sim01` en estado `OPEN`.
- [ ] Instancia `sim02` en estado `OPEN` (si la SIM estaba disponible).
- [ ] Test de envio: mensaje llego al telefono de destino.
- [ ] `PROGRESS.md` actualizado con URL y estado.
- [ ] Commit: `chore(evolution): SESSION-EVO-01 — Evolution API en Railway, sim01 conectada`

---

## Fuera de scope

- Cambios en `apex-leads/` (codigo Next.js). Eso va en EVO-02 y EVO-03.
- Conectar sim02–sim10. Se hace en SESSION-EVO-04 (cutover).
- Configurar daily limits por instancia. Se diseña en EVO-02.

---

## Al cerrar la sesion

1. Actualizar `docs/migration/evolution-api/PROGRESS.md` con los entregables firmados.
2. Generar el archivo `docs/migration/evolution-api/prompts/SESSION-EVO-02.md` con el prompt de arranque para la siguiente sesion.
3. El prompt de SESSION-EVO-02 debe incluir:
   - La URL de Evolution API en Railway (ya conocida).
   - El nombre del API key env var (`EVOLUTION_API_KEY`).
   - El estado actual de sim01.
   - Instruccion de leer MASTER-PLAN + PROGRESS al arrancar.
   - El scope exacto de EVO-02: `evolution.ts` + webhook route + Supabase migration.
4. Commitear todo en master.
5. Mostrarme el comando exacto para abrir la siguiente sesion:
   - Modelo: `claude-sonnet-4-6`
   - Archivo a copiar: `docs/migration/evolution-api/prompts/SESSION-EVO-02.md`
