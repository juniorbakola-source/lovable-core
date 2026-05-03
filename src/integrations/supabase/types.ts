export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1";
  };
  public: {
    Tables: {
      companies: {
        Row: {
          created_at: string | null;
          id: string;
          industry: string | null;
          name: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          industry?: string | null;
          name: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          industry?: string | null;
          name?: string;
        };
        Relationships: [];
      };
      contact_submissions: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string;
          phone: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          name: string;
          phone?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
      "Contrôle Réception": {
        Row: {
          created_at: string;
          "Purchase Order": number;
        };
        Insert: {
          created_at?: string;
          "Purchase Order"?: number;
        };
        Update: {
          created_at?: string;
          "Purchase Order"?: number;
        };
        Relationships: [];
      };
      demand_history: {
        Row: {
          date: string | null;
          id: string;
          quantity: number | null;
          sku_id: string | null;
        };
        Insert: {
          date?: string | null;
          id?: string;
          quantity?: number | null;
          sku_id?: string | null;
        };
        Update: {
          date?: string | null;
          id?: string;
          quantity?: number | null;
          sku_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "demand_history_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      email_send_log: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          message_id: string | null;
          metadata: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email?: string;
          status?: string;
          template_name?: string;
        };
        Relationships: [];
      };
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number;
          batch_size: number;
          id: number;
          retry_after_until: string | null;
          send_delay_ms: number;
          transactional_email_ttl_minutes: number;
          updated_at: string;
        };
        Insert: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Update: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_unsubscribe_tokens: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          token: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          token: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      forecasts: {
        Row: {
          forecast_date: string | null;
          id: string;
          predicted_quantity: number | null;
          sku_id: string | null;
        };
        Insert: {
          forecast_date?: string | null;
          id?: string;
          predicted_quantity?: number | null;
          sku_id?: string | null;
        };
        Update: {
          forecast_date?: string | null;
          id?: string;
          predicted_quantity?: number | null;
          sku_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "forecasts_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory: {
        Row: {
          id: string;
          incoming: number | null;
          on_hand: number | null;
          reorder_point: number | null;
          reserved: number | null;
          safety_stock: number | null;
          sku_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          incoming?: number | null;
          on_hand?: number | null;
          reorder_point?: number | null;
          reserved?: number | null;
          safety_stock?: number | null;
          sku_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          incoming?: number | null;
          on_hand?: number | null;
          reorder_point?: number | null;
          reserved?: number | null;
          safety_stock?: number | null;
          sku_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      kpis: {
        Row: {
          calculated_at: string | null;
          company_id: string | null;
          id: string;
          savings: number | null;
          service_level: number | null;
          stock_value: number | null;
        };
        Insert: {
          calculated_at?: string | null;
          company_id?: string | null;
          id?: string;
          savings?: number | null;
          service_level?: number | null;
          stock_value?: number | null;
        };
        Update: {
          calculated_at?: string | null;
          company_id?: string | null;
          id?: string;
          savings?: number | null;
          service_level?: number | null;
          stock_value?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "kpis_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      optimization_runs: {
        Row: {
          completed_at: string | null;
          created_at: string;
          error_message: string | null;
          id: string;
          model: string | null;
          skus_processed: number;
          skus_succeeded: number;
          status: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          model?: string | null;
          skus_processed?: number;
          skus_succeeded?: number;
          status?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          model?: string | null;
          skus_processed?: number;
          skus_succeeded?: number;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          company_id: string | null;
          created_at: string | null;
          id: string;
          role: string | null;
        };
        Insert: {
          company_id?: string | null;
          created_at?: string | null;
          id: string;
          role?: string | null;
        };
        Update: {
          company_id?: string | null;
          created_at?: string | null;
          id?: string;
          role?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_order_items: {
        Row: {
          id: string;
          po_id: string | null;
          quantity: number | null;
          sku_id: string | null;
          unit_price: number | null;
        };
        Insert: {
          id?: string;
          po_id?: string | null;
          quantity?: number | null;
          sku_id?: string | null;
          unit_price?: number | null;
        };
        Update: {
          id?: string;
          po_id?: string | null;
          quantity?: number | null;
          sku_id?: string | null;
          unit_price?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey";
            columns: ["po_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_items_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          company_id: string | null;
          created_at: string | null;
          expected_at: string | null;
          id: string;
          notes: string | null;
          ordered_at: string | null;
          po_number: string | null;
          quantity: number | null;
          received_at: string | null;
          sku_id: string | null;
          status: string | null;
          total_amount: number | null;
          unit_cost: number | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          company_id?: string | null;
          created_at?: string | null;
          expected_at?: string | null;
          id?: string;
          notes?: string | null;
          ordered_at?: string | null;
          po_number?: string | null;
          quantity?: number | null;
          received_at?: string | null;
          sku_id?: string | null;
          status?: string | null;
          total_amount?: number | null;
          unit_cost?: number | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          company_id?: string | null;
          created_at?: string | null;
          expected_at?: string | null;
          id?: string;
          notes?: string | null;
          ordered_at?: string | null;
          po_number?: string | null;
          quantity?: number | null;
          received_at?: string | null;
          sku_id?: string | null;
          status?: string | null;
          total_amount?: number | null;
          unit_cost?: number | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      recommendations: {
        Row: {
          created_at: string | null;
          id: string;
          reorder_point: number | null;
          reorder_qty: number | null;
          safety_stock: number | null;
          sku_id: string | null;
          status: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          reorder_point?: number | null;
          reorder_qty?: number | null;
          safety_stock?: number | null;
          sku_id?: string | null;
          status?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          reorder_point?: number | null;
          reorder_qty?: number | null;
          safety_stock?: number | null;
          sku_id?: string | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recommendations_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      skus: {
        Row: {
          ai_justification: string | null;
          ai_max_recommended: number | null;
          ai_min_recommended: number | null;
          ai_optimized_at: string | null;
          category: string | null;
          company_id: string | null;
          created_at: string | null;
          demand_history: number[] | null;
          demand_history_yearly: number[] | null;
          forecast_3m: number[] | null;
          id: string;
          in_production: number | null;
          lead_time_days: number | null;
          max_stock: number | null;
          min_stock: number | null;
          moq: number | null;
          name: string | null;
          on_order: number | null;
          service_level: number | null;
          sku_code: string | null;
          stock: number | null;
          unit_cost: number | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          ai_justification?: string | null;
          ai_max_recommended?: number | null;
          ai_min_recommended?: number | null;
          ai_optimized_at?: string | null;
          category?: string | null;
          company_id?: string | null;
          created_at?: string | null;
          demand_history?: number[] | null;
          demand_history_yearly?: number[] | null;
          forecast_3m?: number[] | null;
          id?: string;
          in_production?: number | null;
          lead_time_days?: number | null;
          max_stock?: number | null;
          min_stock?: number | null;
          moq?: number | null;
          name?: string | null;
          on_order?: number | null;
          service_level?: number | null;
          sku_code?: string | null;
          stock?: number | null;
          unit_cost?: number | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          ai_justification?: string | null;
          ai_max_recommended?: number | null;
          ai_min_recommended?: number | null;
          ai_optimized_at?: string | null;
          category?: string | null;
          company_id?: string | null;
          created_at?: string | null;
          demand_history?: number[] | null;
          demand_history_yearly?: number[] | null;
          forecast_3m?: number[] | null;
          id?: string;
          in_production?: number | null;
          lead_time_days?: number | null;
          max_stock?: number | null;
          min_stock?: number | null;
          moq?: number | null;
          name?: string | null;
          on_order?: number | null;
          service_level?: number | null;
          sku_code?: string | null;
          stock?: number | null;
          unit_cost?: number | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "skus_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      supply: {
        Row: {
          id: string;
          lead_time_days: number | null;
          sku_id: string | null;
          supplier_name: string | null;
        };
        Insert: {
          id?: string;
          lead_time_days?: number | null;
          sku_id?: string | null;
          supplier_name?: string | null;
        };
        Update: {
          id?: string;
          lead_time_days?: number | null;
          sku_id?: string | null;
          supplier_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "supply_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
        ];
      };
      suppressed_emails: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          metadata: Json | null;
          reason: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          metadata?: Json | null;
          reason: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          metadata?: Json | null;
          reason?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_orphan_skus: {
        Row: {
          ai_justification: string | null;
          ai_max_recommended: number | null;
          ai_min_recommended: number | null;
          ai_optimized_at: string | null;
          category: string | null;
          company_id: string | null;
          created_at: string | null;
          demand_history: number[] | null;
          demand_history_yearly: number[] | null;
          forecast_3m: number[] | null;
          id: string;
          in_production: number | null;
          lead_time_days: number | null;
          max_stock: number | null;
          min_stock: number | null;
          moq: number | null;
          name: string | null;
          on_order: number | null;
          service_level: number | null;
          sku_code: string | null;
          stock: number | null;
          unit_cost: number | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "skus_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string };
        Returns: boolean;
      };
      enqueue_email: {
        Args: { payload: Json; queue_name: string };
        Returns: number;
      };
      purge_orphan_skus: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      move_to_dlq: {
        Args: {
          dlq_name: string;
          message_id: number;
          payload: Json;
          source_queue: string;
        };
        Returns: number;
      };
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number };
        Returns: {
          message: Json;
          msg_id: number;
          read_ct: number;
        }[];
      };
      upload_file: { Args: { file_name: string }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
