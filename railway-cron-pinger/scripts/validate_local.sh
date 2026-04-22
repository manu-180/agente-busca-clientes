#!/usr/bin/env bash
# Validación local del Railway Cron Pinger: Python, .env, httpx y ejecución opcional de main.py.
# Funciona aunque se invoque con ruta absoluta o relativa (no depende del CWD).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$PROJECT_ROOT/.env"
MAIN_PY="$PROJECT_ROOT/main.py"
REQ_FILE="$PROJECT_ROOT/requirements.txt"
DEFAULT_CRON_PATH='/api/cron/leads-pendientes?force=true'
DEFAULT_TIMEOUT_S='90'

G='\033[0;32m'
R='\033[0;31m'
Y='\033[0;33m'
M='\033[0m'

info() { echo -e "${G}$*${M}"; }
err()  { echo -e "${R}$*${M}"; }
warn() { echo -e "${Y}$*${M}"; }

echo -e "${G}=== Railway Cron Pinger — Validación Local ===${M}"

# 1) Python 3.9+ (python3 o python)
if command -v python3 &>/dev/null; then
  PY=python3
elif command -v python &>/dev/null; then
  PY=python
else
  err 'No se encontró python3 ni python en PATH.'
  exit 1
fi

if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
  err "Se requiere Python 3.9 o superior. Usando: $PY"
  exit 1
fi

# 2) .env
if [[ ! -f "$ENV_FILE" ]]; then
  err "No se encontró: $ENV_FILE"
  warn 'Copiar .env.example como .env y completar los valores.'
  exit 1
fi

# 3) Cargar .env en el entorno (sin mostrar secretos; tolerar CRLF)
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]// /}"
    val="${BASH_REMATCH[2]}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if [[ ${#val} -ge 2 && ${val:0:1} == '"' && ${val: -1} == '"' ]]; then val="${val:1:-1}"; fi
    if [[ ${#val} -ge 2 && ${val:0:1} == "'" && ${val: -1} == "'" ]]; then val="${val:1:-1}"; fi
    export "$key=$val"
  fi
done < "$ENV_FILE"

# 4) Comprobar variables requeridas
if [[ -z "${CRON_BASE_URL:-}" || -z "${CRON_SECRET:-}" ]]; then
  err 'CRON_BASE_URL y CRON_SECRET deben estar definidos y no vacíos en .env'
  exit 1
fi

# 5) httpx
if ! "$PY" -c 'import httpx; print(httpx.__version__)' &>/dev/null; then
  warn 'httpx no disponible. Instalando dependencias...'
  "$PY" -m pip install -r "$REQ_FILE"
fi

CRON_PATH_VAL="${CRON_PATH:-$DEFAULT_CRON_PATH}"
if [[ -z "${CRON_PATH_VAL// }" ]]; then CRON_PATH_VAL="$DEFAULT_CRON_PATH"; fi
REQ_TO_VAL="${REQUEST_TIMEOUT_S:-$DEFAULT_TIMEOUT_S}"
if [[ -z "${REQ_TO_VAL// }" ]]; then REQ_TO_VAL="$DEFAULT_TIMEOUT_S"; fi

# 6) Resumen (nunca el secreto)
info "CRON_BASE_URL: $CRON_BASE_URL"
info "CRON_PATH: $CRON_PATH_VAL"
info "REQUEST_TIMEOUT_S: $REQ_TO_VAL"
info 'CRON_SECRET: ******'

# 7) Confirmación
read -r -p "¿Ejecutar main.py ahora? (s/N) " ans
if [[ ! "${ans}" =~ ^[sS]$ ]]; then
  info 'Listo. No se ejecutó main.py.'
  exit 0
fi

exec "$PY" "$MAIN_PY"
