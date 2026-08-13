import type { CreateContactMessageBody } from "../schemas/supportSchemas";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

// NOTE: createApplication (public.applications) was removed by the 014 migration —
// becoming a partner or charity now goes through authService.registerPartner/
// registerCharity instead of a generic application form.
export const supportService = {
  async createContactMessage(userId: string | null, body: CreateContactMessageBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("contact_messages")
      .insert({
        ...body,
        user_id: userId,
        status: "open"
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create contact message");
    return data;
  }
};
