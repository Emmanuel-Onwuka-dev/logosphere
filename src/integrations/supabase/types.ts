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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_engines: {
        Row: {
          created_at: string
          deployment_type: string
          engine_name: string
          engine_type: string
          id: string
          input_format: string | null
          max_concurrency: number | null
          model_id: string | null
          model_version: string | null
          output_format: string | null
          provider_id: string
          status: string
          streaming: boolean
          supported_language_pairs: string[]
          supported_languages: string[]
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deployment_type?: string
          engine_name: string
          engine_type?: string
          id?: string
          input_format?: string | null
          max_concurrency?: number | null
          model_id?: string | null
          model_version?: string | null
          output_format?: string | null
          provider_id: string
          status?: string
          streaming?: boolean
          supported_language_pairs?: string[]
          supported_languages?: string[]
          timeout_ms?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deployment_type?: string
          engine_name?: string
          engine_type?: string
          id?: string
          input_format?: string | null
          max_concurrency?: number | null
          model_id?: string | null
          model_version?: string | null
          output_format?: string | null
          provider_id?: string
          status?: string
          streaming?: boolean
          supported_language_pairs?: string[]
          supported_languages?: string[]
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_engines_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          provider_type: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          provider_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          provider_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      churches: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      endpoint_checks: {
        Row: {
          checked_at: string
          endpoint_id: string
          error: string | null
          id: string
          latency_ms: number | null
          ok: boolean
          status_code: number | null
        }
        Insert: {
          checked_at?: string
          endpoint_id: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          ok: boolean
          status_code?: number | null
        }
        Update: {
          checked_at?: string
          endpoint_id?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          ok?: boolean
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "endpoint_checks_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "inference_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_assignments: {
        Row: {
          created_at: string
          enabled: boolean
          engine_id: string
          id: string
          priority: number
          processing_mode: string
          source_language: string
          target_language: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          engine_id: string
          id?: string
          priority?: number
          processing_mode?: string
          source_language: string
          target_language: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          engine_id?: string
          id?: string
          priority?: number
          processing_mode?: string
          source_language?: string
          target_language?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_assignments_engine_id_fkey"
            columns: ["engine_id"]
            isOneToOne: false
            referencedRelation: "ai_engines"
            referencedColumns: ["id"]
          },
        ]
      }
      inference_endpoints: {
        Row: {
          auth_method: string
          created_at: string
          endpoint_name: string
          endpoint_type: string
          endpoint_url: string | null
          engine_id: string
          healthcheck_url: string | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          last_latency_ms: number | null
          secret_ref: string | null
          status: string
          updated_at: string
          websocket_url: string | null
        }
        Insert: {
          auth_method?: string
          created_at?: string
          endpoint_name: string
          endpoint_type?: string
          endpoint_url?: string | null
          engine_id: string
          healthcheck_url?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_latency_ms?: number | null
          secret_ref?: string | null
          status?: string
          updated_at?: string
          websocket_url?: string | null
        }
        Update: {
          auth_method?: string
          created_at?: string
          endpoint_name?: string
          endpoint_type?: string
          endpoint_url?: string | null
          engine_id?: string
          healthcheck_url?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_latency_ms?: number | null
          secret_ref?: string | null
          status?: string
          updated_at?: string
          websocket_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inference_endpoints_engine_id_fkey"
            columns: ["engine_id"]
            isOneToOne: false
            referencedRelation: "ai_engines"
            referencedColumns: ["id"]
          },
        ]
      }
      listener_connections: {
        Row: {
          id: string
          joined_at: string
          language: string
          last_seen_at: string
          left_at: string | null
          session_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          language: string
          last_seen_at?: string
          left_at?: string | null
          session_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          language?: string
          last_seen_at?: string
          left_at?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listener_connections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      playground_runs: {
        Row: {
          batch_id: string
          created_at: string
          created_by: string
          endpoint_id: string | null
          engine_id: string | null
          error: string | null
          id: string
          input_bytes: number | null
          input_name: string | null
          latency_ms: number | null
          notes: string | null
          ok: boolean
          output_kind: string | null
          output_text: string | null
          rating: number | null
          source_language: string
          status_code: number | null
          target_language: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_by?: string
          endpoint_id?: string | null
          engine_id?: string | null
          error?: string | null
          id?: string
          input_bytes?: number | null
          input_name?: string | null
          latency_ms?: number | null
          notes?: string | null
          ok?: boolean
          output_kind?: string | null
          output_text?: string | null
          rating?: number | null
          source_language: string
          status_code?: number | null
          target_language: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by?: string
          endpoint_id?: string | null
          engine_id?: string | null
          error?: string | null
          id?: string
          input_bytes?: number | null
          input_name?: string | null
          latency_ms?: number | null
          notes?: string | null
          ok?: boolean
          output_kind?: string | null
          output_text?: string | null
          rating?: number | null
          source_language?: string
          status_code?: number | null
          target_language?: string
        }
        Relationships: [
          {
            foreignKeyName: "playground_runs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "inference_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playground_runs_engine_id_fkey"
            columns: ["engine_id"]
            isOneToOne: false
            referencedRelation: "ai_engines"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          church_id: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          church_id?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          church_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          church_id: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          public_code: string
          source_language: string
          started_at: string | null
          status: Database["public"]["Enums"]["session_status"]
          target_languages: string[]
          title: string
          total_live_seconds: number
          updated_at: string
        }
        Insert: {
          church_id: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          public_code?: string
          source_language?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          target_languages?: string[]
          title: string
          total_live_seconds?: number
          updated_at?: string
        }
        Update: {
          church_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          public_code?: string
          source_language?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          target_languages?: string[]
          title?: string
          total_live_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          church_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          church_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          church_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_church_id_fkey"
            columns: ["church_id"]
            isOneToOne: false
            referencedRelation: "churches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_operate_church: {
        Args: { _church_id: string; _user_id: string }
        Returns: boolean
      }
      create_church: {
        Args: { _city: string; _country: string; _name: string }
        Returns: string
      }
      get_public_session: {
        Args: { _code: string }
        Returns: {
          church_name: string
          source_language: string
          status: Database["public"]["Enums"]["session_status"]
          target_languages: string[]
          title: string
        }[]
      }
      has_church_role: {
        Args: {
          _church_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_church_member: {
        Args: { _church_id: string; _user_id: string }
        Returns: boolean
      }
      join_session: {
        Args: { _code: string; _language: string }
        Returns: string
      }
      leave_session: { Args: { _id: string }; Returns: undefined }
      listener_heartbeat: { Args: { _id: string }; Returns: undefined }
    }
    Enums: {
      app_role:
        | "platform_admin"
        | "church_admin"
        | "media_operator"
        | "listener"
      session_status: "draft" | "live" | "paused" | "ended"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "platform_admin",
        "church_admin",
        "media_operator",
        "listener",
      ],
      session_status: ["draft", "live", "paused", "ended"],
    },
  },
} as const
