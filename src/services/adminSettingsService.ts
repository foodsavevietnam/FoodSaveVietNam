import { z, type ZodType } from "zod";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { adminAuditService, type AuditActor } from "./adminAuditService";
import { supabaseAdmin } from "./supabaseService";

export type ManagedSettingType = "boolean" | "string" | "number";

export interface SettingRegistryEntry<T = unknown> {
  key: string;
  label: string;
  description: string;
  type: ManagedSettingType;
  default_value: T;
  schema: ZodType<T>;
}

export interface ManagedSettingItem<T = unknown> {
  key: string;
  label: string;
  description: string;
  type: ManagedSettingType;
  value: T;
  default_value: T;
}

export const SETTINGS_REGISTRY = {
  maintenance_mode: {
    key: "maintenance_mode",
    label: "Chế độ bảo trì",
    description: "Bật để hiển thị thông báo bảo trì hệ thống cho người dùng.",
    type: "boolean",
    default_value: false,
    schema: z.boolean()
  },
  support_hotline: {
    key: "support_hotline",
    label: "Tổng đài hỗ trợ",
    description: "Số điện thoại tổng đài hỗ trợ hiển thị trên cổng người dùng (tối đa 40 ký tự).",
    type: "string",
    default_value: "1900 6868",
    schema: z.string().trim().min(1, "Tổng đài hỗ trợ không được để trống").max(40, "Tổng đài hỗ trợ tối đa 40 ký tự")
  },
  support_email: {
    key: "support_email",
    label: "Email hỗ trợ",
    description: "Địa chỉ email tiếp nhận yêu cầu hỗ trợ chính thức của nền tảng.",
    type: "string",
    default_value: "support@makeitorganized.vn",
    schema: z.string().trim().email("Email hỗ trợ không hợp lệ").max(160)
  },
  default_commission_rate: {
    key: "default_commission_rate",
    label: "Phí nền tảng mặc định (%)",
    description: "Tỷ lệ phí nền tảng mặc định áp dụng cho cửa hàng mới (0–30%).",
    type: "number",
    default_value: 12,
    schema: z.number().finite().min(0, "Phí nền tảng phải từ 0% đến 30%").max(30, "Phí nền tảng phải từ 0% đến 30%")
  },
  auto_approve_photo_minutes: {
    key: "auto_approve_photo_minutes",
    label: "Tự duyệt ảnh minh chứng (phút)",
    description: "Thời gian chờ trước khi tự động duyệt ảnh minh chứng bàn giao từ thiện (5–1440 phút).",
    type: "number",
    default_value: 60,
    schema: z.number().int("Phải là số nguyên").min(5, "Thời gian tự duyệt phải từ 5 đến 1440 phút").max(1440, "Thời gian tự duyệt phải từ 5 đến 1440 phút")
  },
  max_orders_per_customer_day: {
    key: "max_orders_per_customer_day",
    label: "Giới hạn đơn/khách mỗi ngày",
    description: "Số lượng đơn hàng tối đa một người mua được đặt trong ngày (1–50).",
    type: "number",
    default_value: 10,
    schema: z.number().int("Phải là số nguyên").min(1, "Giới hạn đơn phải từ 1 đến 50").max(50, "Giới hạn đơn phải từ 1 đến 50")
  }
} as const satisfies Record<string, SettingRegistryEntry<any>>;

export type ManagedSettingKey = keyof typeof SETTINGS_REGISTRY;

const MANAGED_KEYS = Object.keys(SETTINGS_REGISTRY) as ManagedSettingKey[];

const isManagedKey = (key: string): key is ManagedSettingKey =>
  Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key);

export const listManagedSettings = async (): Promise<ManagedSettingItem[]> => {
  const storedMap = new Map<string, unknown>();
  try {
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("key,value")
      .in("key", MANAGED_KEYS);
    if (!error && Array.isArray(data)) {
      for (const row of data as Array<{ key?: unknown; value?: unknown }>) {
        if (typeof row.key === "string") {
          storedMap.set(row.key, row.value);
        }
      }
    }
  } catch {
    // Bảng app_settings chưa tạo hoặc lỗi đọc tạm thời -> trả về default_value an toàn
  }

  return MANAGED_KEYS.map((key) => {
    const entry = SETTINGS_REGISTRY[key];
    let resolvedValue: unknown = entry.default_value;
    if (storedMap.has(key)) {
      const raw = storedMap.get(key);
      const parsed = (entry.schema as ZodType<unknown>).safeParse(raw);
      if (parsed.success) {
        resolvedValue = parsed.data;
      }
    }
    return {
      key: entry.key,
      label: entry.label,
      description: entry.description,
      type: entry.type,
      value: resolvedValue,
      default_value: entry.default_value
    };
  });
};

export const updateManagedSetting = async (
  key: string,
  rawValue: unknown,
  actor: AuditActor
): Promise<ManagedSettingItem> => {
  if (!isManagedKey(key)) {
    throw new AppError(
      "Khóa cài đặt không nằm trong danh sách cho phép",
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const entry = SETTINGS_REGISTRY[key];
  const parsed = (entry.schema as ZodType<unknown>).safeParse(rawValue);
  if (!parsed.success) {
    const issueMsg = parsed.error.issues[0]?.message || "Giá trị cài đặt không hợp lệ";
    throw new AppError(issueMsg, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  await adminSettingsService.set(key, parsed.data, actor);

  return {
    key: entry.key,
    label: entry.label,
    description: entry.description,
    type: entry.type,
    value: parsed.data,
    default_value: entry.default_value
  };
};

// Cài đặt chung của hệ thống (bảng app_settings trong SQL 026). Chưa có bảng thì dùng giá trị mặc định.
export const adminSettingsService = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const { data, error } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (error || !data) return fallback;
    return ((data as { value: T }).value ?? fallback) as T;
  },

  /** Có `actor` thì ghi nhật ký `settings.update` (giá trị trước/sau) sau khi lưu thành công. */
  async set(key: string, value: unknown, actor?: AuditActor): Promise<void> {
    const before = actor ? await adminSettingsService.get<unknown>(key, null) : null;
    const { error } = await supabaseAdmin.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new AppError("Không lưu được cài đặt. Hãy chạy file SQL 026 trên Supabase.", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    if (actor) await adminAuditService.log(actor, "settings.update", "app_setting", key, { key, before, after: value });
  },

  listManagedSettings,
  updateManagedSetting
};
