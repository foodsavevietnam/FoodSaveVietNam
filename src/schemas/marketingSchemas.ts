import { z } from "zod";

export const marketingChannelSchema = z.enum(["buyers", "facebook", "instagram", "tiktok", "zalo"]);

export const marketingSettingsBodySchema = z.object({
  marketing_auto: z.boolean().optional(),
  facebook_page_id: z.string().trim().max(60).optional(),
  facebook_page_name: z.string().trim().max(160).optional(),
  // A settings PATCH may contain just one channel; Zod 4's enum record would
  // otherwise require every channel to be present.
  channels: z.partialRecord(marketingChannelSchema, z.object({
    enabled: z.boolean().optional(),
    info: z.record(z.string().max(40), z.string().trim().max(200)).optional()
  }).strict()).optional()
}).strict();
