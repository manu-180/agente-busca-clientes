"""
Script para hacer login de Instagram localmente y exportar session.json
Ejecutar desde tu máquina (IP residencial) para evitar bloqueos de Railway.

Uso:
    pip install instagrapi Pillow
    python tools/login_local.py
"""
import json
import sys
from pathlib import Path

try:
    from instagrapi import Client
except ImportError:
    print("ERROR: instala instagrapi primero: pip install instagrapi Pillow")
    sys.exit(1)

USERNAME = "apex.stack"
PASSWORD = "fapfapfap3"
OUTPUT_PATH = Path(__file__).parent.parent / "session_export.json"

def main():
    print(f"[*] Haciendo login como {USERNAME}...")
    cl = Client()

    try:
        cl.login(USERNAME, PASSWORD)
        print(f"[✓] Login exitoso!")
    except Exception as e:
        print(f"[✗] Login falló: {e}")
        sys.exit(1)

    # Exportar la sesión completa
    settings = cl.get_settings()
    OUTPUT_PATH.write_text(json.dumps(settings, indent=2))
    print(f"[✓] session.json guardado en: {OUTPUT_PATH}")
    print()
    print("PRÓXIMO PASO: subir este archivo al volumen Railway")
    print("  railway run --service ig-sidecar cp session_export.json /data/session.json")
    print("  O usar Railway CLI: railway shell → cp /tmp/session.json /data/session.json")

if __name__ == "__main__":
    main()
