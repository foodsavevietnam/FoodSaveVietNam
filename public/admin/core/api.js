// Lớp gọi API: bóc { success, data }, chuẩn hóa lỗi thành ApiError (thông điệp tiếng Việt).
const MESSAGES = {
  NETWORK: 'Không kết nối được máy chủ.',
  BAD_RESPONSE: 'Máy chủ trả dữ liệu không hợp lệ.',
  TIMEOUT: 'Máy chủ phản hồi quá lâu.',
  AUTH_INVALID_TOKEN: 'Phiên đăng nhập đã hết hạn.',
  AUTH_MISSING_TOKEN: 'Phiên đăng nhập đã hết hạn.',
  AUTH_FORBIDDEN: 'Bạn không có quyền thực hiện.',
};

export class ApiError extends Error {
  constructor(code, message, status = 0, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, status = 0, details) => new ApiError(code, MESSAGES[code], status, details);

export function createApi({ fetch = globalThis.fetch, getToken, baseUrl = '', onUnauthorized, timeoutMs = 15000 }) {
  async function request(method, path, body, opt = {}) {
    const token = await getToken?.();
    if (!token) throw fail('AUTH_MISSING_TOKEN');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const caller = opt.signal;
    const onCallerAbort = () => controller.abort(caller.reason);
    if (caller) {
      if (caller.aborted) onCallerAbort();
      else caller.addEventListener('abort', onCallerAbort, { once: true });
    }

    const headers = { Authorization: `Bearer ${token}` };
    const init = { method, headers, signal: controller.signal };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    let payload;
    let jsonFailed = false;
    try {
      try {
        res = await fetch(`${baseUrl}${path}`, init);
        payload = await res.json();
      } catch (error) {
        if (!res || timedOut || caller?.aborted || error?.name === 'AbortError') throw error;
        jsonFailed = true;
      }
    } catch (error) {
      if (timedOut) throw fail('TIMEOUT');
      if (caller?.aborted || error?.name === 'AbortError') throw error;
      throw fail('NETWORK');
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    }

    if (res.status === 401) {
      onUnauthorized?.();
      const code = (!jsonFailed && payload?.error?.code) || 'AUTH_INVALID_TOKEN';
      throw new ApiError(code, MESSAGES[code] || payload?.error?.message || MESSAGES.AUTH_INVALID_TOKEN, 401, payload?.error?.details);
    }
    if (jsonFailed || payload === null || typeof payload !== 'object') throw fail('BAD_RESPONSE', res.status);
    if (!res.ok || payload.success === false) {
      const err = payload.error || {};
      const code = err.code || (res.status === 403 ? 'AUTH_FORBIDDEN' : 'BAD_RESPONSE');
      throw new ApiError(code, MESSAGES[code] || err.message || MESSAGES.BAD_RESPONSE, res.status, err.details);
    }
    return payload.data;
  }

  return {
    get: (path, opt) => request('GET', path, undefined, opt),
    post: (path, body, opt) => request('POST', path, body, opt),
    patch: (path, body, opt) => request('PATCH', path, body, opt),
    put: (path, body, opt) => request('PUT', path, body, opt),
    del: (path, opt) => request('DELETE', path, undefined, opt),
  };
}
