// Dữ liệu mẫu cho GET /admin/order-policy (shape của adminController.orderPolicy).
export default {
  stored: false,
  updated_at: null,
  updated_by: null,
  labels: {
    green: { payMinutes: 10, pickupMinutes: 120, cancelFreeBeforePickupMinutes: 30, finalReminderMinutes: 15 },
    yellow: { payMinutes: 10, pickupMinutes: 90, cancelFreeBeforePickupMinutes: 20, finalReminderMinutes: 15 },
    red: { payMinutes: 5, pickupMinutes: 60, cancelFreeBeforePickupMinutes: 15, finalReminderMinutes: 10 },
  },
  grace_cancel_minutes: 3,
  min_pickup_window_minutes: 15,
  platform_fee: 2000,
  no_show_ban_count: 3,
  no_show_window_days: 30,
  red_ban_days: 7,
  reputation: {
    initialScore: 100, maxScore: 100, pickupSuccessDelta: 5, noShowDelta: -15, lateCancelDelta: -5,
    falseComplaintDelta: -10, trustedThreshold: 85, blockedBelow: 40,
  },
  time_scale: 1,
};
