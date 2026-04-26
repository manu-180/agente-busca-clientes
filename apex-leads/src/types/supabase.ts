export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_health_log: {
        Row: {
          cooldown_until: string | null
          event: Database["public"]["Enums"]["account_health_event"]
          id: number
          occurred_at: string | null
          payload: Json | null
          sender_ig: string
        }
        Insert: {
          cooldown_until?: string | null
          event: Database["public"]["Enums"]["account_health_event"]
          id?: number
          occurred_at?: string | null
          payload?: Json | null
          sender_ig: string
        }
        Update: {
          cooldown_until?: string | null
          event?: Database["public"]["Enums"]["account_health_event"]
          id?: number
          occurred_at?: string | null
          payload?: Json | null
          sender_ig?: string
        }
        Relationships: []
      }
      alerts_log: {
        Row: {
          acked_at: string | null
          id: number
          message: string
          metadata: Json | null
          severity: string
          source: string
          triggered_at: string
        }
        Insert: {
          acked_at?: string | null
          id?: number
          message: string
          metadata?: Json | null
          severity: string
          source: string
          triggered_at?: string
        }
        Update: {
          acked_at?: string | null
          id?: number
          message?: string
          metadata?: Json | null
          severity?: string
          source?: string
          triggered_at?: string
        }
        Relationships: []
      }
      apex_info: {
        Row: {
          activo: boolean
          categoria: string
          contenido: string
          created_at: string
          id: string
          titulo: string
        }
        Insert: {
          activo?: boolean
          categoria: string
          contenido: string
          created_at?: string
          id?: string
          titulo: string
        }
        Update: {
          activo?: boolean
          categoria?: string
          contenido?: string
          created_at?: string
          id?: string
          titulo?: string
        }
        Relationships: []
      }
      configuracion: {
        Row: {
          clave: string
          id: string
          valor: string
        }
        Insert: {
          clave: string
          id?: string
          valor: string
        }
        Update: {
          clave?: string
          id?: string
          valor?: string
        }
        Relationships: []
      }
      conversaciones: {
        Row: {
          es_followup: boolean
          id: string
          lead_id: string | null
          leido: boolean
          manual: boolean
          media_url: string | null
          mensaje: string
          rol: Database["public"]["Enums"]["rol_mensaje"]
          sender_id: string | null
          telefono: string
          timestamp: string
          tipo_mensaje: Database["public"]["Enums"]["tipo_mensaje"]
          twilio_message_sid: string | null
        }
        Insert: {
          es_followup?: boolean
          id?: string
          lead_id?: string | null
          leido?: boolean
          manual?: boolean
          media_url?: string | null
          mensaje: string
          rol: Database["public"]["Enums"]["rol_mensaje"]
          sender_id?: string | null
          telefono: string
          timestamp?: string
          tipo_mensaje?: Database["public"]["Enums"]["tipo_mensaje"]
          twilio_message_sid?: string | null
        }
        Update: {
          es_followup?: boolean
          id?: string
          lead_id?: string | null
          leido?: boolean
          manual?: boolean
          media_url?: string | null
          mensaje?: string
          rol?: Database["public"]["Enums"]["rol_mensaje"]
          sender_id?: string | null
          telefono?: string
          timestamp?: string
          tipo_mensaje?: Database["public"]["Enums"]["tipo_mensaje"]
          twilio_message_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversaciones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversaciones_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "senders"
            referencedColumns: ["id"]
          },
        ]
      }
      conversational_events: {
        Row: {
          confidence: number | null
          created_at: string
          decision_action: string | null
          decision_reason: string | null
          event_name: string
          id: string
          lead_id: string | null
          metadata: Json
          telefono: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          decision_action?: string | null
          decision_reason?: string | null
          event_name: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          telefono: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          decision_action?: string | null
          decision_reason?: string | null
          event_name?: string
          id?: string
          lead_id?: string | null
          metadata?: Json
          telefono?: string
        }
        Relationships: []
      }
      cron_runs: {
        Row: {
          cron_name: string
          duration_ms: number | null
          finished_at: string | null
          forced: boolean | null
          id: string
          result: Json | null
          started_at: string
          status: string
        }
        Insert: {
          cron_name: string
          duration_ms?: number | null
          finished_at?: string | null
          forced?: boolean | null
          id?: string
          result?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          cron_name?: string
          duration_ms?: number | null
          finished_at?: string | null
          forced?: boolean | null
          id?: string
          result?: Json | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      cuotas: {
        Row: {
          created_at: string
          fecha_pago: string | null
          fecha_vencimiento: string | null
          id: string
          notas: string | null
          numero_cuota: number
          pagado: boolean
          trabajo_id: string
          updated_at: string
          valor: number
        }
        Insert: {
          created_at?: string
          fecha_pago?: string | null
          fecha_vencimiento?: string | null
          id?: string
          notas?: string | null
          numero_cuota: number
          pagado?: boolean
          trabajo_id: string
          updated_at?: string
          valor: number
        }
        Update: {
          created_at?: string
          fecha_pago?: string | null
          fecha_vencimiento?: string | null
          id?: string
          notas?: string | null
          numero_cuota?: number
          pagado?: boolean
          trabajo_id?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "cuotas_trabajo_id_fkey"
            columns: ["trabajo_id"]
            isOneToOne: false
            referencedRelation: "trabajos"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_waitlist: {
        Row: {
          id: string
          ig_username: string
          lead_id: string | null
          notes: string | null
          requested_at: string
          status: string
          store_name: string | null
        }
        Insert: {
          id?: string
          ig_username: string
          lead_id?: string | null
          notes?: string | null
          requested_at?: string
          status?: string
          store_name?: string | null
        }
        Update: {
          id?: string
          ig_username?: string
          lead_id?: string | null
          notes?: string | null
          requested_at?: string
          status?: string
          store_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_waitlist_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "instagram_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      demos_rubro: {
        Row: {
          active: boolean
          created_at: string | null
          id: string
          negative_keywords: string[]
          priority: number
          rubro_label: string
          slug: string
          strong_keywords: string[]
          updated_at: string | null
          url: string
          weak_keywords: string[]
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          id?: string
          negative_keywords?: string[]
          priority?: number
          rubro_label: string
          slug: string
          strong_keywords?: string[]
          updated_at?: string | null
          url: string
          weak_keywords?: string[]
        }
        Update: {
          active?: boolean
          created_at?: string | null
          id?: string
          negative_keywords?: string[]
          priority?: number
          rubro_label?: string
          slug?: string
          strong_keywords?: string[]
          updated_at?: string | null
          url?: string
          weak_keywords?: string[]
        }
        Relationships: []
      }
      discovery_runs: {
        Row: {
          ended_at: string | null
          error_message: string | null
          id: string
          kind: string
          metadata: Json | null
          ref: string
          source_id: string | null
          started_at: string
          status: string
          users_new: number | null
          users_seen: number | null
        }
        Insert: {
          ended_at?: string | null
          error_message?: string | null
          id?: string
          kind: string
          metadata?: Json | null
          ref: string
          source_id?: string | null
          started_at?: string
          status?: string
          users_new?: number | null
          users_seen?: number | null
        }
        Update: {
          ended_at?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          metadata?: Json | null
          ref?: string
          source_id?: string | null
          started_at?: string
          status?: string
          users_new?: number | null
          users_seen?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discovery_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "discovery_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_sources: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kind: string
          notes: string | null
          params: Json
          priority: number
          ref: string
          schedule_cron: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kind: string
          notes?: string | null
          params?: Json
          priority?: number
          ref: string
          schedule_cron?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          params?: Json
          priority?: number
          ref?: string
          schedule_cron?: string
          updated_at?: string
        }
        Relationships: []
      }
      dm_daily_quota: {
        Row: {
          day: string
          dms_sent: number | null
          last_sent_at: string | null
          sender_ig_username: string
        }
        Insert: {
          day?: string
          dms_sent?: number | null
          last_sent_at?: string | null
          sender_ig_username: string
        }
        Update: {
          day?: string
          dms_sent?: number | null
          last_sent_at?: string | null
          sender_ig_username?: string
        }
        Relationships: []
      }
      dm_queue: {
        Row: {
          attempts: number | null
          created_at: string | null
          error: string | null
          id: number
          lead_id: string
          scheduled_at: string
          sent_at: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          error?: string | null
          id?: number
          lead_id: string
          scheduled_at: string
          sent_at?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          error?: string | null
          id?: number
          lead_id?: string
          scheduled_at?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "instagram_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_template_assignments: {
        Row: {
          id: number
          lead_id: string
          replied: boolean
          replied_at: string | null
          reply_was_positive: boolean | null
          sent_at: string
          template_id: string
        }
        Insert: {
          id?: number
          lead_id: string
          replied?: boolean
          replied_at?: string | null
          reply_was_positive?: boolean | null
          sent_at?: string
          template_id: string
        }
        Update: {
          id?: number
          lead_id?: string
          replied?: boolean
          replied_at?: string | null
          reply_was_positive?: boolean | null
          sent_at?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_template_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "instagram_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_template_assignments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "dm_template_stats"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "dm_template_assignments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "dm_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          killed_at: string | null
          name: string
          notes: string | null
          status: string
          variables: string[]
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          killed_at?: string | null
          name: string
          notes?: string | null
          status?: string
          variables?: string[]
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          killed_at?: string | null
          name?: string
          notes?: string | null
          status?: string
          variables?: string[]
        }
        Relationships: []
      }
      instagram_conversations: {
        Row: {
          content: string
          created_at: string | null
          delivered_at: string | null
          direction: string | null
          id: string
          ig_message_id: string | null
          ig_thread_id: string | null
          lead_id: string
          metadata: Json | null
          role: string
          seen_at: string | null
          sent_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          delivered_at?: string | null
          direction?: string | null
          id?: string
          ig_message_id?: string | null
          ig_thread_id?: string | null
          lead_id: string
          metadata?: Json | null
          role: string
          seen_at?: string | null
          sent_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          delivered_at?: string | null
          direction?: string | null
          id?: string
          ig_message_id?: string | null
          ig_thread_id?: string | null
          lead_id?: string
          metadata?: Json | null
          role?: string
          seen_at?: string | null
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "instagram_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_leads: {
        Row: {
          bio_links: Json | null
          biography: string | null
          business_category: string | null
          closed_at: string | null
          contacted_at: string | null
          created_at: string | null
          discovered_at: string | null
          discovered_source_ref: string | null
          discovered_via: Database["public"]["Enums"]["discovery_source"] | null
          dm_sent_count: number | null
          do_not_contact: boolean | null
          engagement_rate: number | null
          external_url: string | null
          follow_up_sent_at: string | null
          followers_count: number | null
          following_count: number | null
          full_name: string | null
          id: string
          ig_thread_id: string | null
          ig_user_id: number
          ig_username: string
          is_business: boolean | null
          is_private: boolean | null
          is_verified: boolean | null
          last_dm_sent_at: string | null
          last_post_at: string | null
          last_reply_at: string | null
          lead_score: number | null
          link_verdict: Database["public"]["Enums"]["link_verdict"] | null
          niche: string | null
          niche_confidence: number | null
          notes: string | null
          owner_takeover_at: string | null
          posts_count: number | null
          posts_last_30d: number | null
          profile_pic_url: string | null
          replied_at: string | null
          reply_count: number | null
          score_breakdown: Json | null
          scoring_version: number | null
          status: Database["public"]["Enums"]["lead_status"]
          status_reason: string | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          bio_links?: Json | null
          biography?: string | null
          business_category?: string | null
          closed_at?: string | null
          contacted_at?: string | null
          created_at?: string | null
          discovered_at?: string | null
          discovered_source_ref?: string | null
          discovered_via?:
            | Database["public"]["Enums"]["discovery_source"]
            | null
          dm_sent_count?: number | null
          do_not_contact?: boolean | null
          engagement_rate?: number | null
          external_url?: string | null
          follow_up_sent_at?: string | null
          followers_count?: number | null
          following_count?: number | null
          full_name?: string | null
          id?: string
          ig_thread_id?: string | null
          ig_user_id: number
          ig_username: string
          is_business?: boolean | null
          is_private?: boolean | null
          is_verified?: boolean | null
          last_dm_sent_at?: string | null
          last_post_at?: string | null
          last_reply_at?: string | null
          lead_score?: number | null
          link_verdict?: Database["public"]["Enums"]["link_verdict"] | null
          niche?: string | null
          niche_confidence?: number | null
          notes?: string | null
          owner_takeover_at?: string | null
          posts_count?: number | null
          posts_last_30d?: number | null
          profile_pic_url?: string | null
          replied_at?: string | null
          reply_count?: number | null
          score_breakdown?: Json | null
          scoring_version?: number | null
          status?: Database["public"]["Enums"]["lead_status"]
          status_reason?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          bio_links?: Json | null
          biography?: string | null
          business_category?: string | null
          closed_at?: string | null
          contacted_at?: string | null
          created_at?: string | null
          discovered_at?: string | null
          discovered_source_ref?: string | null
          discovered_via?:
            | Database["public"]["Enums"]["discovery_source"]
            | null
          dm_sent_count?: number | null
          do_not_contact?: boolean | null
          engagement_rate?: number | null
          external_url?: string | null
          follow_up_sent_at?: string | null
          followers_count?: number | null
          following_count?: number | null
          full_name?: string | null
          id?: string
          ig_thread_id?: string | null
          ig_user_id?: number
          ig_username?: string
          is_business?: boolean | null
          is_private?: boolean | null
          is_verified?: boolean | null
          last_dm_sent_at?: string | null
          last_post_at?: string | null
          last_reply_at?: string | null
          lead_score?: number | null
          link_verdict?: Database["public"]["Enums"]["link_verdict"] | null
          niche?: string | null
          niche_confidence?: number | null
          notes?: string | null
          owner_takeover_at?: string | null
          posts_count?: number | null
          posts_last_30d?: number | null
          profile_pic_url?: string | null
          replied_at?: string | null
          reply_count?: number | null
          score_breakdown?: Json | null
          scoring_version?: number | null
          status?: Database["public"]["Enums"]["lead_status"]
          status_reason?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_leads_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "dm_template_stats"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "instagram_leads_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "dm_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_leads_raw: {
        Row: {
          created_at: string | null
          id: number
          ig_username: string | null
          processed: boolean | null
          processing_error: string | null
          raw_profile: Json
          source: Database["public"]["Enums"]["discovery_source"] | null
          source_ref: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          ig_username?: string | null
          processed?: boolean | null
          processing_error?: string | null
          raw_profile: Json
          source?: Database["public"]["Enums"]["discovery_source"] | null
          source_ref?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          ig_username?: string | null
          processed?: boolean | null
          processing_error?: string | null
          raw_profile?: Json
          source?: Database["public"]["Enums"]["discovery_source"] | null
          source_ref?: string | null
        }
        Relationships: []
      }
      lead_blacklist: {
        Row: {
          blacklisted_at: string
          blacklisted_by: string
          ig_username: string
          reason: string
        }
        Insert: {
          blacklisted_at?: string
          blacklisted_by?: string
          ig_username: string
          reason: string
        }
        Update: {
          blacklisted_at?: string
          blacklisted_by?: string
          ig_username?: string
          reason?: string
        }
        Relationships: []
      }
      lead_score_history: {
        Row: {
          computed_at: string
          features: Json
          id: number
          lead_id: string
          score: number
          weights_version: number
        }
        Insert: {
          computed_at?: string
          features: Json
          id?: number
          lead_id: string
          score: number
          weights_version: number
        }
        Update: {
          computed_at?: string
          features?: Json
          id?: number
          lead_id?: string
          score?: number
          weights_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_score_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "instagram_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          agente_activo: boolean
          boceto_aceptado: boolean
          boceto_aceptado_at: string | null
          conversacion_cerrada: boolean
          conversacion_cerrada_at: string | null
          created_at: string
          descripcion: string
          estado: Database["public"]["Enums"]["estado_lead"]
          id: string
          instagram: string | null
          mensaje_enviado: boolean
          mensaje_inicial: string
          nombre: string
          notas: string | null
          origen: Database["public"]["Enums"]["origen_lead"]
          primer_envio_completado_at: string | null
          primer_envio_error: string | null
          primer_envio_intentos: number
          procesando_hasta: string | null
          rubro: string
          sender_id: string | null
          telefono: string
          updated_at: string
          video_enviado: boolean
          zona: string
        }
        Insert: {
          agente_activo?: boolean
          boceto_aceptado?: boolean
          boceto_aceptado_at?: string | null
          conversacion_cerrada?: boolean
          conversacion_cerrada_at?: string | null
          created_at?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_lead"]
          id?: string
          instagram?: string | null
          mensaje_enviado?: boolean
          mensaje_inicial?: string
          nombre: string
          notas?: string | null
          origen?: Database["public"]["Enums"]["origen_lead"]
          primer_envio_completado_at?: string | null
          primer_envio_error?: string | null
          primer_envio_intentos?: number
          procesando_hasta?: string | null
          rubro: string
          sender_id?: string | null
          telefono: string
          updated_at?: string
          video_enviado?: boolean
          zona?: string
        }
        Update: {
          agente_activo?: boolean
          boceto_aceptado?: boolean
          boceto_aceptado_at?: string | null
          conversacion_cerrada?: boolean
          conversacion_cerrada_at?: string | null
          created_at?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_lead"]
          id?: string
          instagram?: string | null
          mensaje_enviado?: boolean
          mensaje_inicial?: string
          nombre?: string
          notas?: string | null
          origen?: Database["public"]["Enums"]["origen_lead"]
          primer_envio_completado_at?: string | null
          primer_envio_error?: string | null
          primer_envio_intentos?: number
          procesando_hasta?: string | null
          rubro?: string
          sender_id?: string | null
          telefono?: string
          updated_at?: string
          video_enviado?: boolean
          zona?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "senders"
            referencedColumns: ["id"]
          },
        ]
      }
      leads_apex_next: {
        Row: {
          agente_activo: boolean
          boceto_aceptado: boolean
          boceto_aceptado_at: string | null
          conversacion_cerrada: boolean
          conversacion_cerrada_at: string | null
          created_at: string
          descripcion: string
          estado: Database["public"]["Enums"]["estado_lead"]
          id: string
          instagram: string | null
          mensaje_enviado: boolean
          mensaje_inicial: string
          nombre: string
          notas: string | null
          origen: Database["public"]["Enums"]["origen_lead"]
          primer_envio_completado_at: string | null
          primer_envio_error: string | null
          primer_envio_intentos: number
          procesando_hasta: string | null
          rubro: string
          telefono: string
          updated_at: string
          video_enviado: boolean
          zona: string
        }
        Insert: {
          agente_activo?: boolean
          boceto_aceptado?: boolean
          boceto_aceptado_at?: string | null
          conversacion_cerrada?: boolean
          conversacion_cerrada_at?: string | null
          created_at?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_lead"]
          id?: string
          instagram?: string | null
          mensaje_enviado?: boolean
          mensaje_inicial?: string
          nombre: string
          notas?: string | null
          origen?: Database["public"]["Enums"]["origen_lead"]
          primer_envio_completado_at?: string | null
          primer_envio_error?: string | null
          primer_envio_intentos?: number
          procesando_hasta?: string | null
          rubro: string
          telefono: string
          updated_at?: string
          video_enviado?: boolean
          zona?: string
        }
        Update: {
          agente_activo?: boolean
          boceto_aceptado?: boolean
          boceto_aceptado_at?: string | null
          conversacion_cerrada?: boolean
          conversacion_cerrada_at?: string | null
          created_at?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_lead"]
          id?: string
          instagram?: string | null
          mensaje_enviado?: boolean
          mensaje_inicial?: string
          nombre?: string
          notas?: string | null
          origen?: Database["public"]["Enums"]["origen_lead"]
          primer_envio_completado_at?: string | null
          primer_envio_error?: string | null
          primer_envio_intentos?: number
          procesando_hasta?: string | null
          rubro?: string
          telefono?: string
          updated_at?: string
          video_enviado?: boolean
          zona?: string
        }
        Relationships: []
      }
      niche_classifications: {
        Row: {
          classified_at: string
          classifier: string
          confidence: number
          expires_at: string
          id: string
          ig_username: string
          niche: string
          prompt_hash: string
          reason: string | null
        }
        Insert: {
          classified_at?: string
          classifier?: string
          confidence: number
          expires_at?: string
          id?: string
          ig_username: string
          niche: string
          prompt_hash: string
          reason?: string | null
        }
        Update: {
          classified_at?: string
          classifier?: string
          confidence?: number
          expires_at?: string
          id?: string
          ig_username?: string
          niche?: string
          prompt_hash?: string
          reason?: string | null
        }
        Relationships: []
      }
      scoring_weights: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          promoted_at: string | null
          retired_at: string | null
          status: string
          trained_on_n: number
          version: number
          weights: Json
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          promoted_at?: string | null
          retired_at?: string | null
          status?: string
          trained_on_n?: number
          version: number
          weights: Json
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          promoted_at?: string | null
          retired_at?: string | null
          status?: string
          trained_on_n?: number
          version?: number
          weights?: Json
        }
        Relationships: []
      }
      senders: {
        Row: {
          activo: boolean | null
          alias: string
          color: string | null
          created_at: string | null
          descripcion: string | null
          es_legacy: boolean | null
          id: string
          phone_number: string
          provider: string
          stats_messages_sent: number | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          alias: string
          color?: string | null
          created_at?: string | null
          descripcion?: string | null
          es_legacy?: boolean | null
          id?: string
          phone_number: string
          provider: string
          stats_messages_sent?: number | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          alias?: string
          color?: string | null
          created_at?: string | null
          descripcion?: string | null
          es_legacy?: boolean | null
          id?: string
          phone_number?: string
          provider?: string
          stats_messages_sent?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sidecar_rate_limits: {
        Row: {
          endpoint: string
          key: string
          last_call_at: string
        }
        Insert: {
          endpoint: string
          key: string
          last_call_at?: string
        }
        Update: {
          endpoint?: string
          key?: string
          last_call_at?: string
        }
        Relationships: []
      }
      trabajos: {
        Row: {
          activo: boolean
          cliente: string | null
          created_at: string
          descripcion: string | null
          fecha_inicio: string
          id: string
          moneda: string
          nombre: string
          tipo: string
          total_cuotas: number | null
          updated_at: string
          valor_cuota: number
        }
        Insert: {
          activo?: boolean
          cliente?: string | null
          created_at?: string
          descripcion?: string | null
          fecha_inicio?: string
          id?: string
          moneda?: string
          nombre: string
          tipo?: string
          total_cuotas?: number | null
          updated_at?: string
          valor_cuota?: number
        }
        Update: {
          activo?: boolean
          cliente?: string | null
          created_at?: string
          descripcion?: string | null
          fecha_inicio?: string
          id?: string
          moneda?: string
          nombre?: string
          tipo?: string
          total_cuotas?: number | null
          updated_at?: string
          valor_cuota?: number
        }
        Relationships: []
      }
    }
    Views: {
      conversaciones_primera_por_lead: {
        Row: {
          es_followup: boolean | null
          id: string | null
          lead_id: string | null
          leido: boolean | null
          manual: boolean | null
          media_url: string | null
          mensaje: string | null
          rol: Database["public"]["Enums"]["rol_mensaje"] | null
          sender_id: string | null
          telefono: string | null
          timestamp: string | null
          tipo_mensaje: Database["public"]["Enums"]["tipo_mensaje"] | null
        }
        Relationships: [
          {
            foreignKeyName: "conversaciones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversaciones_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "senders"
            referencedColumns: ["id"]
          },
        ]
      }
      conversaciones_ultima_por_lead: {
        Row: {
          es_followup: boolean | null
          id: string | null
          lead_id: string | null
          leido: boolean | null
          manual: boolean | null
          media_url: string | null
          mensaje: string | null
          rol: Database["public"]["Enums"]["rol_mensaje"] | null
          sender_id: string | null
          telefono: string | null
          timestamp: string | null
          tipo_mensaje: Database["public"]["Enums"]["tipo_mensaje"] | null
        }
        Relationships: [
          {
            foreignKeyName: "conversaciones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversaciones_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "senders"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_metrics_daily: {
        Row: {
          day: string | null
          dms_sent: number | null
          replies: number | null
          runs_err: number | null
          runs_ok: number | null
          source_kind: string | null
          users_new: number | null
          users_seen: number | null
        }
        Relationships: []
      }
      dm_template_stats: {
        Row: {
          beta_alpha: number | null
          beta_beta: number | null
          ctr_pct: number | null
          name: string | null
          replies: number | null
          sends: number | null
          status: string | null
          template_id: string | null
        }
        Relationships: []
      }
      lead_funnel: {
        Row: {
          contacted: number | null
          day: string | null
          enriched: number | null
          pre_filter_passed: number | null
          raw_discovered: number | null
          replied: number | null
        }
        Relationships: []
      }
      v_conversation_messages: {
        Row: {
          lead_id: string | null
          messages: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "instagram_leads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      refresh_discovery_metrics: { Args: never; Returns: undefined }
      release_followup_cron_lock: { Args: never; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      telefono_ya_contactado: { Args: { p_tel: string }; Returns: boolean }
      try_followup_cron_lock: {
        Args: { ttl_seconds?: number }
        Returns: boolean
      }
    }
    Enums: {
      account_health_event:
        | "action_blocked"
        | "feedback_required"
        | "challenge_required"
        | "rate_limited"
        | "login_required"
        | "shadowban_suspected"
        | "ok"
      discovery_source:
        | "hashtag"
        | "location"
        | "related_profile"
        | "manual"
        | "reply_thread"
      estado_lead:
        | "pendiente"
        | "contactado"
        | "respondio"
        | "interesado"
        | "cerrado"
        | "descartado"
        | "no_interesado"
        | "presupuesto_enviado"
        | "cliente"
      lead_status:
        | "discovered"
        | "qualified"
        | "queued"
        | "contacted"
        | "follow_up_sent"
        | "replied"
        | "interested"
        | "meeting_booked"
        | "closed_positive"
        | "closed_negative"
        | "closed_ghosted"
        | "owner_takeover"
        | "blacklisted"
        | "error"
      link_verdict:
        | "no_link"
        | "aggregator"
        | "social_only"
        | "marketplace"
        | "own_site"
        | "unknown"
      origen_lead: "outbound" | "inbound"
      rol_mensaje: "agente" | "cliente"
      tipo_mensaje: "texto" | "audio" | "imagen" | "otro"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_health_event: [
        "action_blocked",
        "feedback_required",
        "challenge_required",
        "rate_limited",
        "login_required",
        "shadowban_suspected",
        "ok",
      ],
      discovery_source: [
        "hashtag",
        "location",
        "related_profile",
        "manual",
        "reply_thread",
      ],
      estado_lead: [
        "pendiente",
        "contactado",
        "respondio",
        "interesado",
        "cerrado",
        "descartado",
        "no_interesado",
        "presupuesto_enviado",
        "cliente",
      ],
      lead_status: [
        "discovered",
        "qualified",
        "queued",
        "contacted",
        "follow_up_sent",
        "replied",
        "interested",
        "meeting_booked",
        "closed_positive",
        "closed_negative",
        "closed_ghosted",
        "owner_takeover",
        "blacklisted",
        "error",
      ],
      link_verdict: [
        "no_link",
        "aggregator",
        "social_only",
        "marketplace",
        "own_site",
        "unknown",
      ],
      origen_lead: ["outbound", "inbound"],
      rol_mensaje: ["agente", "cliente"],
      tipo_mensaje: ["texto", "audio", "imagen", "otro"],
    },
  },
} as const
