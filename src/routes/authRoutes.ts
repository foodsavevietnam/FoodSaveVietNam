import { Router } from "express";
import { authController } from "../controllers/authController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { authRateLimiter } from "../middlewares/rateLimiter";
import { validateRequest } from "../middlewares/validateRequest";
import {
  facebookOAuthCallbackBodySchema,
  facebookOAuthStartBodySchema,
  googleOAuthStartBodySchema,
  googleOtpRequestBodySchema,
  googleOtpVerifyBodySchema,
  loginBodySchema,
  passwordResetBodySchema,
  phoneOtpRequestBodySchema,
  phoneOtpVerifyBodySchema,
  refreshTokenBodySchema,
  registerCharityBodySchema,
  registerCustomerBodySchema,
  registerPartnerBodySchema
} from "../schemas/authSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const authRoutes = Router();

authRoutes.post(
  "/register/customer",
  authRateLimiter,
  validateRequest({ body: registerCustomerBodySchema }),
  asyncHandler(authController.registerCustomer)
);

authRoutes.post(
  "/register/partner",
  authRateLimiter,
  validateRequest({ body: registerPartnerBodySchema }),
  asyncHandler(authController.registerPartner)
);

authRoutes.post(
  "/register/charity",
  authRateLimiter,
  validateRequest({ body: registerCharityBodySchema }),
  asyncHandler(authController.registerCharity)
);

authRoutes.post(
  "/login",
  authRateLimiter,
  validateRequest({ body: loginBodySchema }),
  asyncHandler(authController.login)
);

authRoutes.post(
  "/google/start",
  validateRequest({ body: googleOAuthStartBodySchema }),
  asyncHandler(authController.startGoogleOAuth)
);

authRoutes.post(
  "/google/otp",
  authRateLimiter,
  validateRequest({ body: googleOtpRequestBodySchema }),
  asyncHandler(authController.requestGoogleOtp)
);

authRoutes.post(
  "/google/verify",
  authRateLimiter,
  validateRequest({ body: googleOtpVerifyBodySchema }),
  asyncHandler(authController.verifyGoogleOtp)
);

authRoutes.post(
  "/facebook/start",
  validateRequest({ body: facebookOAuthStartBodySchema }),
  asyncHandler(authController.startFacebookOAuth)
);

authRoutes.post(
  "/facebook/callback",
  validateRequest({ body: facebookOAuthCallbackBodySchema }),
  asyncHandler(authController.completeFacebookOAuth)
);

authRoutes.post(
  "/phone/otp",
  authRateLimiter,
  validateRequest({ body: phoneOtpRequestBodySchema }),
  asyncHandler(authController.requestPhoneOtp)
);

authRoutes.post(
  "/phone/verify",
  authRateLimiter,
  validateRequest({ body: phoneOtpVerifyBodySchema }),
  asyncHandler(authController.verifyPhoneOtp)
);

authRoutes.post(
  "/refresh",
  validateRequest({ body: refreshTokenBodySchema }),
  asyncHandler(authController.refresh)
);

authRoutes.post(
  "/password-reset",
  authRateLimiter,
  validateRequest({ body: passwordResetBodySchema }),
  asyncHandler(authController.requestPasswordReset)
);

authRoutes.post(
  "/logout",
  authMiddleware,
  asyncHandler(authController.logout)
);
