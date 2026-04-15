# APEX Lead Engine

Sistema de prospección y agente de ventas IA para WhatsApp.

## Stack
- Next.js 14 (App Router) + TypeScript
- Supabase (PostgreSQL + Realtime)
- Anthropic API (Claude Sonnet)
- Wassenger (WhatsApp Business API)
- Tailwind CSS

## Setup paso a paso

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar Supabase
1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a SQL Editor
3. Copiar y ejecutar todo el contenido de `supabase-schema.sql`
4. Copiar las keys de Settings → API:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Configurar Anthropic
1. Crear API key en [console.anthropic.com](https://console.anthropic.com)
2. Pegarla en `ANTHROPIC_API_KEY`

### 4. Configurar Wassenger
1. Crear cuenta en [wassenger.com](https://wassenger.com)
2. Conectar tu número de WhatsApp Business
3. Copiar API key → `WASSENGER_API_KEY`
4. Copiar Device ID → `WASSENGER_DEVICE_ID`
5. Configurar webhook (ver paso 6)

### 5. Configurar .env.local
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
WASSENGER_API_KEY=tu-key
WASSENGER_DEVICE_ID=tu-device-id
ADMIN_PASSWORD=tu-password-seguro
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 6. Correr en desarrollo
```bash
npm run dev
```
Ir a http://localhost:3000 → Login con tu ADMIN_PASSWORD

### 7. Deploy en Vercel
1. Push a GitHub
2. Importar en [vercel.com](https://vercel.com)
3. Agregar TODAS las env vars en Settings → Environment Variables
4. Cambiar `NEXT_PUBLIC_APP_URL` a tu URL de Vercel

### 8. Configurar Webhook en Wassenger
1. Ir a wassenger.com → Settings → Webhooks
2. Add webhook con URL: `https://tu-app.vercel.app/api/webhook/wassenger`
3. Evento: `message:in:new`
4. Guardar

## Cómo funciona

### Flujo Outbound (vos buscás clientes)
1. Vas a /leads/nuevo
2. Cargás los datos del negocio (nombre, rubro, teléfono)
3. La IA genera un mensaje personalizado
4. Editás el mensaje si querés
5. Clickeás "Enviar por WhatsApp" → se abre wa.me con el mensaje
6. Si el cliente responde, el agente toma la conversación automáticamente

### Flujo Inbound (te escriben desde la web)
1. Alguien te escribe al WhatsApp desde theapexweb.com
2. Wassenger recibe el mensaje y lo manda al webhook
3. Se crea el lead automáticamente como "inbound"
4. El agente responde automáticamente con personalidad inbound (más directo)

### Panel de control
- **Dashboard**: métricas generales
- **Leads**: lista y gestión de todos los leads
- **Inbox**: conversaciones estilo WhatsApp
- **Agente IA**: configurar qué sabe el agente sobre APEX
- **Config**: API keys y webhook

## Estructura del proyecto
```
src/
├── app/
│   ├── api/
│   │   ├── agente/       → responder, enviar, info, config, test
│   │   ├── auth/         → login
│   │   ├── conversaciones/ → listar chats
│   │   ├── dashboard/    → métricas
│   │   ├── leads/        → CRUD + generar mensaje
│   │   └── webhook/      → Wassenger webhook
│   ├── agente/           → página config agente
│   ├── configuracion/    → página settings
│   ├── conversaciones/   → página inbox
│   ├── dashboard/        → página dashboard
│   ├── leads/            → páginas leads
│   └── login/            → página login
├── components/
│   └── layout/
│       └── sidebar.tsx
├── lib/
│   ├── prompts.ts        → prompts del agente (outbound/inbound)
│   ├── supabase-client.ts
│   ├── supabase-server.ts
│   ├── utils.ts
│   └── wassenger.ts
└── types/
    └── index.ts
```
