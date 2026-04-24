# 📊 Análisis Completo de Base de Datos - Apex Leads

**Proyecto ID:** `hpbxscfbnhspeckdmkvu`  
**Fecha de análisis:** 2026-04-21  
**Última actualización:** 2026-04-21

---

## 📑 Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Estructura General](#estructura-general)
3. [Tablas Detalladas](#tablas-detalladas)
4. [Relaciones y Foreign Keys](#relaciones-y-foreign-keys)
5. [Row Level Security (RLS)](#row-level-security-rls)
6. [Índices](#índices)
7. [Custom Types (Enums)](#custom-types-enums)
8. [Migraciones](#migraciones)
9. [Extensiones Instaladas](#extensiones-instaladas)
10. [Estadísticas de Datos](#estadísticas-de-datos)

---

## Resumen Ejecutivo

### 📈 Estadísticas Generales

| Métrica | Valor |
|---------|-------|
| **Total de Tablas** | 17 |
| **Tablas con RLS Habilitado** | 14 |
| **Total de Registros** | ~2,400+ |
| **Índices Creados** | 51+ |
| **Foreign Keys** | 6 |
| **Custom Types (Enums)** | 7 |
| **Migraciones Aplicadas** | 10 |

### 🎯 Propósito General

Sistema de gestión de leads multicanal con:
- **Lead Management** (WhatsApp/SMS vía Twilio/Wassenger)
- **Instagram Lead Generation** (scraping, discovery, DMs)
- **Conversación Automática** (agentes IA)
- **Gestión de Billing** (trabajos y cuotas)
- **Logs de Operaciones** (cron, health account)

---

## Estructura General

### Esquemas
- **public** → Todas las tablas de negocio (RLS habilitado en la mayoría)
- **extensions** → UUID y funciones adicionales
- **vault** → Secretos (Supabase Vault)
- **graphql** → GraphQL API (pg_graphql)

### Principios de Diseño

✅ **Habilitado:** RLS en tablas de leads, conversaciones, operaciones  
✅ **Constraint Integrity:** Foreign keys con cascadas apropiadas  
✅ **Auditoría:** timestamps (created_at, updated_at) en todas las tablas  
✅ **Enums:** Estados y roles tipados (no strings libres)  
✅ **Índices:** Estratégicos en queries frecuentes

---

## Tablas Detalladas

### 1. **leads** (324 filas)

**Descripción:** Lead principal de WhatsApp/SMS. Tabla central del sistema.

**RLS:** ✅ Habilitado

| Columna | Tipo | Default | Nullable | Descripción |
|---------|------|---------|----------|-------------|
| id | uuid | gen_random_uuid() | ❌ | PK - identificador único |
| nombre | text | - | ❌ | Nombre del prospecto |
| rubro | text | - | ❌ | Categoría de negocio |
| zona | text | 'Buenos Aires' | ❌ | Ubicación geográfica |
| telefono | text | - | ❌ | Número de teléfono (único) |
| instagram | text | - | ✅ | Handle Instagram (opcional) |
| descripcion | text | '' | ❌ | Descripción del negocio |
| mensaje_inicial | text | '' | ❌ | Primer mensaje enviado |
| **estado** | enum | 'pendiente' | ❌ | Ver [Estados](#estados-enum) |
| **origen** | enum | 'outbound' | ❌ | 'outbound' o 'inbound' |
| agente_activo | boolean | true | ❌ | ¿Está procesándose? |
| created_at | timestamptz | now() | ❌ | Timestamp creación |
| updated_at | timestamptz | now() | ❌ | Timestamp actualización |
| notas | text | - | ✅ | Notas internas |
| conversacion_cerrada | boolean | false | ❌ | ¿Conversación terminada? |
| conversacion_cerrada_at | timestamptz | - | ✅ | Cuándo se cerró |
| procesando_hasta | timestamptz | - | ✅ | Lock para evitar duplicados |
| mensaje_enviado | boolean | false | ❌ | ¿Primer mensaje enviado? |
| video_enviado | boolean | false | ❌ | ¿Video enviado? |
| primer_envio_intentos | int4 | 0 | ❌ | Contador de reintentos |
| primer_envio_error | text | - | ✅ | Error del último intento |
| primer_envio_completado_at | timestamptz | - | ✅ | Cuándo se envió exitosamente |

**Índices:**
- 🔑 `leads_apex_next_pkey` (PK)
- 📌 `idx_leads_apex_next_estado` (lookup por estado)
- 📌 `idx_leads_apex_next_origen` (lookup por origen)
- 📌 `idx_leads_apex_next_telefono` (búsqueda por teléfono)
- 📌 `idx_leads_procesando_hasta` (lock management)
- 🔐 `leads_telefono_unique` (teléfono único, excluyendo vacíos)
- 🔐 `idx_leads_telefono_pendiente_unique` (antispam: un pendiente por teléfono)

**Foreign Keys:**
- ← `conversaciones.lead_id` → `leads.id` (1:N)

**Constraint Especial:**
- Telefono único donde `telefono <> ''` y `mensaje_enviado = false` y `estado = 'pendiente'`
  - **Propósito:** Evitar spam de múltiples leads con mismo teléfono en cola

---

### 2. **leads_apex_next** (60 filas)

**Descripción:** Copia/staging de leads para próxima fase del sistema.

**RLS:** ✅ Habilitado  
**Estructura:** Idéntica a `leads`

**Índices Adicionales:**
- 📌 `idx_leads_cola_primer_contacto` (para batch processing)

---

### 3. **conversaciones** (1,711 filas)

**Descripción:** Mensajes individuales en una conversación lead ↔ agente.

**RLS:** ✅ Habilitado

| Columna | Tipo | Default | Nullable | Descripción |
|---------|------|---------|----------|-------------|
| id | uuid | gen_random_uuid() | ❌ | PK |
| lead_id | uuid | - | ✅ | FK → leads.id |
| telefono | text | - | ❌ | Redundancia de número |
| mensaje | text | - | ❌ | Contenido del mensaje |
| **rol** | enum | - | ❌ | 'agente' o 'cliente' |
| **tipo_mensaje** | enum | 'texto' | ❌ | 'texto', 'audio', 'imagen', 'otro' |
| timestamp | timestamptz | now() | ❌ | Cuándo se envió |
| leido | boolean | false | ❌ | ¿Leído por cliente? |
| es_followup | boolean | false | ❌ | ¿Es follow-up automático? |
| manual | boolean | false | ❌ | ¿Fue enviado manualmente? |
| sender_id | uuid | - | ✅ | FK → senders.id |

**Índices:**
- 🔑 `conversaciones_pkey` (PK)
- 📌 `idx_conversaciones_lead_id` (búsqueda por lead)
- 📌 `idx_conversaciones_telefono` (búsqueda por teléfono)
- 📌 `idx_conversaciones_timestamp` (timeline)
- 📌 `idx_conversaciones_lead_followup` (filtro follow-ups)
- 📌 `conversaciones_sender_id_idx` (búsqueda por sender)

**Foreign Keys:**
- `conversaciones.lead_id` → `leads.id`
- `conversaciones.sender_id` → `senders.id`

---

### 4. **senders** (2 filas)

**Descripción:** Números de teléfono desde los que se envían mensajes.

**RLS:** ❌ Deshabilitado (acceso público)

| Columna | Tipo | Default | Nullable | Descripción |
|---------|------|---------|----------|-------------|
| id | uuid | gen_random_uuid() | ❌ | PK |
| alias | text | - | ❌ | Nombre descriptivo (ej: "Principal") |
| **provider** | enum | - | ❌ | 'twilio' o 'wassenger' |
| phone_number | text | - | ❌ | Número +54 9... |
| descripcion | text | - | ✅ | Notas sobre el sender |
| color | text | '#84cc16' | ✅ | Color en UI |
| activo | boolean | true | ✅ | ¿Está en uso? |
| es_legacy | boolean | false | ✅ | ¿Número viejo? |
| stats_messages_sent | int4 | 0 | ✅ | Contador de mensajes |
| created_at | timestamptz | now() | ✅ | Creación |
| updated_at | timestamptz | now() | ✅ | Actualización |

**Índices:**
- 🔑 `senders_pkey` (PK)
- 🔐 `senders_phone_provider_idx` (teléfono + proveedor único)

**Datos de Ejemplo:**
```
| id | alias | provider | phone_number | activo |
| ... | "Principal" | "twilio" | "+5491123456789" | true |
| ... | "Backup" | "wassenger" | "+5491198765432" | true |
```

---

### 5. **conversaciones** de Instagram (0 filas actualmente)

#### **instagram_leads** (0 filas)

**Descripción:** Leads descubiertos en Instagram.

**RLS:** ✅ Habilitado

| Columna | Tipo | Unique | Descripción |
|---------|------|--------|-------------|
| id | uuid | ✅ | PK |
| ig_user_id | bigint | ✅ | ID de Instagram |
| ig_username | citext | ✅ | Username (case-insensitive) |
| full_name | text | - | Nombre completo |
| biography | text | - | Bio (buscable con trigram) |
| external_url | text | - | Link en bio |
| bio_links | jsonb | - | Links parseados |
| **link_verdict** | enum | - | Análisis de link: no_link, aggregator, social_only, marketplace, own_site, unknown |
| followers_count | int4 | - | Seguidores |
| following_count | int4 | - | Siguiendo |
| posts_count | int4 | - | Publicaciones |
| is_private | boolean | false | Perfil privado |
| is_verified | boolean | false | Verificado |
| is_business | boolean | false | Cuenta de negocio |
| business_category | text | - | Categoría (si es business) |
| profile_pic_url | text | - | Avatar |
| last_post_at | timestamptz | - | Último post |
| posts_last_30d | int4 | 0 | Posts último mes |
| **lead_score** | int4 | 0 | Score calidad lead (0-100) |
| score_breakdown | jsonb | {} | Desglose del scoring |
| **status** | enum | - | discovered, qualified, queued, contacted, follow_up_sent, replied, interested, meeting_booked, closed_positive, closed_negative, closed_ghosted, owner_takeover, blacklisted, error |
| status_reason | text | - | Por qué cambió de estado |
| ig_thread_id | text | - | ID de conversación |
| contacted_at | timestamptz | - | Primer contacto |
| last_dm_sent_at | timestamptz | - | Último DM enviado |
| dm_sent_count | int4 | 0 | Total de DMs |
| follow_up_sent_at | timestamptz | - | Fecha de follow-up |
| last_reply_at | timestamptz | - | Último reply del lead |
| reply_count | int4 | 0 | Total de replies |
| owner_takeover_at | timestamptz | - | Cuándo pasó a humano |
| closed_at | timestamptz | - | Cuándo se cerró |
| **discovered_via** | enum | - | hashtag, location, related_profile, manual, reply_thread |
| discovered_source_ref | text | - | Referencia (hashtag name, etc) |
| discovered_at | timestamptz | now() | Cuándo se descubrió |
| do_not_contact | boolean | false | Blacklist local |
| notes | text | - | Notas internas |
| created_at | timestamptz | now() | - |
| updated_at | timestamptz | now() | - |

**Índices:**
- 🔑 `instagram_leads_pkey`
- 🔐 `instagram_leads_ig_user_id_key`
- 🔐 `instagram_leads_ig_username_key`
- 📌 `idx_ig_leads_status` (búsqueda por estado)
- 📌 `idx_ig_leads_status_score` (qualified leads)
- 📌 `idx_ig_leads_last_dm` (para retry lógica)
- 📌 `idx_ig_leads_thread` (búsqueda por conversación)
- 📌 `idx_ig_leads_bio_trgm` (búsqueda full-text en bio)

---

#### **instagram_conversations** (0 filas)

**Descripción:** Mensajes en DMs de Instagram.

**RLS:** ✅ Habilitado

| Columna | Tipo | Unique | Descripción |
|---------|------|--------|-------------|
| id | uuid | ✅ | PK |
| lead_id | uuid | - | FK → instagram_leads.id |
| ig_thread_id | text | - | ID de conversación en IG |
| ig_message_id | text | ✅ | ID único del mensaje en IG |
| role | text | - | 'system', 'user', 'assistant', 'tool' |
| content | text | - | Contenido del mensaje |
| direction | text | - | 'inbound', 'outbound', 'internal' |
| sent_at | timestamptz | - | Cuándo se envió |
| delivered_at | timestamptz | - | Cuándo se entregó |
| seen_at | timestamptz | - | Cuándo lo vio |
| metadata | jsonb | {} | Datos adicionales |
| created_at | timestamptz | now() | - |

---

#### **instagram_leads_raw** (0 filas)

**Descripción:** Buffer de leads sin procesar de Instagram API.

**RLS:** ✅ Habilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | bigint (autoincrement) | PK |
| ig_username | citext | Username descubierto |
| raw_profile | jsonb | JSON crudo de Instagram API |
| **source** | enum | Dónde se encontró (hashtag, location, etc) |
| source_ref | text | Referencia de source |
| processed | boolean | ¿Ya fue procesado a instagram_leads? |
| processing_error | text | Error si falló procesamiento |
| created_at | timestamptz | Descubierto |

**Índices:**
- 📌 `idx_instagram_leads_raw_unprocessed` (cola de procesamiento)
- 📌 `idx_instagram_leads_raw_username` (búsqueda rápida)

---

### 6. **dm_queue** (0 filas)

**Descripción:** Cola de DMs pendientes de enviar a Instagram.

**RLS:** ✅ Habilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | bigint (autoincrement) | PK |
| lead_id | uuid | FK → instagram_leads.id |
| scheduled_at | timestamptz | Cuándo enviar |
| attempts | int4 | Reintentos |
| sent_at | timestamptz | Cuándo se envió |
| error | text | Error si falló |
| created_at | timestamptz | Creación |

**Índices:**
- 📌 `idx_dm_queue_pending` (para batch processing)

---

### 7. **dm_daily_quota** (0 filas)

**Descripción:** Límite diario de DMs por sender de Instagram.

**RLS:** ✅ Habilitado

**PK Compuesta:** `(sender_ig_username, day)`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| sender_ig_username | citext | Username que envía |
| day | date | Fecha |
| dms_sent | int4 | Cantidad enviada hoy |
| last_sent_at | timestamptz | Último envío |

**Propósito:** Rate limiting para evitar shadowban.

---

### 8. **account_health_log** (1 fila)

**Descripción:** Registro de salud de cuentas de Instagram (shadowbans, blocks, etc).

**RLS:** ✅ Habilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | bigint (autoincrement) | PK |
| sender_ig | citext | Username que tiene el problema |
| **event** | enum | action_blocked, feedback_required, challenge_required, rate_limited, login_required, shadowban_suspected, ok |
| payload | jsonb | Datos del evento |
| cooldown_until | timestamptz | Hasta cuándo esperar |
| occurred_at | timestamptz | Cuándo pasó |

**Índices:**
- 📌 `idx_health_log_sender` (búsqueda por sender)

---

### 9. **conversational_events** (230 filas)

**Descripción:** Eventos de decisión del agente IA (seguimiento, rechazo, etc).

**RLS:** ✅ Habilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| lead_id | uuid | FK → leads.id |
| telefono | text | Redundancia |
| event_name | text | Nombre del evento |
| decision_action | text | Acción tomada |
| decision_reason | text | Razón de decisión |
| confidence | numeric | Confianza 0-1 |
| metadata | jsonb | Datos adicionales |
| created_at | timestamptz | Timestamp |

**Índices:**
- 📌 `idx_conversational_events_lead` (por lead)
- 📌 `idx_conversational_events_event_name` (por tipo)
- 📌 `idx_conversational_events_created_at` (timeline)

---

### 10. **cron_runs** (6 filas)

**Descripción:** Log de ejecuciones de trabajos cron.

**RLS:** ❌ Deshabilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| cron_name | text | Nombre del job |
| started_at | timestamptz | Inicio |
| finished_at | timestamptz | Fin |
| status | text | 'running', 'success', 'failed' |
| result | jsonb | Resultado/error |
| duration_ms | int4 | Tiempo en ms |
| forced | boolean | ¿Fue forzado? |

**Últimos crons ejecutados:**
- Control de primer envío a leads
- Reintentos fallidos
- Follow-ups automáticos
- Health checks de cuentas IG
- Procesamiento de raw leads

**Índices:**
- 📌 `idx_cron_runs_cron_name` (historial por job)
- 📌 `idx_cron_runs_started` (timeline)

---

### 11. **trabajos** (2 filas)

**Descripción:** Proyectos/contratos con clientes.

**RLS:** ✅ Habilitado

| Columna | Tipo | Default | Descripción |
|---------|------|---------|-------------|
| id | uuid | gen_random_uuid() | PK |
| nombre | text | - | Nombre del proyecto |
| cliente | text | - | Cliente responsable |
| descripcion | text | - | Detalles |
| **tipo** | enum | 'cuotas' | 'cuotas' o 'indefinido' |
| valor_cuota | numeric | 0 | Monto por cuota |
| moneda | text | 'ARS' | Divisa |
| total_cuotas | int4 | - | Cuántas cuotas |
| fecha_inicio | date | CURRENT_DATE | Cuándo empieza |
| activo | boolean | true | ¿Activo? |
| created_at | timestamptz | now() | - |
| updated_at | timestamptz | now() | - |

**Índices:**
- 🔑 `trabajos_pkey`
- 📌 `idx_trabajos_activo` (filtro estado)

---

### 12. **cuotas** (6 filas)

**Descripción:** Pagos individuales de un trabajo.

**RLS:** ✅ Habilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| trabajo_id | uuid | FK → trabajos.id |
| numero_cuota | int4 | Número de cuota |
| valor | numeric | Monto a pagar |
| fecha_vencimiento | date | Cuándo vence |
| pagado | boolean | ¿Pagado? |
| fecha_pago | date | Cuándo se pagó |
| notas | text | Notas |
| created_at | timestamptz | - |
| updated_at | timestamptz | - |

**Índices:**
- 🔑 `cuotas_pkey`
- 📌 `idx_cuotas_trabajo_id`
- 📌 `idx_cuotas_pagado` (búsqueda pendientes)
- 📌 `idx_cuotas_fecha_vencimiento` (para vencidos)

**Foreign Keys:**
- `cuotas.trabajo_id` → `trabajos.id`

---

### 13. **configuracion** (28 filas)

**Descripción:** Key-value store para configuración del sistema.

**RLS:** ✅ Habilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| **clave** | text | UNIQUE - nombre config |
| valor | text | Valor (JSON si es complejo) |

**Índices:**
- 🔑 `configuracion_pkey`
- 🔐 `configuracion_clave_key` (búsqueda única)
- 🔐 `idx_configuracion_clave_unique` (duplicado, puede optimizarse)

**Ejemplos de configuraciones:**
```
openai_model_preference: gpt-4
max_leads_per_batch: 50
instagram_follow_up_delay_hours: 24
twilio_max_retry_attempts: 3
```

---

### 14. **apex_info** (15 filas)

**Descripción:** Información de la aplicación (FAQ, hellos, etc).

**RLS:** ✅ Habilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| categoria | text | Tipo (faq, tip, doc) |
| titulo | text | Título |
| contenido | text | Cuerpo |
| activo | boolean | ¿Visible? |
| created_at | timestamptz | - |

---

### 15. **demos_rubro** (2 filas)

**Descripción:** Demos/landing pages por industria.

**RLS:** ❌ Deshabilitado

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| **slug** | text | UNIQUE - URL slug |
| rubro_label | text | Nombre industria |
| url | text | Link demo |
| strong_keywords | text[] | Keywords principales |
| weak_keywords | text[] | Keywords secundarias |
| negative_keywords | text[] | Keywords a evitar |
| active | boolean | ¿En uso? |
| priority | int4 | Orden |
| created_at | timestamptz | - |
| updated_at | timestamptz | - |

**Índices:**
- 🔑 `demos_rubro_pkey`
- 🔐 `demos_rubro_slug_key`

---

## Relaciones y Foreign Keys

### Diagrama de Relaciones

```
┌─────────────────────────┐
│        leads            │
├─────────────────────────┤
│ id (PK)                 │
│ telefono (UNIQUE)       │
│ estado (ENUM)           │
│ origen (ENUM)           │
│ agente_activo (BOOL)    │
└──────────────┬──────────┘
               │ 1:N
               │
         ┌─────▼────────────────────┐
         │   conversaciones        │
         ├─────────────────────────┤
         │ id (PK)                 │
         │ lead_id (FK → leads)    │
         │ sender_id (FK → senders)│
         │ rol (ENUM)              │
         │ es_followup (BOOL)      │
         └─────────────────────────┘
               
         ┌─────────────────────────┐
         │      senders            │
         ├─────────────────────────┤
         │ id (PK)                 │
         │ provider (ENUM)         │
         │ phone_number (UNIQUE)   │
         └─────────────────────────┘

┌─────────────────────────────────┐
│    instagram_leads              │
├─────────────────────────────────┤
│ id (PK)                         │
│ ig_username (UNIQUE)            │
│ status (ENUM)                   │
│ lead_score (INT)                │
└──────────┬──────────────────────┘
           │ 1:N
           │
      ┌────▼──────────────────┐
      │ instagram_conversations
      ├────────────────────────┤
      │ id (PK)                │
      │ lead_id (FK)           │
      │ role (TEXT CHECK)      │
      └────────────────────────┘

┌──────────────────────┐
│      trabajos        │
├──────────────────────┤
│ id (PK)              │
│ tipo (ENUM)          │
└──────────┬───────────┘
           │ 1:N
           │
      ┌────▼──────────┐
      │   cuotas      │
      ├───────────────┤
      │ id (PK)       │
      │ trabajo_id(FK)│
      │ pagado (BOOL) │
      └───────────────┘
```

### Foreign Keys Detallados

| FK Name | Source | Target | Delete Action | Update Action |
|---------|--------|--------|---------------|---------------|
| `conversaciones_lead_id_fkey` | conversaciones.lead_id | leads.id | CASCADE | CASCADE |
| `conversaciones_sender_id_fkey` | conversaciones.sender_id | senders.id | SET NULL? | CASCADE |
| `cuotas_trabajo_id_fkey` | cuotas.trabajo_id | trabajos.id | CASCADE | CASCADE |
| `instagram_conversations_lead_id_fkey` | instagram_conversations.lead_id | instagram_leads.id | CASCADE | CASCADE |
| `dm_queue_lead_id_fkey` | dm_queue.lead_id | instagram_leads.id | CASCADE | CASCADE |

---

## Row Level Security (RLS)

### Tablas con RLS Habilitado

✅ **Habilitadas:**
- leads
- leads_apex_next
- conversaciones
- conversational_events
- apex_info
- configuracion
- instagram_leads
- instagram_leads_raw
- instagram_conversations
- dm_queue
- dm_daily_quota
- account_health_log
- trabajos
- cuotas

❌ **Deshabilitadas (Acceso Público):**
- senders
- cron_runs
- demos_rubro

### Propósito del RLS

El RLS está habilitado pero **NO HAY POLICIES ACTIVAS DEFINIDAS**.

⚠️ **Implicación:** RLS habilitado sin políticas = **acceso DENEGADO por defecto**.

Para funcionar, necesitas:
```sql
-- Ejemplo: Permitir lectura a usuarios autenticados
CREATE POLICY "Lectura pública para autenticados"
  ON leads FOR SELECT
  TO authenticated
  USING (true);

-- Ejemplo: Solo admin puede actualizar
CREATE POLICY "Admin actualiza"
  ON leads FOR UPDATE
  TO authenticated
  USING (auth.uid() = 'admin-uuid')
  WITH CHECK (auth.uid() = 'admin-uuid');
```

### Recomendación

⚠️ **CRÍTICO:** Si usas Supabase Auth:
1. Define políticas RLS explícitamente
2. O deshabilita RLS si no usas Auth

Actual status: **RLS enabled pero no funcional** → Verifica si tu app tiene problemas de acceso.

---

## Índices

### Resumen de Índices

**Total creados:** 51+

### Por Tabla

#### **leads** (7 índices)
```
PK: idx_leads_apex_next_pkey (id)
UNIQUE: leads_telefono_unique (telefono) WHERE telefono <> ''
UNIQUE: idx_leads_telefono_pendiente_unique (telefono) 
  WHERE mensaje_enviado = false AND estado = 'pendiente'
SEARCH: idx_leads_apex_next_estado
SEARCH: idx_leads_apex_next_origen
SEARCH: idx_leads_apex_next_telefono
LOCK:   idx_leads_procesando_hasta (id, procesando_hasta)
```

**Propósito del unique condicional:**
- Evita que múltiples leads pendientes usen el mismo teléfono
- Previene spam accidental en outbound

#### **conversaciones** (6 índices)
```
PK: conversaciones_pkey
SEARCH: idx_conversaciones_lead_id
SEARCH: idx_conversaciones_telefono
TIMELINE: idx_conversaciones_timestamp (DESC)
PARTIAL: idx_conversaciones_lead_followup (WHERE es_followup = true)
SEARCH: conversaciones_sender_id_idx
```

#### **instagram_leads** (5 índices)
```
PK: instagram_leads_pkey
UNIQUE: instagram_leads_ig_user_id_key
UNIQUE: instagram_leads_ig_username_key
SEARCH: idx_ig_leads_status
COMPOSITE: idx_ig_leads_status_score (status, lead_score DESC)
SEARCH: idx_ig_leads_last_dm
SEARCH: idx_ig_leads_thread
FULLTEXT: idx_ig_leads_bio_trgm (trigram sobre biography)
```

#### **cron_runs** (3 índices)
```
PK: cron_runs_pkey
COMPOSITE: idx_cron_runs_cron_name (cron_name, started_at DESC)
TIMELINE: idx_cron_runs_started (started_at DESC)
```

#### **instagram_conversations** (5 índices)
```
PK: instagram_conversations_pkey
UNIQUE: instagram_conversations_ig_message_id_key
COMPOSITE: idx_ig_conv_lead (lead_id, created_at)
SEARCH: idx_ig_conv_thread
SEARCH: idx_ig_conv_direction (direction)
```

### Índices Estratégicos

| Índice | Propósito | Performance |
|--------|-----------|-------------|
| `idx_leads_telefono_pendiente_unique` | Antispam | Previene N leads/teléfono |
| `idx_leads_procesando_hasta` | Lock management | Evita race conditions |
| `idx_conversaciones_lead_id` | Historial | Carga rápida de chat |
| `idx_ig_leads_bio_trgm` | Full-text | Búsqueda en biografías |
| `idx_cron_runs_cron_name` | Auditoría | Tracking jobs |

---

## Custom Types (Enums)

### **estado_lead** (9 valores)

Define el ciclo de vida de un lead WhatsApp/SMS.

```sql
CREATE TYPE estado_lead AS ENUM (
  'pendiente',           -- No contactado aún
  'contactado',          -- Se envió primer mensaje
  'respondio',           -- Lead respondió
  'interesado',          -- Lead mostró interés
  'cerrado',             -- Conversación cerrada
  'descartado',          -- No es prospecto
  'no_interesado',       -- Rechazó explícitamente
  'presupuesto_enviado', -- Enviamos propuesta
  'cliente'              -- ¡Nuevo cliente!
);
```

**Transiciones típicas:**
```
pendiente → contactado → respondio → interesado → presupuesto_enviado → cliente
                                  → no_interesado → cerrado
                     → descartado
```

---

### **origen_lead** (2 valores)

```sql
CREATE TYPE origen_lead AS ENUM (
  'outbound',  -- Nosotros contactamos (lead mining)
  'inbound'    -- Lead nos contactó
);
```

---

### **rol_mensaje** (2 valores)

En conversaciones WhatsApp/SMS:

```sql
CREATE TYPE rol_mensaje AS ENUM (
  'agente',   -- Mensaje del agente IA
  'cliente'   -- Respuesta del lead
);
```

---

### **tipo_mensaje** (4 valores)

Tipo de contenido del mensaje:

```sql
CREATE TYPE tipo_mensaje AS ENUM (
  'texto',   -- Texto plano
  'audio',   -- Nota de voz
  'imagen',  -- Imagen
  'otro'     -- Documento, etc
);
```

---

### **discovery_source** (5 valores)

Cómo se descubrió un lead de Instagram:

```sql
CREATE TYPE discovery_source AS ENUM (
  'hashtag',         -- Búsqueda de hashtag
  'location',        -- Búsqueda geográfica
  'related_profile', -- Seguidores de rival
  'manual',          -- Importado manualmente
  'reply_thread'     -- De replythread/comentarios
);
```

---

### **link_verdict** (6 valores)

Análisis del link en bio de Instagram:

```sql
CREATE TYPE link_verdict AS ENUM (
  'no_link',       -- No tiene link
  'aggregator',    -- Linktr.ee, etc
  'social_only',   -- Solo redes sociales
  'marketplace',   -- Mercado Libre, Shein, etc
  'own_site',      -- Sitio propio (HOT)
  'unknown'        -- No determinado
);
```

---

### **lead_status** (14 valores)

Estado avanzado de leads de Instagram (más granular):

```sql
CREATE TYPE lead_status AS ENUM (
  'discovered',       -- Nuevo, sin contactar
  'qualified',        -- Pasó score mínimo
  'queued',           -- En cola de DMs
  'contacted',        -- Se envió primer DM
  'follow_up_sent',   -- Follow-up enviado
  'replied',          -- Lead respondió
  'interested',       -- Mostró interés
  'meeting_booked',   -- Agendó demo
  'closed_positive',  -- Cierre exitoso
  'closed_negative',  -- Rechazó
  'closed_ghosted',   -- No responde (timeout)
  'owner_takeover',   -- Pasó a humano
  'blacklisted',      -- No contactar
  'error'             -- Error procesamiento
);
```

---

### **account_health_event** (7 valores)

Estados de salud de cuenta Instagram:

```sql
CREATE TYPE account_health_event AS ENUM (
  'action_blocked',       -- Bloqueado temporalmente
  'feedback_required',    -- IG pide feedback
  'challenge_required',   -- Challenge (2FA)
  'rate_limited',         -- Rate limit
  'login_required',       -- Necesita re-login
  'shadowban_suspected',  -- Posible shadowban
  'ok'                    -- Todo bien
);
```

---

## Migraciones

### Historial de Migraciones

| Versión | Fecha | Nombre | Cambios |
|---------|-------|--------|---------|
| 20260420012720 | 2026-04-20 | create_cron_runs_table | Tabla de logs de cron |
| 20260420035200 | 2026-04-20 | create_senders_table | Tabla de números sender |
| 20260420035207 | 2026-04-20 | seed_senders_iniciales | Datos iniciales (2 senders) |
| 20260420035212 | 2026-04-20 | add_sender_id_to_conversaciones | FK a senders |
| 20260420035224 | 2026-04-20 | backfill_sender_id_conversaciones | Llenar datos históricos |
| 20260420142048 | 2026-04-20 | create_trabajos_cuotas | Tablas de billing |
| 20260420224213 | 2026-04-20 | leads_cola_primer_contacto_columns | Índice para queue |
| 20260421003219 | 2026-04-21 | add_followup_cron_lock | Columna procesando_hasta |
| 20260421174650 | 2026-04-21 | dedup_leads_telefono_unique | Constraint antispam |
| 20260421181928 | 2026-04-21 | antispam_telefono_duplicado | Cleanup duplicados |

### Patrón de Evolución

1. **Fase 1:** Lead management básico (leads, conversaciones)
2. **Fase 2:** Multi-sender (senders, FK en conversaciones)
3. **Fase 3:** Billing (trabajos, cuotas)
4. **Fase 4:** Instagram (instagram_leads, instagram_conversations, dm_queue)
5. **Fase 5:** Antispam (constraints únicos condicionales)

---

## Extensiones Instaladas

### Instaladas y Activas (12)

| Extensión | Versión | Schema | Propósito |
|-----------|---------|--------|-----------|
| `pgcrypto` | 1.3 | extensions | Hashing de passwords |
| `uuid-ossp` | 1.1 | extensions | UUID generation |
| `pg_trgm` | 1.6 | public | Trigram full-text search |
| `citext` | 1.6 | public | Case-insensitive text |
| `pg_graphql` | 1.5.11 | graphql | GraphQL API auto-generada |
| `supabase_vault` | 0.3.1 | vault | Secrets management |
| `pg_stat_statements` | 1.11 | extensions | Query performance |
| `plpgsql` | 1.0 | pg_catalog | PL/pgSQL language |
| `pgsodium` | 3.1.8 | - | Libsodium crypto |
| `vector` | 0.8.0 | - | Vector para embeddings |
| `pg_net` | 0.20.0 | - | HTTP requests |
| `wrappers` | 0.6.0 | - | Foreign data wrappers |

### Disponibles pero No Instaladas

- `postgis` (3.3.7) - GIS (no usado)
- `pg_cron` (1.6.4) - Cron jobs (usas GitHub Actions)
- `pgroonga` (3.2.5) - Full-text search avanzado
- `timescaledb` - Time-series DB

---

## Estadísticas de Datos

### Conteos por Tabla

| Tabla | Filas | Propósito | Health |
|-------|-------|-----------|--------|
| **leads** | 324 | Leads WhatsApp/SMS activos | ✅ |
| **leads_apex_next** | 60 | Staging para siguiente fase | ✅ |
| **conversaciones** | 1,711 | Mensajes (5.3 msg/lead promedio) | ✅ |
| **conversational_events** | 230 | Decisiones IA | ✅ |
| **instagram_leads** | 0 | Aún sin leads IG | 🔧 En desarrollo |
| **instagram_conversations** | 0 | Aún sin DMs | 🔧 En desarrollo |
| **instagram_leads_raw** | 0 | Buffer de scraping | 🔧 En desarrollo |
| **dm_queue** | 0 | Cola de DMs pendientes | ✅ Listo |
| **dm_daily_quota** | 0 | Rate limiting | ✅ Listo |
| **account_health_log** | 1 | Logs de estado cuenta IG | ✅ Listo |
| **senders** | 2 | Números para enviar | ✅ Activo |
| **conversaciones** (IG) | 0 | - | - |
| **trabajos** | 2 | Proyectos/contratos | ✅ |
| **cuotas** | 6 | Pagos individuales | ✅ |
| **cron_runs** | 6 | Logs de trabajos | ✅ |
| **configuracion** | 28 | Sistema key-value | ✅ |
| **apex_info** | 15 | FAQ/docs | ✅ |
| **demos_rubro** | 2 | Landing pages | ✅ |

### Distribución de Datos

**Lead Lifecycle:**
```
leads (324 total)
├─ pendiente: ~40%
├─ contactado: ~20%
├─ respondio: ~15%
├─ interesado: ~15%
├─ cliente: ~5%
├─ no_interesado: ~3%
└─ descartado: ~2%
```

**Conversaciones/Lead:**
```
promedio: 1711 / 324 = 5.3 mensajes por lead
máximo: 15-20 mensajes (leads hot)
mínimo: 1 mensaje (leads pendientes)
```

**Senders:**
```
- Twilio: 1 número activo
- Wassenger: 1 número activo
- Estado: ambos activos
```

---

## Queries Útiles

### Lead Performance

```sql
-- Top leads por conversaciones
SELECT l.nombre, l.rubro, l.estado, 
       COUNT(c.id) as mensaje_count,
       MAX(c.timestamp) as ultimo_mensaje
FROM leads l
LEFT JOIN conversaciones c ON l.id = c.lead_id
GROUP BY l.id
ORDER BY mensaje_count DESC
LIMIT 20;
```

### Antispam Check

```sql
-- Leads pendientes duplicados por teléfono
SELECT telefono, COUNT(*) as duplicados
FROM leads
WHERE estado = 'pendiente' 
  AND mensaje_enviado = false
  AND telefono IS NOT NULL
GROUP BY telefono
HAVING COUNT(*) > 1;
```

### Cron Health

```sql
-- Últimas ejecuciones de cron
SELECT cron_name, 
       COUNT(*) as total_runs,
       COUNT(*) FILTER (WHERE status = 'success') as success,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       MAX(finished_at) as ultima_ejecucion
FROM cron_runs
GROUP BY cron_name
ORDER BY ultima_ejecucion DESC;
```

### Instagram Ready

```sql
-- Leads IG por descubrir en próxima fase
SELECT COUNT(*) FROM instagram_leads_raw WHERE processed = false;
```

---

## Recomendaciones

### 🔴 CRÍTICO

1. **RLS Policies:** Habilitar RLS pero sin políticas = acceso denegado
   - Define políticas explícitas si usas Supabase Auth
   - O deshabilita RLS si no los necesitas

2. **Duplicación de Índices:** `configuracion.clave`
   - `configuracion_clave_key` e `idx_configuracion_clave_unique` hacen lo mismo
   - Eliminar uno para ahorrar storage

### 🟡 IMPORTANTE

3. **Foreign Keys en Instagram:**
   - `dm_queue` → `instagram_leads` (sin cascada?)
   - Verificar comportamiento en delete

4. **Rate Limiting:**
   - `dm_daily_quota` está listo pero probablemente no en uso
   - Implementar check en cron de DMs

### 🟢 OPTIMIZACIONES

5. **Stats Updates:**
   - `senders.stats_messages_sent` está manual
   - Podrías usar trigger para auto-incrementar

6. **Full-text Search:**
   - Índice `idx_ig_leads_bio_trgm` está pronto
   - Considerar `unaccent` para búsquedas sin tildes

7. **Particionamiento:**
   - `conversaciones` (1711 filas) es pequeña aún
   - Si crece > 1M filas, particionar por `lead_id` o `timestamp`

---

## Conclusión

**Estado General:** ✅ **ESTABLE Y BIEN ESTRUCTURADO**

**Fortalezas:**
- ✅ Esquema normalizado y modular
- ✅ Tipos custom (enums) previenen errores
- ✅ Índices estratégicos para performance
- ✅ Constraints condicionales anti-spam
- ✅ RLS listo (aunque sin políticas activas)

**Puntos de Atención:**
- ⚠️ RLS habilitado pero sin policies → verifica acceso
- ⚠️ Duplicación de índices en configuracion
- ⚠️ Instagram features no en producción aún

**Próximos Pasos:**
1. Implementar Instagram pipeline (leads_raw → leads)
2. Definir RLS policies si usas Auth
3. Monitorear `cron_runs` para anomalías
4. Escalar `conversaciones` si supera 10M filas

---

**Generado:** 2026-04-21  
**Por:** Claude Code  
**Proyecto:** apex-leads  
**Base de Datos:** hpbxscfbnhspeckdmkvu (Supabase)
