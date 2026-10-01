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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      code_submissions: {
        Row: {
          ai_feedback: string | null
          code: string
          created_at: string
          execution_time_ms: number | null
          id: string
          interview_id: string
          language: string
          output: string | null
          passed_tests: number | null
          status: string
          total_tests: number | null
        }
        Insert: {
          ai_feedback?: string | null
          code: string
          created_at?: string
          execution_time_ms?: number | null
          id?: string
          interview_id: string
          language?: string
          output?: string | null
          passed_tests?: number | null
          status?: string
          total_tests?: number | null
        }
        Update: {
          ai_feedback?: string | null
          code?: string
          created_at?: string
          execution_time_ms?: number | null
          id?: string
          interview_id?: string
          language?: string
          output?: string | null
          passed_tests?: number | null
          status?: string
          total_tests?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "code_submissions_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          interview_id: string
          metadata: Json | null
          role: string
          round: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          interview_id: string
          metadata?: Json | null
          role: string
          round: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          interview_id?: string
          metadata?: Json | null
          role?: string
          round?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_messages_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_questions: {
        Row: {
          ai_feedback: string | null
          ai_score: number | null
          candidate_answer: string | null
          created_at: string
          difficulty: string
          id: string
          interview_id: string
          order_index: number
          question_text: string
          question_type: string
          selected: boolean
        }
        Insert: {
          ai_feedback?: string | null
          ai_score?: number | null
          candidate_answer?: string | null
          created_at?: string
          difficulty?: string
          id?: string
          interview_id: string
          order_index?: number
          question_text: string
          question_type: string
          selected?: boolean
        }
        Update: {
          ai_feedback?: string | null
          ai_score?: number | null
          candidate_answer?: string | null
          created_at?: string
          difficulty?: string
          id?: string
          interview_id?: string
          order_index?: number
          question_text?: string
          question_type?: string
          selected?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "interview_questions_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          ai_recommendation: string | null
          behavioral_score: number | null
          candidate_email: string | null
          candidate_experience: string | null
          candidate_name: string
          coding_score: number | null
          created_at: string
          current_round: string
          duration_seconds: number | null
          id: string
          invite_token: string | null
          jd_file_path: string | null
          job_role: string
          overall_score: number | null
          status: string
          technical_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_recommendation?: string | null
          behavioral_score?: number | null
          candidate_email?: string | null
          candidate_experience?: string | null
          candidate_name?: string
          coding_score?: number | null
          created_at?: string
          current_round?: string
          duration_seconds?: number | null
          id?: string
          invite_token?: string | null
          jd_file_path?: string | null
          job_role?: string
          overall_score?: number | null
          status?: string
          technical_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_recommendation?: string | null
          behavioral_score?: number | null
          candidate_email?: string | null
          candidate_experience?: string | null
          candidate_name?: string
          coding_score?: number | null
          created_at?: string
          current_round?: string
          duration_seconds?: number | null
          id?: string
          invite_token?: string | null
          jd_file_path?: string | null
          job_role?: string
          overall_score?: number | null
          status?: string
          technical_score?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
