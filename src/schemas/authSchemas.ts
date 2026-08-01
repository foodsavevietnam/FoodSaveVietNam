import { z } from "zod";

export const authRoleSchema = z.enum(["partner", "charity", "admin"]);

const passwordSchema = z.string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const phoneSchema = z.string().trim().min(8).max(32);
const shortTextSchema = z.string().trim().min(1).max(180);
const optionalShortTextSchema = z.string().trim().min(1).max(180).optional();
const addressSchema = z.string().trim().min(3).max(500);
const optionalLongTextSchema = z.string().trim().min(1).max(1200).optional();
const timeOfDaySchema = z.string().trim().regex(/^\d{2}:\d{2}$/);
const partnerHashtagsSchema = z.array(z.string().trim().min(1).max(40)).max(5).optional();
const partnerOpeningScheduleSchema = z.array(z.object({
  day: z.string().trim().min(1).max(40),
  open: z.boolean().default(true),
  from: timeOfDaySchema.optional(),
  to: timeOfDaySchema.optional()
}).strict()).max(14).optional();

export const loginBodySchema = z.object({
  identifier: z.string().trim().min(3).max(180),
  password: z.string().min(1).max(128),
  expected_role: authRoleSchema.optional()
}).strict();

export const refreshTokenBodySchema = z.object({
  refresh_token: z.string().trim().min(20)
}).strict();

export const passwordResetBodySchema = z.object({
  identifier: z.string().trim().min(3).max(180)
}).strict();

export const googleOAuthStartBodySchema = z.object({
  redirect_to: z.string().trim().url().optional()
}).strict();

export const facebookOAuthStartBodySchema = googleOAuthStartBodySchema;

export const facebookOAuthCallbackBodySchema = z.object({
  access_token: z.string().trim().min(20),
  refresh_token: z.string().trim().min(20),
  expires_at: z.number().int().positive().nullable().optional(),
  token_type: z.string().trim().min(1).default("bearer"),
  expected_role: authRoleSchema.optional()
}).strict();

export const googleOtpRequestBodySchema = z.object({
  access_token: z.string().trim().min(20),
  expected_role: authRoleSchema.optional()
}).strict();

export const googleOtpVerifyBodySchema = z.object({
  challenge_id: z.string().uuid(),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must contain 6 digits"),
  expected_role: authRoleSchema.optional()
}).strict();

export const phoneOtpRequestBodySchema = z.object({
  phone: phoneSchema,
  expected_role: authRoleSchema.optional()
}).strict();

export const phoneOtpVerifyBodySchema = z.object({
  phone: phoneSchema,
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must contain 6 digits"),
  expected_role: authRoleSchema.optional()
}).strict();

// NOTE: registerCustomerBodySchema was removed. The "customer" role and its backing
// public.customer_profiles table no longer exist as of 014_foodsave_partner_charity_refactor.sql.

// NOTE on fields removed from registerPartnerBodySchema below (kept out on purpose, not
// silently dropped): bank_name/bank_account_number/bank_account_holder, automation
// (dynamicPricing/charityTransfer) and representative_title have no backing column on
// public.stores in the new schema. Add columns there first if these need to persist again.
export const registerPartnerBodySchema = z.object({
  store_name: shortTextSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  street: addressSchema,
  ward: optionalShortTextSchema,
  city: shortTextSchema.default("TP.HCM"),
  business_type: z.enum(["bakery", "restaurant", "convenience", "supermarket", "other"]),
  representative_name: shortTextSchema,
  cccd_number: optionalShortTextSchema,
  legal_name: optionalShortTextSchema,
  description: optionalLongTextSchema,
  hashtags: partnerHashtagsSchema,
  public_hotline: phoneSchema.optional(),
  admin_email: emailSchema.optional(),
  admin_phone: phoneSchema.optional(),
  business_license_number: optionalShortTextSchema,
  tax_code: optionalShortTextSchema,
  avatar_url: z.string().trim().url().max(500).optional(),
  cover_url: z.string().trim().url().max(500).optional(),
  cccd_front_url: z.string().trim().url().max(500).optional(),
  cccd_back_url: z.string().trim().url().max(500).optional(),
  business_license_url: z.string().trim().url().max(500).optional(),
  food_safety_certificate_url: z.string().trim().url().max(500).optional(),
  opening_schedule: partnerOpeningScheduleSchema,
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  terms_accepted: z.literal(true)
}).strict();

// NOTE on fields removed from registerCharityBodySchema below: organization_type,
// meals_per_day, volunteer_count and service_radius_km have no backing column on
// public.charity_profiles in the new schema (they used to only live inside the now
// dropped public.applications.payload jsonb, never in the profile row itself). Add
// columns (or a dedicated scale table) first if these need to persist again.
export const registerCharityBodySchema = z.object({
  organization_name: shortTextSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  street: addressSchema,
  ward: optionalShortTextSchema,
  city: shortTextSchema.default("TP.HCM"),
  legal_name: optionalShortTextSchema,
  representative_name: shortTextSchema,
  representative_title: optionalShortTextSchema,
  beneficiaries_count: z.number().int().min(0).max(100000).default(0),
  terms_accepted: z.literal(true)
}).strict();

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;
export type PasswordResetBody = z.infer<typeof passwordResetBodySchema>;
export type GoogleOAuthStartBody = z.infer<typeof googleOAuthStartBodySchema>;
export type GoogleOtpRequestBody = z.infer<typeof googleOtpRequestBodySchema>;
export type GoogleOtpVerifyBody = z.infer<typeof googleOtpVerifyBodySchema>;
export type FacebookOAuthStartBody = z.infer<typeof facebookOAuthStartBodySchema>;
export type FacebookOAuthCallbackBody = z.infer<typeof facebookOAuthCallbackBodySchema>;
export type PhoneOtpRequestBody = z.infer<typeof phoneOtpRequestBodySchema>;
export type PhoneOtpVerifyBody = z.infer<typeof phoneOtpVerifyBodySchema>;
export type RegisterPartnerBody = z.infer<typeof registerPartnerBodySchema>;
export type RegisterCharityBody = z.infer<typeof registerCharityBodySchema>;
