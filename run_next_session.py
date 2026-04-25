#!/usr/bin/env python3
"""
run_next_session.py — Ejecuta el siguiente prompt de SESSION-DXX.md en sesión nueva de Claude.

Uso:
  python run_next_session.py              # Ejecuta la próxima sesión pendiente
  python run_next_session.py --status     # Solo muestra estado sin ejecutar
  python run_next_session.py --session D06  # Fuerza sesión específica
  python run_next_session.py --auto       # Skip confirmación de permisos (peligroso)
"""

import subprocess
import re
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent
PROMPTS_DIR = PROJECT_DIR / "docs/discovery/prompts"
PROGRESS_FILE = PROJECT_DIR / "docs/discovery/PROGRESS.md"


def get_sessions():
    files = sorted(PROMPTS_DIR.glob("SESSION-D*.md"))
    result = []
    for f in files:
        # Extrae el ID: SESSION-D03.md → D03
        m = re.search(r"SESSION-(D\d+)", f.stem)
        if m:
            result.append((m.group(1), f))
    return result


def get_done_from_progress():
    done = set()
    if not PROGRESS_FILE.exists():
        return done
    content = PROGRESS_FILE.read_text(encoding="utf-8")
    # ### D03\n**Status:** ✅ done
    for m in re.finditer(r"###\s+(D\d+)[^\n]*\n\*\*Status:\*\*\s*✅ done", content):
        done.add(m.group(1))
    return done


def get_done_from_git():
    done = set()
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "--all"],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        for line in result.stdout.splitlines():
            # feat(discovery): D04 ... o fix(discovery): D05 ...
            m = re.search(r"(?:feat|fix)\(discovery\)[^(]*(D\d+)", line, re.IGNORECASE)
            if m:
                done.add(m.group(1))
    except FileNotFoundError:
        pass
    return done


def get_done_sessions():
    return get_done_from_progress() | get_done_from_git()


def show_status(sessions, done):
    print("\n=== Discovery System v2 --- Estado ===\n")
    for session_id, path in sessions:
        mark = "[DONE]   " if session_id in done else "[PENDING]"
        print(f"  {session_id}  {mark}  {path.name}")
    pending = [(sid, p) for sid, p in sessions if sid not in done]
    if pending:
        print(f"\n-> Proxima a ejecutar: {pending[0][0]}\n")
    else:
        print("\n[COMPLETO] Todas las sesiones completadas.\n")


CLAUDE_CMD = "claude.cmd" if sys.platform == "win32" else "claude"


def run_session(session_id, path, auto=False):
    content = path.read_text(encoding="utf-8")
    print(f"\n[>>] Lanzando {session_id} en Claude Code...\n")
    print("-" * 50)

    cmd = [CLAUDE_CMD, "-p", content]
    if auto:
        cmd.append("--dangerously-skip-permissions")

    result = subprocess.run(cmd, cwd=PROJECT_DIR)
    if result.returncode != 0:
        print(f"\n[!] Claude salio con codigo {result.returncode}")
        sys.exit(result.returncode)
    else:
        print(f"\n[OK] {session_id} completada. Corre el script de nuevo para la siguiente.")


def main():
    args = sys.argv[1:]
    status_only = "--status" in args
    auto = "--auto" in args

    force_session = None
    if "--session" in args:
        idx = args.index("--session")
        if idx + 1 < len(args):
            force_session = args[idx + 1].upper()
            if not force_session.startswith("D"):
                force_session = "D" + force_session

    sessions = get_sessions()
    if not sessions:
        print(f"[!] No se encontraron archivos SESSION-DXX.md en {PROMPTS_DIR}")
        sys.exit(1)

    done = get_done_sessions()
    show_status(sessions, done)

    if status_only:
        return

    if force_session:
        match = [(sid, p) for sid, p in sessions if sid == force_session]
        if not match:
            print(f"[!] Sesion {force_session} no encontrada.")
            sys.exit(1)
        run_session(*match[0], auto=auto)
        return

    # Corre TODAS las pendientes en secuencia, una sesion nueva por cada una
    pending = [(sid, p) for sid, p in sessions if sid not in done]
    if not pending:
        print("[OK] No hay sesiones pendientes.")
        return

    print(f"Ejecutando {len(pending)} sesiones en secuencia: {', '.join(sid for sid, _ in pending)}\n")

    for i, (session_id, path) in enumerate(pending, 1):
        print(f"\n[{i}/{len(pending)}] ----- {session_id} -----")
        run_session(session_id, path, auto=auto)
        # Re-detecta done despues de cada sesion por si PROGRESS.md fue actualizado
        done = get_done_sessions()

    print("\n[COMPLETO] Todas las sesiones ejecutadas.")


if __name__ == "__main__":
    main()
