// Dữ liệu xem thử (?demo=1) cho màn "Cài đặt".
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động (ví dụ /orders/:id); trả undefined nếu không khớp.
export const routes = {};

export function resolve() {
  return undefined;
}
