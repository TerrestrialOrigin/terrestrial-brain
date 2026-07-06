export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      ai_output: {
        Row: {
          content: string;
          created_at: string;
          file_path: string;
          id: string;
          picked_up: boolean;
          picked_up_at: string | null;
          rejected: boolean;
          rejected_at: string | null;
          source_context: string | null;
          title: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          file_path: string;
          id?: string;
          picked_up?: boolean;
          picked_up_at?: string | null;
          rejected?: boolean;
          rejected_at?: string | null;
          source_context?: string | null;
          title: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          file_path?: string;
          id?: string;
          picked_up?: boolean;
          picked_up_at?: string | null;
          rejected?: boolean;
          rejected_at?: string | null;
          source_context?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          content: string;
          created_at: string;
          file_path: string | null;
          id: string;
          project_id: string;
          references: Json;
          title: string;
          updated_at: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          file_path?: string | null;
          id?: string;
          project_id: string;
          references?: Json;
          title: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          file_path?: string | null;
          id?: string;
          project_id?: string;
          references?: Json;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      function_call_logs: {
        Row: {
          called_at: string;
          error_details: string | null;
          function_name: string;
          function_type: string;
          id: string;
          input: string | null;
          ip_address: string | null;
          records_returned: number | null;
          response_characters: number | null;
        };
        Insert: {
          called_at?: string;
          error_details?: string | null;
          function_name: string;
          function_type: string;
          id?: string;
          input?: string | null;
          ip_address?: string | null;
          records_returned?: number | null;
          response_characters?: number | null;
        };
        Update: {
          called_at?: string;
          error_details?: string | null;
          function_name?: string;
          function_type?: string;
          id?: string;
          input?: string | null;
          ip_address?: string | null;
          records_returned?: number | null;
          response_characters?: number | null;
        };
        Relationships: [];
      };
      note_snapshots: {
        Row: {
          captured_at: string;
          content: string;
          id: string;
          reference_id: string;
          source: string | null;
          title: string | null;
        };
        Insert: {
          captured_at?: string;
          content: string;
          id?: string;
          reference_id: string;
          source?: string | null;
          title?: string | null;
        };
        Update: {
          captured_at?: string;
          content?: string;
          id?: string;
          reference_id?: string;
          source?: string | null;
          title?: string | null;
        };
        Relationships: [];
      };
      people: {
        Row: {
          archived_at: string | null;
          created_at: string;
          description: string | null;
          email: string | null;
          id: string;
          metadata: Json;
          name: string;
          type: string | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          description?: string | null;
          email?: string | null;
          id?: string;
          metadata?: Json;
          name: string;
          type?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          description?: string | null;
          email?: string | null;
          id?: string;
          metadata?: Json;
          name?: string;
          type?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          archived_at: string | null;
          created_at: string | null;
          description: string | null;
          id: string;
          metadata: Json | null;
          name: string;
          parent_id: string | null;
          type: string | null;
          updated_at: string | null;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          metadata?: Json | null;
          name: string;
          parent_id?: string | null;
          type?: string | null;
          updated_at?: string | null;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          metadata?: Json | null;
          name?: string;
          parent_id?: string | null;
          type?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projects_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          archived_at: string | null;
          assigned_to: string | null;
          content: string;
          created_at: string | null;
          due_by: string | null;
          id: string;
          metadata: Json | null;
          parent_id: string | null;
          project_id: string | null;
          reference_id: string | null;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          archived_at?: string | null;
          assigned_to?: string | null;
          content: string;
          created_at?: string | null;
          due_by?: string | null;
          id?: string;
          metadata?: Json | null;
          parent_id?: string | null;
          project_id?: string | null;
          reference_id?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          archived_at?: string | null;
          assigned_to?: string | null;
          content?: string;
          created_at?: string | null;
          due_by?: string | null;
          id?: string;
          metadata?: Json | null;
          parent_id?: string | null;
          project_id?: string | null;
          reference_id?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "people";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      thoughts: {
        Row: {
          archived_at: string | null;
          author: string | null;
          content: string;
          created_at: string | null;
          embedding: string | null;
          id: string;
          metadata: Json | null;
          note_snapshot_id: string | null;
          reference_id: string | null;
          reliability: string | null;
          updated_at: string | null;
          usefulness_score: number;
        };
        Insert: {
          archived_at?: string | null;
          author?: string | null;
          content: string;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          metadata?: Json | null;
          note_snapshot_id?: string | null;
          reference_id?: string | null;
          reliability?: string | null;
          updated_at?: string | null;
          usefulness_score?: number;
        };
        Update: {
          archived_at?: string | null;
          author?: string | null;
          content?: string;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          metadata?: Json | null;
          note_snapshot_id?: string | null;
          reference_id?: string | null;
          reliability?: string | null;
          updated_at?: string | null;
          usefulness_score?: number;
        };
        Relationships: [
          {
            foreignKeyName: "thoughts_note_snapshot_id_fkey";
            columns: ["note_snapshot_id"];
            isOneToOne: false;
            referencedRelation: "note_snapshots";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_pending_ai_output_metadata: {
        Args: never;
        Returns: {
          content_size: number;
          created_at: string;
          file_path: string;
          id: string;
          title: string;
        }[];
      };
      increment_usefulness: {
        Args: { thought_ids: string[] };
        Returns: number;
      };
      match_thoughts: {
        Args: {
          filter?: Json;
          filter_author?: string;
          filter_reliability?: string;
          match_count: number;
          match_threshold: number;
          query_embedding: string;
        };
        Returns: {
          author: string;
          content: string;
          created_at: string;
          id: string;
          metadata: Json;
          reliability: string;
          similarity: number;
          updated_at: string;
        }[];
      };
      purge_function_call_logs: {
        Args: { retention_days?: number };
        Returns: number;
      };
      thought_stats: { Args: { p_project_id?: string }; Returns: Json };
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

type DefaultSchema =
  DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Tables"
      ]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Views"
      ]
    )
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Views"
    ]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (
    & DefaultSchema["Tables"]
    & DefaultSchema["Views"]
  ) ? (
      & DefaultSchema["Tables"]
      & DefaultSchema["Views"]
    )[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]][
      "Enums"
    ]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][
    EnumName
  ]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[
      PublicCompositeTypeNameOrOptions["schema"]
    ]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]][
    "CompositeTypes"
  ][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
