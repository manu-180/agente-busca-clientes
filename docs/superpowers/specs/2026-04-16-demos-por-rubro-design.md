# Spec — Demos por rubro (match fuerte) para mensajes APEX

Fecha: 2026-04-16  
Proyecto: `apex-leads` (Next.js + Supabase + WhatsApp vía Wassenger)

## Objetivo

Usar **demos específicas por rubro** como palanca de ventas en dos flujos:

1) **Primer mensaje manual (outbound)**: cuando se genera el “mensaje sugerido” para abrir WhatsApp manualmente, incluir una demo *solo si aplica con match fuerte*.

2) **Agente de respuestas (inbound/outbound)**: cuando el cliente escribe por WhatsApp o desde la web (sin rubro guardado), detectar el rubro desde el texto (match fuerte) y mencionar la demo *solo cuando aporte valor y sin spamear*.

Además:

3) **Panel admin “Demos por rubro”**: permitir cargar/editar/borrar demos (URL + keywords) con persistencia en **Supabase**, de forma prolija y premium (chips editables).

## Principios / no negociables

- **Match fuerte o nada**: si no hay demo con alta confianza, **no se menciona ninguna demo**.
- **Detección determinística**: la selección de demo NO la “decide” Claude; el sistema calcula la demo aplicable y se la pasa como contexto.
- **Extensible**: agregar una demo nueva debe ser “agregar 1 entrada” (sin tocar prompts en múltiples lugares).
- **Anti-spam**: en conversaciones largas, no repetir demo continuamente.
- **WhatsApp-first**: mensajes cortos, humanos, rioplatenses; link de demo “limpio”, sin tracking por ahora.

## Estado actual (dónde se genera texto hoy)

- Primer mensaje sugerido (manual): `src/app/api/leads/generar-mensaje/route.ts`  
  Hoy llama a Claude con un prompt corto para generar un único texto.

- Agente de respuestas: `src/lib/prompts.ts` (buildAgentPrompt) + `src/app/api/webhook/wassenger/route.ts`  
  Hoy Claude responde con `systemPrompt` + historial de conversación, sin información de demos.

## Diseño propuesto

### 0) Persistencia en Supabase (fuente de verdad)

Crear tabla `demos_rubro` en Supabase. Esta tabla es la **única fuente de verdad** para:
- catálogo de demos
- keywords de matching
- habilitar/deshabilitar demos sin deploy

Campos propuestos:
- `id` uuid (PK, default gen_random_uuid())
- `slug` text UNIQUE (ej: `gym`, `moda`)
- `rubro_label` text (ej: `gimnasios`, `tienda de ropa de mujer`)
- `url` text (ej: `https://gym.theapexweb.com`)
- `strong_keywords` text[] NOT NULL default `{}`
- `weak_keywords` text[] NOT NULL default `{}`
- `negative_keywords` text[] NOT NULL default `{}`
- `active` boolean NOT NULL default true
- `priority` int NOT NULL default 0 (desempate)
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()

Notas:
- En runtime solo se consideran demos `active = true`.
- `slug` se usa para referenciar establemente demos (logs / debug / tests).

### 1) Catálogo central de demos

Crear un módulo único (ej. `src/lib/demos.ts`) con una lista declarativa.

**Evolución**: este módulo pasa a ser un “tipo/shape” y helpers; el catálogo real se lee desde Supabase (`demos_rubro`).

- `id`: identificador estable (`"gym"`, `"moda"`, etc.)
- `rubroLabel`: nombre humano para usar en copy (`"gimnasios"`, `"tienda de ropa femenina"`, etc.)
- `url`: URL pública de demo (ej. `https://gym.theapexweb.com`)
- `match`:
  - `strong_keywords`: palabras/expresiones que por sí solas son alta confianza
  - `weak_keywords`: opcional; si se usan, deben combinarse con otras señales para llegar a “fuerte”
  - `negative_keywords`: opcional; para evitar falsos positivos

Ejemplo inicial:

- Gym:
  - `url`: `https://gym.theapexweb.com`
  - `strong_keywords`: `["gimnasio","gym","crossfit","box de crossfit","entrenamiento funcional"]`
  - `weak_keywords`: `["centro de entrenamiento"]`
  - `negative_keywords` (ejemplos): `["futbol","fútbol","cancha","predio","club"]`

Futuro:

- Moda / ropa mujer:
  - `url`: `https://moda.theapexweb.com`
  - `strong_keywords`: `["ropa de mujer","indumentaria femenina","tienda de ropa de mujer"]`
  - `weak_keywords`: `["boutique"]`
  - `negative_keywords` (ejemplos): `["hotel","cerveza","cerveceria","cervecería","vino"]`

### 2) Normalización y match fuerte (determinístico)

Crear una función central (ej. `src/lib/demo-match.ts`) que:

Entrada:
- `rubroGuardado?: string | null` (si existe)
- `textos?: string[]` (mensajes recientes del cliente y/o descripción del lead)
Salida:
- `{ demo: DemoRubro | null, score: number, reason?: {...} }` (para debug)

Proceso:
- Normalizar:
  - minúsculas
  - remover tildes
  - colapsar espacios
  - remover/normalizar puntuación
  - remover formato típico de WhatsApp (`*`, `_`, `~`)
  - remover URLs (para evitar auto-match por links ya enviados)
- Calcular score por demo:
  - **strong_hit**: si aparece cualquier `strong_keywords` como *palabra o frase completa* (match con límites de palabra) → score alto inmediato
  - **weak_hit**: suma menor; cuenta cuando haya combinación suficiente de señales (ver umbrales)
  - `negative_keywords` resta/inhabilita
- Resolver:
  - ordenar por score
  - devolver la demo **solo si**:
    - score >= `STRONG_THRESHOLD`
    - y la diferencia con el segundo mejor >= `MIN_GAP` (para evitar ambigüedad)
  - si no, devolver `null`

Parámetros sugeridos (ajustables):
- `STRONG_THRESHOLD`: 100
- `strong_hit`: 100
- `weak_hit`: 50
- `MIN_GAP`: 30

**Decisión de producto ya tomada**: modo **A** (no preguntar). Si es ambiguo, no se muestra demo.

### 3) Regla anti-spam de demo en conversaciones

En el flujo de respuestas automáticas (inbound/outbound):
- Solo sugerir demo si hay match fuerte y además:
  - No se envió ya un link de demo en los últimos N mensajes del agente, o en los últimos X minutos.

Implementación mínima viable (sin cambios DB):
- Heurística sobre historial del lead:
  - si ya hay un mensaje del **agente** que contiene la `url` de esa demo → no volver a ofrecerla.
  - (no contar si la URL aparece en mensajes del cliente)

Implementación robusta (con DB, opcional):
- Guardar en `conversaciones` un `metadata`/`tags` con `demo_id` ofrecida.
- Consultar últimas conversaciones del lead para evitar repetición.

Este spec propone empezar por la **heurística** (simple y suficiente).

### 4) Integración 1: primer mensaje manual (outbound)

Archivo: `src/app/api/leads/generar-mensaje/route.ts`

Cambios:
- Calcular `demo` con `matchDemo({ rubroGuardado: rubro, textos: [descripcion, nombre, rubro] })`
- Si hay `demo`:
  - Inyectar en el `system` prompt una instrucción adicional:
    - “Si hay demo disponible para el rubro detectado, incluí 1 línea corta mencionando la demo y la URL.”
  - Pasar como contexto explícito:
    - `Demo disponible: <rubroLabel> — <url>`

Copy base recomendado (para que Claude lo adapte):
- “Te dejo una demo que armé para *{rubroLabel}* para que veas cómo podría quedar tu web: {url}”

Reglas:
- Mantener 80–250 chars (máx 300)
- 1–2 emojis profesionales máximo
- No “vender de más”: demo como prueba visual + CTA simple.

### 5) Integración 2: agente de respuestas (WhatsApp + web)

Archivos:
- `src/app/api/webhook/wassenger/route.ts` (webhook)
- `src/lib/prompts.ts` (buildAgentPrompt)

Cambios:
- Antes de construir el `systemPrompt`, calcular `demo` usando:
  - `lead.rubro` (si no es “Por definir”)
  - últimos mensajes del cliente (`mensaje` entrante + historial)
- Si el `lead.rubro` es “Por definir” y el match es fuerte:
  - actualizar `leads.rubro` a `demo.rubroLabel` (mejora data y futuros matches)
- En `buildAgentPrompt`, agregar una sección:

  “DEMOS DISPONIBLES (si aplica):
  - Si el rubro detectado coincide con una demo y NO la ofreciste aún en esta conversación, podés mencionarla UNA vez como prueba visual.
  - Si no hay demo, no la menciones.”

Además, pasarle a Claude:
- `Rubro detectado (match fuerte): <rubroLabel> | Demo: <url>`
o si no hay match:
- `Rubro detectado: (sin match fuerte) | Demo: (ninguna)`

Nota de implementación sugerida:
- Evolucionar `buildAgentPrompt(origen, apexInfo, historial)` a `buildAgentPrompt(origen, apexInfo, historial, demoContext?)` para inyectar el bloque de demos de forma centralizada.

### 6) Panel admin: “Demos por rubro” (UI premium con chips)

Objetivo del panel:
- Crear/editar/eliminar demos sin tocar código ni redeploy.
- Editar keywords en formato **chips** (tags): `strong`, `weak`, `negative`.
- Ver rápidamente qué demos están activas.
- Probar el matching con un texto real (“Test rápido”) antes de usarlo en producción.

Rutas UI:
- Nueva página: `src/app/demos/page.tsx`
- Link en sidebar: agregar item `href: '/demos'`, label `Demos`, icono sugerido `Globe` o `Sparkles`.

Componentes/UX:
- Lista de cards (estilo `Agente IA`):
  - título: `rubro_label` + badge `slug`
  - URL: link + botones `copiar` y `abrir`
  - chips por grupo (colores distintos):
    - strong: acento lime
    - weak: acento azul/neutral
    - negative: acento rojo
  - toggle `active`
  - acciones: editar / eliminar
- Form modal o form inline (como `Agente IA`) para crear/editar:
  - `slug`, `rubro_label`, `url`, `priority`, `active`
  - editores de chips para arrays: `strong_keywords`, `weak_keywords`, `negative_keywords`
    - add chip al presionar Enter / coma
    - eliminar chip con click en “x”
    - normalizar chip al guardar (trim, lower, sin duplicados)
- Sección “Test rápido”:
  - input textarea (“pegá un mensaje real del cliente”)
  - muestra resultado:
    - demo matcheada o “sin match fuerte”
    - score / gap
    - keywords que dispararon el match (si se implementa `reason`)

APIs (CRUD):
- `GET /api/demos` → lista demos (incluye inactive para panel)
- `POST /api/demos` → crear demo
- `PUT /api/demos/:id` (o PUT con body `id`) → editar demo
- `DELETE /api/demos/:id` (o DELETE con body `id`) → borrar demo
- `POST /api/demos/test` → recibe texto + rubro opcional y devuelve resultado del matcher (para panel)

Seguridad:
- Estas rutas quedan protegidas por el middleware actual (cookie `apex_auth`).
- Las APIs usan `SUPABASE_SERVICE_ROLE_KEY` como el resto del backend (patrón existente).

### 6) (Opcional / futuro) Integración 3: follow-up automático

Existe un flujo de follow-up automático (`src/lib/generar-followup.ts` + `SYSTEM_PROMPT_FOLLOWUP`) que también puede beneficiarse del mismo mecanismo de demos.

Por ahora queda fuera de alcance de esta primera iteración para reducir superficie de cambios, pero el diseño propuesto permite integrarlo luego reutilizando `matchDemo()` y agregando `Demo disponible: ...` al contexto del follow-up.

### 6) Calidad de copy (ventas, sin agresividad)

Guía para la frase de demo:
- Enfocar en beneficio: “ver cómo quedaría”, “idea clara”, “sin compromiso”.
- Evitar claims no verificables (“te va a traer X clientes”).
- CTA micro: “¿Te la paso?”, “¿Querés que lo adaptemos a tu marca?”.

Ejemplos (Gym):
- “Te dejo una demo que armé para *gimnasios* para que veas cómo podría quedar tu web: https://gym.theapexweb.com 💻”
- “Si querés, mirá esta demo para *gimnasios* (así te hacés una idea): https://gym.theapexweb.com. ¿La adaptamos a tu marca?”

## Riesgos y mitigaciones

- **Falsos positivos**: mitigado por match fuerte + threshold + gap.
- **Spam de links**: mitigado por “no repetir si la URL ya está en historial”.
- **Rubro vacío en web**: mitigado por inferencia desde texto (mensajes del cliente).

## Criterios de aceptación

- Primer mensaje manual para rubro “gimnasio/gym” incluye demo `gym.theapexweb.com`.
- Primer mensaje manual para rubro sin demo NO incluye ningún link de demo.
- Agente inbound: si cliente dice “tengo un gym/gimnasio”, menciona demo una vez.
- Agente inbound: si cliente dice “tengo gomería”, no menciona demos.
- Agregar demo nueva requiere solo editar el catálogo (sin tocar lógica en 3+ lugares).
- Panel `/demos` permite crear/editar una demo con chips y se refleja en el comportamiento sin redeploy.

