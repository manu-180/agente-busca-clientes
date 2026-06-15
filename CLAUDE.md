# apex_hunter — guía del proyecto

Monorepo: `apex-leads/` (Next.js, panel + crons WhatsApp, **deployado en Vercel**) y `sidecar/` (FastAPI, Instagram).

## 🚀 Deploy = git push a master (Manuel prueba en producción)

**`master` es la rama de producción.** El repo (`github.com/manu-180/agente-busca-clientes`) está conectado a Vercel: **cada push a `master` despliega solo a producción** (`leads.theapexweb.com`, proyecto Vercel `apex-leads`). No hay staging; Manuel valida en prod.

**Flujo OBLIGATORIO para cada cambio en este proyecto:**
1. Trabajar sobre `master` (no abrir ramas salvo que Manuel lo pida).
2. **Verificar antes de commitear** (desde `apex-leads/`): `npx tsc --noEmit` (0 errores) y `npx jest` (todo verde). Si hay build dudoso: `npx next build` (poné `eslint.ignoreDuringBuilds` temporal si pide configurar ESLint — el proyecto no usa ESLint).
3. **Commitear** el cambio (commits chicos y completos — recordá: **commitear = deployar a prod**, así que NO commitees trabajo a medias o roto).
4. **`git push origin master`** → Vercel despliega a producción automáticamente. (Un Stop hook local también lo pushea solo; ver `.claude/settings.local.json`.)
5. Si el cambio toca el deploy, confirmar `state: READY` vía el MCP de Vercel (`list_deployments`/`get_deployment`, project `prj_h6gFiShNAp9Ja5foPk98zqOdBbm7`, team `team_howttfzs3Q44mOpVn93EkrUm`).

## 🗄️ Base de datos (Supabase `hpbxscfbnhspeckdmkvu`)

- Acceso por MCP **`supabase-apex`** (configurado en `~/.claude.json`; necesita un PAT de la cuenta dueña del proyecto en `SUPABASE_ACCESS_TOKEN`). Los otros MCP supabase NO llegan a este proyecto (cuenta distinta).
- **Migraciones que agregan columnas/tablas usadas por el código: aplicarlas ANTES de deployar** el código que las referencia (con `apply_migration`, version = filename del repo). Si no, las queries rompen en prod.

## 📁 Fuente de verdad del trabajo en curso

`apex-leads/docs/MIGRACION-ENVIOS-WPP.md` (sistema de envío WhatsApp / anti-ban) y las memorias del proyecto. Leer antes de tocar ese subsistema.
