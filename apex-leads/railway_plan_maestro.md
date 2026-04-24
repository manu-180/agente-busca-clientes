# Railway Cron Pinger — Plan Maestro de Implementación
**Proyecto:** apex-leads (agente de leads + senders de WhatsApp)  
**Objetivo:** Reemplazar el schedule de GitHub Actions que pinga `/api/cron/leads-pendientes` por un Railway Cron Job (Enfoque A: script Python de vida corta). Ese endpoint en Vercel dispara el procesamiento de senders hacia Twilio / WhatsApp.  
**Fecha de creación:** 2026-04-22  
**Raíz del repositorio:** `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\`  
**Nota estructural:** Next.js vive en la **misma** raíz (`src/`, `app/` o equivalente); el pinger vive en `railway-cron-pinger/` y **no** modifica el build de Vercel.  

---

## Arquitectura final

```
C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\
├── railway-cron-pinger/          ← Root Directory en Railway (nuevo; solo Python)
│   ├── main.py
│   ├── requirements.txt
│   ├── railway.toml
│   ├── .env.example
│   └── README.md
├── src/                          ← App Next.js (incl. API routes) — pinger no la toca
├── package.json
└── .github\
    └── workflows\
        └── cron-leads.yml        ← ya existe: Schedule a DESHABILITAR en Fase 3
```

---

## Variables de entorno en Railway Dashboard

| Variable | Descripción | Valor de ejemplo |
|---|---|---|
| `CRON_BASE_URL` | Base de la API de producción | `https://apex-leads-six.vercel.app` |
| `CRON_SECRET` | Bearer token (copiar de Vercel env vars) | *(secreto — nunca en repo)* |
| `CRON_PATH` | Path + query del endpoint | `/api/cron/leads-pendientes?force=true` |
| `REQUEST_TIMEOUT_S` | Timeout de red en segundos | `90` |

---

## Organización de Tandas

```
TANDA 1 (PARALELA) ─────────────────────────────────────────────
  Prompt 1A → main.py            (script Python principal)
  Prompt 1B → requirements.txt + railway.toml  (config Railway)
  Prompt 1C → .env.example + README.md          (documentación)
              ↓ (todos terminan)
TANDA 2 (PARALELA entre sí, secuencial respecto a Tanda 1) ─────
  Prompt 2A → .gitignore raíz del repositorio      (seguridad)
  Prompt 2B → .github/workflows/cron-leads.yml   (desactivar GHA)
              ↓ (ambos terminan)
TANDA 3 (VALIDACIÓN — después de Tanda 1) ──────────────────────
  Prompt 3A → validate_local.ps1 + validate_local.sh  (validación local)
```

> **Regla de paralelismo:** Los prompts dentro de una misma tanda no comparten archivos y pueden ejecutarse con agentes simultáneos sin riesgo de conflicto.

---

---

# TANDA 1 — Setup de archivos del pinger (PARALELA)

> Ejecutar los 3 prompts de esta tanda **al mismo tiempo** con 3 agentes independientes.  
> Ninguno depende del resultado de los otros.

---

## Prompt 1A — Crear `main.py`

**Archivo a crear:** `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\main.py`

**Contexto para el agente:**  
Estás en el repositorio **apex-leads**, cuya raíz es `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\`. La app Next.js está en `src/` (misma raíz). **No** modifiques código en `src/` en esta tarea: solo crea `railway-cron-pinger/` y dentro el archivo `main.py`.

**Instrucción exacta:**

```
Crea el archivo `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\main.py` con el siguiente contenido exacto.

Este script es un Railway Cron Job de vida corta: hace un único HTTP GET al endpoint
/api/cron/leads-pendientes de la app Next.js desplegada en Vercel, registra el resultado
con logging estructurado (timestamp UTC ISO 8601) y termina con exit 0 (éxito) o exit 1 (fallo).

Requisitos estrictos del script:
1. Leer 4 variables de entorno: CRON_BASE_URL (requerida), CRON_SECRET (requerida),
   CRON_PATH (default: "/api/cron/leads-pendientes?force=true"), REQUEST_TIMEOUT_S (default: "90").
2. Si CRON_BASE_URL o CRON_SECRET están vacías → loguear "FATAL: Variables de entorno faltantes: {nombres}" → sys.exit(1).
3. Construir URL = CRON_BASE_URL.rstrip("/") + CRON_PATH.
4. Hacer GET con:
   - Header: Authorization: Bearer {CRON_SECRET}
   - Timeout: float(REQUEST_TIMEOUT_S)
   - Librería: httpx (síncrona, no async)
5. Logging estructurado en cada línea con formato: `{timestamp_UTC_ISO8601} [{LEVEL}] {mensaje}`.
   NIVELES válidos: INFO, SUCCESS, WARNING, ERROR, FATAL.
   NUNCA loguear el valor de CRON_SECRET ni la URL completa si contiene el secret.
   Loguear la URL SIN query string en el log de inicio (para no exponer force=true si en el futuro
   el secret va como query param).
6. Truncar el body de la respuesta a los primeros 500 caracteres antes de loguearlo.
7. Tabla de salida según status HTTP:
   - 200 → log SUCCESS "Ping completado con éxito" → sys.exit(0)
   - 401 → log ERROR "Auth error — revisar CRON_SECRET en Railway Dashboard" → sys.exit(1)
   - 404 → log ERROR "404 Not Found — revisar CRON_BASE_URL y CRON_PATH" → sys.exit(1)
   - 5xx → log ERROR "Server error {status} — el backend falló" → sys.exit(1)
   - otro → log WARNING "Status inesperado: {status}" → sys.exit(1)
8. Excepciones de red:
   - httpx.TimeoutException → log ERROR "Network timeout después de {timeout}s" → sys.exit(1)
   - httpx.ConnectError → log ERROR "Connection error: {tipo_excepcion}" → sys.exit(1)
   - cualquier otra Exception → log ERROR "Error inesperado: {tipo}: {mensaje}" → sys.exit(1)
9. Función _log(level, message) centralizada — print con flush=True.
10. Función load_config() que retorna dict con las 4 claves.
11. Función run_ping(config) que ejecuta el GET y las salidas.
12. Bloque if __name__ == "__main__": que llama a load_config() y run_ping().
13. Docstring de módulo que explique el propósito en 2 líneas.
14. Comentarios solo donde expliquen lógica no obvia. Sin comentarios triviales.
15. Compatible con Python 3.9+.

Una vez creado el archivo, verifica que:
- No haya imports no utilizados
- El bloque `if __name__ == "__main__"` esté al final
- No haya f-strings que interpolenCRON_SECRET directamente en strings logueados
- Las funciones load_config, _log y run_ping estén definidas en ese orden
```

---

## Prompt 1B — Crear `requirements.txt` y `railway.toml`

**Archivos a crear:**  
- `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\requirements.txt`  
- `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\railway.toml`

**Contexto para el agente:**  
Estás en el repositorio **apex-leads**. Crea `railway-cron-pinger/` si no existe y dentro los archivos de configuración de Railway.

**Instrucción exacta:**

```
Crea los siguientes 2 archivos dentro de `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\`.
Crea la carpeta si no existe.

--- ARCHIVO 1: requirements.txt ---
Contenido:
  httpx>=0.27,<1.0

Una sola dependencia. Railway usa Nixpacks y detecta requirements.txt automáticamente
para construir el entorno Python. No agregar más paquetes — el script solo necesita httpx.
Sin comentarios en el archivo.

--- ARCHIVO 2: railway.toml ---
Contenido en formato TOML:

[build]
builder = "nixpacks"

[deploy]
startCommand = "python main.py"
restartPolicyType = "never"

Notas sobre railway.toml:
- `builder = "nixpacks"` es explícito para que Railway no adivine.
- `startCommand = "python main.py"` ejecuta el script de vida corta.
- `restartPolicyType = "never"` es CRÍTICO: sin esto Railway podría reiniciar el proceso
  si termina con exit 1 (fallo de red, etc.), generando loops de reinicio innecesarios.
  Para un cron pinger, cada ejecución debe iniciar desde cero en el tick siguiente, no reiniciarse.

Verifica que el TOML sea sintácticamente válido (sin comillas de cierre faltantes,
sin caracteres inválidos).
```

---

## Prompt 1C — Crear `.env.example` y `README.md`

**Archivos a crear:**  
- `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\.env.example`  
- `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\README.md`

**Contexto para el agente:**  
Estás en el repositorio **apex-leads**. El endpoint `/api/cron/leads-pendientes` en Vercel dispara el flujo de senders hacia WhatsApp. El pinger hace un HTTP GET periódico a ese endpoint con `Authorization: Bearer`. Crea en `railway-cron-pinger/` el `.env.example` y el `README.md` documentando variables y despliegue.

**Instrucción exacta:**

```
Crea los siguientes 2 archivos dentro de `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\`.
Crea la carpeta si no existe.

--- ARCHIVO 1: .env.example ---
Este archivo es la plantilla documentada. Los valores reales NUNCA van aquí.
Solo nombres de variables con valores de ejemplo ficticios o vacíos.

Contenido exacto:

# Railway Cron Pinger — Variables de entorno
# Copiar como .env para pruebas locales. NUNCA commitear .env con valores reales.

# URL base de la API de producción (sin trailing slash)
CRON_BASE_URL=https://tu-app.vercel.app

# Bearer token para autenticar el cron endpoint
# Copiar el valor exacto desde Vercel Dashboard → Settings → Environment Variables → CRON_SECRET
CRON_SECRET=tu_secret_aqui

# Path + query string del endpoint a pingear (default si no se define)
CRON_PATH=/api/cron/leads-pendientes?force=true

# Timeout de red en segundos (default: 90)
REQUEST_TIMEOUT_S=90

--- ARCHIVO 2: README.md ---
Documento profesional, conciso, en español. Incluir exactamente las siguientes secciones:

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
2. Seleccionar el repositorio `apex-leads` (no hay subcarpeta de “app” separada: Root Directory = `railway-cron-pinger`)
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
```

---

---

# TANDA 2 — Integración en el repositorio (PARALELA entre sí)

> Ejecutar los 2 prompts de esta tanda **después de que la Tanda 1 esté completa**.  
> Los 2 prompts de esta tanda pueden correr en paralelo entre sí porque no comparten archivos.

---

## Prompt 2A — Actualizar `.gitignore` en la raíz de apex-leads

**Archivo a modificar/crear:** `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\.gitignore`

**Contexto para el agente:**  
En **apex-leads** el `.gitignore` de la app Next.js está en la **raíz del repositorio** (un solo `package.json` / `src/`). La carpeta `railway-cron-pinger/` tendrá un `.env` local para pruebas que NUNCA debe commitearse. Asegúrate de incluir en ese `.gitignore` raíz las reglas del pinger.

**Instrucción exacta:**

```
Necesito que revises y actualices el .gitignore de la raíz del repositorio en
`C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\.gitignore` (mismo que usa Next).

Pasos:
1. Si el archivo NO existe, créalo.
2. Si el archivo YA existe, léelo primero y solo agrega lo que falte (no duplicar reglas existentes).

El archivo debe contener como mínimo las siguientes reglas para proteger el pinger de Railway:

# Railway Cron Pinger — archivos locales
railway-cron-pinger/.env
railway-cron-pinger/__pycache__/
railway-cron-pinger/*.pyc
railway-cron-pinger/.pytest_cache/

# Entornos virtuales Python (si alguien instala las deps localmente)
railway-cron-pinger/venv/
railway-cron-pinger/.venv/
railway-cron-pinger/env/

Notas importantes:
- El archivo `railway-cron-pinger/.env.example` SÍ debe ser commiteado (es la plantilla).
- El archivo `railway-cron-pinger/.env` NUNCA debe ser commiteado (tiene valores reales).
- No borres reglas existentes de Next/Vercel; solo **añadí** reglas del pinger si faltan.
- Si el .gitignore raíz ya tiene una regla genérica `.env*` que cubre todos los `.env`,
  puedes agregar solo los __pycache__ y venv de Python, ya que .env ya estaría cubierto.
- Verifica al final con `git check-ignore -v railway-cron-pinger/.env` que el archivo
  estaría siendo ignorado (solo si git está disponible en el path).
```

---

## Prompt 2B — Crear/actualizar el workflow de GitHub Actions

**Archivo a crear/modificar:** `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\.github\workflows\cron-leads.yml`

**Contexto para el agente:**  
La raíz de **apex-leads** es `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\`. **El archivo** `.github/workflows/cron-leads.yml` **ya existe** en este repo. Debes deshabilitar el `schedule:` automático (migración a Railway) y conservar `workflow_dispatch` para emergencias. No reescribas el workflow desde cero si ya tiene lógica correcta: solo ajusta el `on:` y comentarios.

**Instrucción exacta:**

```
Necesito que gestiones el workflow de GitHub Actions del cron en
`C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\.github\workflows\cron-leads.yml`.

Pasos:
1. Crea la carpeta `.github/workflows/` si no existe.
2. Si el archivo `cron-leads.yml` NO existe: créalo con el contenido exacto que figura abajo
   (un workflow que ya tiene el schedule comentado y solo expone workflow_dispatch).
3. Si el archivo `cron-leads.yml` YA existe: léelo y modifícalo para:
   a. Comentar cualquier bloque `schedule:` existente bajo la clave `on:`.
   b. Agregar un comentario explicando que fue migrado a Railway.
   c. Preservar workflow_dispatch si ya está definido; agregarlo si no está.
   d. Preservar el resto del workflow exactamente igual (jobs, steps, etc.).

Contenido del archivo si NO existe (crear desde cero):

name: Cron — Leads Pendientes (MIGRADO A RAILWAY)

# SCHEDULE DESACTIVADO: migrado a Railway Cron Job.
# Ver: railway-cron-pinger/README.md
# Para disparo manual de emergencia usar el botón "Run workflow" en GitHub Actions.
on:
  workflow_dispatch:
    inputs:
      reason:
        description: "Motivo del disparo manual"
        required: false
        default: "Disparo manual de emergencia"

# El schedule fue migrado a Railway Cron. NO reactivar sin antes
# deshabilitar el pinger en Railway para evitar doble disparo.
# on:
#   schedule:
#     - cron: '*/10 * * * *'  # DESACTIVADO — Railway Cron activo

jobs:
  ping-leads-pendientes:
    name: Ping /api/cron/leads-pendientes
    runs-on: ubuntu-latest
    steps:
      - name: Ping endpoint
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          CRON_BASE_URL: ${{ vars.CRON_BASE_URL }}
        run: |
          echo "Disparando ping manual..."
          echo "Motivo: ${{ github.event.inputs.reason }}"
          HTTP_STATUS=$(curl -s -o /tmp/response.txt -w "%{http_code}" \
            -H "Authorization: Bearer $CRON_SECRET" \
            "$CRON_BASE_URL/api/cron/leads-pendientes?force=true")
          echo "HTTP Status: $HTTP_STATUS"
          cat /tmp/response.txt | head -c 500
          if [ "$HTTP_STATUS" != "200" ]; then
            echo "::error::El endpoint respondió con HTTP $HTTP_STATUS"
            exit 1
          fi
          echo "Ping exitoso."

Notas:
- Este workflow SOLO se ejecuta cuando alguien lo dispara manualmente desde GitHub UI.
- No tiene schedule automático (está comentado para referencia histórica).
- Si el archivo ya existía con un schedule activo, comentarlo con el bloque de comentario
  explicativo que dice "SCHEDULE DESACTIVADO: migrado a Railway Cron Job."
- Usar indentación de 2 espacios (estándar YAML de GitHub Actions).
- No modificar ningún otro archivo de `.github/workflows/`.
```

---

---

# TANDA 3 — Validación local (DESPUÉS de Tanda 1)

> Puede ejecutarse en paralelo con la Tanda 2 ya que no comparte archivos con ella.  
> Requiere que la Tanda 1 esté completa (necesita que `main.py` y `requirements.txt` existan).

---

## Prompt 3A — Crear script de validación local multiplataforma

**Archivos a crear:**  
- `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\scripts\validate_local.ps1` (Windows PowerShell)  
- `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\scripts\validate_local.sh` (bash/Linux/Mac)

**Contexto para el agente:**  
La raíz de **apex-leads** es `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\`. El script `railway-cron-pinger/main.py` ya existe. Crea scripts de validación local (PowerShell y bash) para probar el pinger antes de Railway: Python, `httpx`, variables y ejecución del script.

**Instrucción exacta:**

```
Crea la carpeta `C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\scripts\` y dentro
de ella 2 scripts de validación local. Estos scripts NO son parte del deploy en Railway;
son utilidades para el desarrollador.

--- SCRIPT 1: validate_local.ps1 (Windows PowerShell) ---
Ruta: C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\scripts\validate_local.ps1

El script debe:
1. Verificar que Python 3.9+ esté instalado. Si no → error descriptivo → exit 1.
2. Verificar que exista el archivo `railway-cron-pinger\.env` (un nivel arriba de scripts/).
   Si no existe → instruir al usuario: "Copiar .env.example como .env y completar los valores".
3. Si existe `.env`, leerlo y extraer las variables (ignorar líneas de comentarios que empiecen con #).
   Verificar que CRON_BASE_URL y CRON_SECRET no estén vacíos. Si están vacíos → error → exit 1.
4. Verificar que httpx esté instalado (`python -c "import httpx; print(httpx.__version__)"` funcione).
   Si no → ejecutar `pip install -r ../requirements.txt` automáticamente.
5. Mostrar un resumen de configuración:
   - CRON_BASE_URL: (valor completo)
   - CRON_PATH: (valor o default)
   - REQUEST_TIMEOUT_S: (valor o default)
   - CRON_SECRET: ****** (NUNCA mostrar el valor real, solo asteriscos)
6. Preguntar al usuario: "¿Ejecutar main.py ahora? (s/N)". Si responde "s" → ejecutar python ../main.py
   con las variables del .env seteadas en el proceso hijo.
7. Usar Write-Host con colores: verde para éxito, rojo para error, amarillo para warning.
8. Al inicio, mostrar un banner: "=== Railway Cron Pinger — Validación Local ==="

--- SCRIPT 2: validate_local.sh (bash) ---
Ruta: C:\MisProyectos\bots_ia\agente_busca_clientes\apex-leads\railway-cron-pinger\scripts\validate_local.sh

Equivalente bash del script anterior:
1. Verificar python3 (o python) esté disponible con python --version | grep -E "3\.[9-9]|3\.[1-9][0-9]".
2. Verificar que exista ../.env (relativo al directorio del script).
   Si no → "Copiar .env.example como .env y completar los valores" → exit 1.
3. Exportar variables del .env: `export $(grep -v '^#' ../.env | xargs)`.
4. Verificar CRON_BASE_URL y CRON_SECRET no vacíos → error si están vacíos.
5. Verificar httpx: `python -c "import httpx"`. Si falla → `pip install -r ../requirements.txt`.
6. Mostrar resumen de config con CRON_SECRET enmascarado (8 asteriscos).
7. Preguntar confirmación y ejecutar python ../main.py si el usuario confirma.
8. Usar códigos de escape ANSI para colores (verde \033[0;32m, rojo \033[0;31m, reset \033[0m).
9. Primera línea: #!/usr/bin/env bash
10. set -euo pipefail al inicio para seguridad.

En ambos scripts:
- Los comentarios explican el propósito de cada sección, no lo que hace cada línea.
- No hardcodear ningún valor de las variables de entorno.
- No loguear el valor de CRON_SECRET en ningún momento.
- Deben funcionar ejecutándose desde cualquier directorio (usar $PSScriptRoot en PS,
  y dirname "$0" en bash para rutas relativas).
```

---

---

# Checklist de Definition of Done

Usar este checklist para verificar que todo está completo antes de hacer deploy en Railway.

## Setup de archivos (verificar después de Tanda 1)
- [ ] `railway-cron-pinger/main.py` existe y tiene las funciones `_log`, `load_config`, `run_ping`
- [ ] `railway-cron-pinger/requirements.txt` contiene `httpx>=0.27,<1.0`
- [ ] `railway-cron-pinger/railway.toml` tiene `startCommand = "python main.py"` y `restartPolicyType = "never"`
- [ ] `railway-cron-pinger/.env.example` tiene las 4 variables documentadas, sin valores reales
- [ ] `railway-cron-pinger/README.md` tiene secciones: qué hace, variables, cómo probar, Railway setup, troubleshooting

## Seguridad de repo (verificar después de Tanda 2)
- [ ] El `.gitignore` en la raíz de **apex-leads** incluye `railway-cron-pinger/.env` (o patrón equivalente que no suba secretos)
- [ ] `railway-cron-pinger/.env` NO aparece en `git status` si existe localmente
- [ ] El archivo `.env.example` SÍ aparece en git como archivo commiteado

## GitHub Actions (verificar después de Tanda 2)
- [ ] `.github/workflows/cron-leads.yml` existe
- [ ] El bloque `schedule:` está comentado con nota explicativa "migrado a Railway"
- [ ] `workflow_dispatch:` está activo para disparos manuales de emergencia
- [ ] No hay runs automáticos de GHA programados (verificar en GitHub → Actions)

## Validación local (verificar después de Tanda 3)
- [ ] `railway-cron-pinger/scripts/validate_local.ps1` existe y corre sin errores en Windows
- [ ] `railway-cron-pinger/scripts/validate_local.sh` existe y tiene permisos de ejecución
- [ ] Al correr `python main.py` con las variables del `.env` real → HTTP 200 en logs → exit 0

## Railway (verificar manualmente en el dashboard)
- [ ] Servicio creado con Root Directory = `railway-cron-pinger`
- [ ] Las 4 variables de entorno están seteadas en Railway Variables
- [ ] Al menos 1 ejecución manual (Run Now) completó con HTTP 200 en logs
- [ ] El Bearer token NO aparece en los logs de Railway
- [ ] El script terminó con exit 0 en la ejecución manual
- [ ] 3 ejecuciones consecutivas por schedule con HTTP 200 ✅

## Criterio final de "migración completa"
- [ ] 3 ejecuciones consecutivas por schedule Railway con HTTP 200
- [ ] Duración de cada run < 30s en logs de Railway
- [ ] GHA schedule desactivado y sin runs automáticos desde la desactivación
- [ ] No se observan mensajes WhatsApp duplicados en producción

---

## Notas de Timezone UTC/ART

Railway usa UTC. Argentina (ART) es UTC−3.

| Expresión Railway (UTC) | Equivalente ART | Recomendación |
|---|---|---|
| `*/10 * * * *` | Cada 10 min todo el día | ✅ Para empezar |
| `*/5 * * * *` | Cada 5 min todo el día | OK si el negocio lo justifica |
| `0 9-21 * * *` | Cada hora de 6AM a 6PM ART | Si solo horario comercial |
| `0 12 * * *` | 9:00 AM ART una vez al día | Solo para casos de baja frecuencia |

Documentar el schedule elegido en el README del pinger.

---

*Plan generado el 2026-04-22. Actualizado para el repositorio **apex-leads** (Vercel + senders / WhatsApp).*
