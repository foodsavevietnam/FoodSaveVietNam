import { z } from "zod";

const contextSchema = z.object({
  kind: z.enum(["donation", "order"]),
  id: z.string().uuid()
}).strict();

const consentBodySchema = z.object({
  granted: z.boolean(),
  policy_version: z.string().min(1).max(40)
}).strict();

// Tọa độ rác bị chặn: ngoài khoảng, cả hai cùng 0, độ chính xác > 2000 m
const reportBodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(2000).optional(),
  recorded_at: z.string().datetime({ offset: true }).optional(),
  context: contextSchema
}).strict().refine((value) => !(value.lat === 0 && value.lng === 0), { message: "Tọa độ (0,0) không hợp lệ", path: ["lat"] });

export const locationSchemas = { consent: consentBodySchema, report: reportBodySchema };

export type LocationReportBody = z.infer<typeof reportBodySchema>;
