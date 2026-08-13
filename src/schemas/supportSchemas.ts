import { z } from "zod";

export const createContactMessageBodySchema = z.object({
  full_name: z.string().trim().min(2).max(140),
  email: z.string().email(),
  phone: z.string().trim().min(8).max(30).optional(),
  subject: z.string().trim().min(2).max(180),
  message: z.string().trim().min(10).max(5000)
}).strict();

// NOTE: createApplicationBodySchema / public.applications was removed by the 014
// migration. Becoming a partner or charity now goes through the dedicated
// registerPartner/registerCharity flow (see authSchemas.ts) instead of a generic
// "application" form.

export type CreateContactMessageBody = z.infer<typeof createContactMessageBodySchema>;
