import { env } from "../config/env";
import type { VolunteerTokenPayload } from "./volunteerToken";

/**
 * Token TNV có được dùng ở môi trường hiện tại không:
 * token OTP luôn dùng được; token demo chỉ khi DEMO_MODE và không phải production.
 * Tách module riêng để các middleware dùng chung một cổng (volunteerToken.ts re-export lại).
 */
export const isVolunteerTokenUsable = (payload: Pick<VolunteerTokenPayload, "amr">): boolean =>
  payload.amr === "otp" || (env.NODE_ENV !== "production" && env.DEMO_MODE);
