// Trạng thái dùng chung của cổng: admin đang đăng nhập, số việc (dashboard/work), cờ xem thử.
export function createState({ demo = false } = {}) {
  const subscribers = new Set();
  const state = {
    admin: null,
    work: null,
    demo,
    set(key, value) {
      if (key === 'set' || key === 'subscribe') throw new Error('Không được ghi đè ' + key);
      state[key] = value;
      subscribers.forEach((fn) => {
        try { fn(key, value, state); } catch (error) { console.warn('[MIO] Lỗi khi cập nhật trạng thái:', error); }
      });
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
  return state;
}
