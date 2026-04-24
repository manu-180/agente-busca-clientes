-- =============================================
-- APEX LEADS - Instagram Outreach Module
-- Ejecutar en Supabase SQL Editor
-- Script idempotente: se puede ejecutar varias veces
-- =============================================

-- ========================================================
-- Extensiones
-- ========================================================
create extension if not exists "uuid-ossp";
create extension if not exists citext;
create extension if not exists pg_trgm;
-- pg_cron requiere habilitarse desde el dashboard de Supabase (Database > Extensions)
-- create extension if not exists pg_cron;

-- ========================================================
-- Enums (idempotentes)
-- ========================================================
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'discovered','qualified','queued','contacted',
    'follow_up_sent','replied','interested','meeting_booked',
    'closed_positive','closed_negative','closed_ghosted',
    'owner_takeover','blacklisted','error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE link_verdict AS ENUM (
    'no_link','aggregator','social_only','marketplace','own_site','unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE discovery_source AS ENUM (
    'hashtag','location','related_profile','manual','reply_thread'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_health_event AS ENUM (
    'action_blocked','feedback_required','challenge_required',
    'rate_limited','login_required','shadowban_suspected','ok'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========================================================
-- Staging: lo que devuelve Apify (sin procesar)
-- ========================================================
create table if not exists instagram_leads_raw (
  id            bigserial primary key,
  ig_username   citext,
  raw_profile   jsonb not null,
  source        discovery_source,
  source_ref    text,
  processed     boolean default false,
  processing_error text,
  created_at    timestamptz default now()
);

create index if not exists idx_instagram_leads_raw_unprocessed
  on instagram_leads_raw(processed) where processed = false;
create index if not exists idx_instagram_leads_raw_username
  on instagram_leads_raw(ig_username);

-- ========================================================
-- Leads qualificados
-- ========================================================
create table if not exists instagram_leads (
  id                 uuid primary key default uuid_generate_v4(),
  ig_user_id         bigint unique not null,
  ig_username        citext unique not null,
  full_name          text,
  biography          text,
  external_url       text,
  bio_links          jsonb default '[]'::jsonb,
  link_verdict       link_verdict default 'unknown',

  followers_count    int,
  following_count    int,
  posts_count        int,
  is_private         boolean default false,
  is_verified        boolean default false,
  is_business        boolean default false,
  business_category  text,
  profile_pic_url    text,
  last_post_at       timestamptz,
  posts_last_30d     int default 0,

  lead_score         int default 0,
  score_breakdown    jsonb default '{}'::jsonb,
  status             lead_status not null default 'discovered',
  status_reason      text,

  ig_thread_id       text,
  contacted_at       timestamptz,
  last_dm_sent_at    timestamptz,
  dm_sent_count      int default 0,
  follow_up_sent_at  timestamptz,
  last_reply_at      timestamptz,
  reply_count        int default 0,
  owner_takeover_at  timestamptz,
  closed_at          timestamptz,

  discovered_via        discovery_source,
  discovered_source_ref text,
  discovered_at         timestamptz default now(),

  do_not_contact     boolean default false,
  notes              text,

  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists idx_ig_leads_status
  on instagram_leads(status);
create index if not exists idx_ig_leads_status_score
  on instagram_leads(status, lead_score desc);
create index if not exists idx_ig_leads_last_dm
  on instagram_leads(last_dm_sent_at);
create index if not exists idx_ig_leads_thread
  on instagram_leads(ig_thread_id);
create index if not exists idx_ig_leads_bio_trgm
  on instagram_leads using gin (biography gin_trgm_ops);

-- Trigger updated_at
create or replace function touch_ig_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_ig_leads_touch on instagram_leads;
create trigger trg_ig_leads_touch
  before update on instagram_leads
  for each row execute function touch_ig_updated_at();

-- ========================================================
-- Conversaciones (formato messages[] Claude-compatible)
-- ========================================================
create table if not exists instagram_conversations (
  id            uuid primary key default uuid_generate_v4(),
  lead_id       uuid not null references instagram_leads(id) on delete cascade,
  ig_thread_id  text,
  ig_message_id text unique,
  role          text not null check (role in ('system','user','assistant','tool')),
  content       text not null,
  direction     text check (direction in ('inbound','outbound','internal')),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  seen_at       timestamptz,
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);

create index if not exists idx_ig_conv_lead
  on instagram_conversations(lead_id, created_at);
create index if not exists idx_ig_conv_thread
  on instagram_conversations(ig_thread_id);
create index if not exists idx_ig_conv_direction
  on instagram_conversations(direction);

-- View para armar messages[] al llamar Claude
create or replace view v_conversation_messages as
select
  lead_id,
  jsonb_agg(
    jsonb_build_object('role', role, 'content', content)
    order by created_at
  ) as messages
from instagram_conversations
where role in ('user','assistant')
group by lead_id;

-- ========================================================
-- Cola de DMs programados
-- ========================================================
create table if not exists dm_queue (
  id            bigserial primary key,
  lead_id       uuid not null references instagram_leads(id) on delete cascade,
  scheduled_at  timestamptz not null,
  attempts      int default 0,
  sent_at       timestamptz,
  error         text,
  created_at    timestamptz default now()
);

create index if not exists idx_dm_queue_pending
  on dm_queue(scheduled_at) where sent_at is null;

-- ========================================================
-- Rate limiting por día
-- ========================================================
create table if not exists dm_daily_quota (
  sender_ig_username citext not null,
  day               date not null default current_date,
  dms_sent          int default 0,
  last_sent_at      timestamptz,
  primary key (sender_ig_username, day)
);

-- ========================================================
-- Salud de la cuenta emisora
-- ========================================================
create table if not exists account_health_log (
  id             bigserial primary key,
  sender_ig      citext not null,
  event          account_health_event not null,
  payload        jsonb,
  cooldown_until timestamptz,
  occurred_at    timestamptz default now()
);

create index if not exists idx_health_log_sender
  on account_health_log(sender_ig, occurred_at desc);

-- ========================================================
-- RLS (service_role bypass; sin acceso anon)
-- ========================================================
alter table instagram_leads_raw      enable row level security;
alter table instagram_leads          enable row level security;
alter table instagram_conversations  enable row level security;
alter table dm_queue                 enable row level security;
alter table dm_daily_quota           enable row level security;
alter table account_health_log       enable row level security;

-- Policies: solo service_role puede operar (anon denegado)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'instagram_leads' and policyname = 'service_role_only'
  ) then
    create policy service_role_only on instagram_leads
      using (auth.role() = 'service_role');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'instagram_leads_raw' and policyname = 'service_role_only'
  ) then
    create policy service_role_only on instagram_leads_raw
      using (auth.role() = 'service_role');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'instagram_conversations' and policyname = 'service_role_only'
  ) then
    create policy service_role_only on instagram_conversations
      using (auth.role() = 'service_role');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'dm_queue' and policyname = 'service_role_only'
  ) then
    create policy service_role_only on dm_queue
      using (auth.role() = 'service_role');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'dm_daily_quota' and policyname = 'service_role_only'
  ) then
    create policy service_role_only on dm_daily_quota
      using (auth.role() = 'service_role');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'account_health_log' and policyname = 'service_role_only'
  ) then
    create policy service_role_only on account_health_log
      using (auth.role() = 'service_role');
  end if;
end $$;

-- ========================================================
-- pg_cron jobs (ejecutar DESPUÉS de habilitar pg_cron en el dashboard)
-- Descomentá cuando pg_cron esté habilitado
-- ========================================================

-- select cron.schedule('ig_discover_weekly',  '0 6 * * 0',   $q$ select net.http_post(url:=current_setting('app.base_url') || '/api/cron/ig-discover', headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $q$);
-- select cron.schedule('ig_enrich_hourly',    '7 * * * *',   $q$ select net.http_post(url:=current_setting('app.base_url') || '/api/cron/ig-enrich', headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $q$);
-- select cron.schedule('ig_daily_dm',         '15 12 * * *', $q$ select net.http_post(url:=current_setting('app.base_url') || '/api/cron/ig-daily', headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $q$);
-- select cron.schedule('ig_send_pending',     '*/2 * * * *', $q$ select net.http_post(url:=current_setting('app.base_url') || '/api/cron/ig-send-pending', headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $q$);
-- select cron.schedule('ig_followup',         '0 13 * * *',  $q$ select net.http_post(url:=current_setting('app.base_url') || '/api/cron/ig-followup', headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $q$);
-- select cron.schedule('ig_poll_inbox',       '*/2 * * * *', $q$ select net.http_post(url:=current_setting('app.base_url') || '/api/cron/ig-poll-inbox', headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $q$);
