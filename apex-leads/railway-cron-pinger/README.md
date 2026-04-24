# Railway Cron Pinger — leads-pendientes

## Qué hace
Script Python de vida corta que Railway ejecuta según un schedule cron.
Hace un único HTTP GET al endpoint `/api/cron/leads-pendientes` de la app Next.js
desplegada en Vercel, registra el resultado con logging estructurado y termina con:
- `exit 0` → HTTP 200 (éxito)
- `exit 1` → cualquier error (auth, red, 5xx, timeout)

## Stack
- Python 3.9+ con httpx>=0.27
- Railway Cron (Nixpacks, sin Dockerfile)
- No tiene estado persistente. Cada ejecución es independiente.

## Variables de entorno (configurar en Railway Dashboard)

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `CRON_BASE_URL` | ✅ Sí | — | URL base de Vercel sin trailing slash |
| `CRON_SECRET` | ✅ Sí | — | Bearer token del endpoint cron |
| `CRON_PATH` | No | `/api/cron/leads-pendientes?force=true` | Path + query del endpoint |
| `REQUEST_TIMEOUT_S` | No | `90` | Timeout de red en segundos |

## Cómo probar localmente

```bash
# 1. Crear .env local (nunca commitear)
cp .env.example .env
# Editar .env con valores reales de Vercel

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Ejecutar el script
python main.py

# Alternativa con curl para verificar el endpoint directamente:
source .env
curl -s -w "\nHTTP Status: %{http_code}\n" \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$CRON_BASE_URL$CRON_PATH"
```

## Configuración en Railway

### 1. Crear el servicio
1. Railway Dashboard → New Project → Deploy from GitHub repo
2. Seleccionar el repositorio `apex-leads` (no hay subcarpeta de "app" separada: Root Directory = `railway-cron-pinger`)
3. En la configuración del servicio → **Root Directory**: `railway-cron-pinger`
4. Railway detecta `requirements.txt` con Nixpacks automáticamente

### 2. Variables de entorno
Ir a **Variables** del servicio y agregar las 4 variables listadas arriba.
`CRON_SECRET` debe copiarse exactamente desde Vercel Dashboard.

### 3. Schedule (cron)
Ir a **Settings → Cron Schedule** y configurar la expresión.

> ⚠️ **Railway usa UTC.** Argentina (ART) es UTC−3.
> Ejemplos de conversión:
> | Hora ART | Expresión Railway UTC |
> |---|---|
> | Cada 10 min, todo el día | `*/10 * * * *` |
> | 9:00 AM ART | `0 12 * * *` |
> | 6:00 AM ART | `0 9 * * *` |
> | Cada 5 min (recomendado para empezar) | `*/5 * * * *` |

### 4. Verificar ejecución
- **Run Now** en Railway Dashboard para disparar manualmente
- **Logs** del servicio deben mostrar `[SUCCESS] Ping completado con éxito` y HTTP 200
- Criterio de "listo": 3 ejecuciones consecutivas con HTTP 200

## Ver logs
```bash
# CLI de Railway
railway logs --tail

# O Railway Dashboard → proyecto → servicio → Logs
```

## Troubleshooting

| Síntoma en logs | Causa probable | Acción |
|---|---|---|
| `Auth error — revisar CRON_SECRET` | Token mal copiado o expirado | Copiar el valor exacto de Vercel env vars |
| `404 Not Found` | URL o path incorrecto | Verificar CRON_BASE_URL y CRON_PATH |
| `Network timeout después de 90s` | Vercel cold start muy lento | Aumentar REQUEST_TIMEOUT_S a 120 |
| `Connection error` | CRON_BASE_URL incorrecto | Verificar dominio de Vercel |
| `Server error 5xx` | Backend Next.js falló | Revisar logs en Vercel Dashboard |

## Relación con GitHub Actions
El schedule de GHA en `.github/workflows/cron-leads.yml` debe **desactivarse** (comentar
el bloque `schedule:`) una vez que Railway tenga 3 ejecuciones exitosas consecutivas.
Mantener `workflow_dispatch:` para disparos manuales de emergencia.
No coexistir ambos: riesgo de doble disparo de mensajes WhatsApp vía Twilio.

## Deuda técnica
- El endpoint Next.js no implementa idempotencia explícita. Si por error ambos (Railway + GHA)
  corren simultáneamente, puede haber doble disparo de mensajes. Mitigación: deshabilitar GHA
  antes de considerar el pinger en producción.
- Issue futuro: agregar campo `last_ping_at` en la DB para que el endpoint ignore pings
  más frecuentes de X minutos (idempotencia real).
