import { z } from "zod";
import { queryBooleanSchema } from "./commonSchemas";

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread_only: queryBooleanSchema.default(false)
}).strict();

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
