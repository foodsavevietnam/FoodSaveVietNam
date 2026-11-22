// Lịch poll chung: dừng khi tab ẩn hoặc rảnh quá idleMs; thao tác lại thì làm mới ngay.
// Không chạm document/window ở cấp module (import được trong Node).
const HEARTBEAT_MS = 5000;

export function createPoll({
  now = Date.now,
  visible,
  idleMs = 900000,
  minGapMs = 10000,
  demo = false,
  onPaused = () => {},
} = {}) {
  const jobs = new Map();
  let lastInteraction = now();
  let paused = false;
  let manual = false;
  let isVisible = visible || (() => true);

  const isIdle = () => now() - lastInteraction >= idleMs;

  function setPaused(value) {
    if (paused === value) return;
    paused = value;
    try { onPaused(value); } catch (error) { console.warn('[MIO] Lỗi khi đổi trạng thái tạm dừng:', error); }
  }

  function run(job, t) {
    if (job.running) return;
    job.last = t;
    let result;
    try { result = job.fn(); } catch (error) { console.warn('[MIO] Không làm mới được dữ liệu:', error); return; }
    if (result && typeof result.then === 'function') {
      job.running = true;
      result.catch((error) => console.warn('[MIO] Không làm mới được dữ liệu:', error)).then(() => { job.running = false; });
    }
  }

  function tick(resume = false) {
    if (demo) return;
    const idle = manual || isIdle();
    setPaused(idle);
    if (!isVisible()) return;
    const t = now();
    if (idle) {
      // Rảnh: chỉ job có idleMs riêng chạy thưa
      jobs.forEach((job) => { if (job.idleMs && t - job.last >= job.idleMs) run(job, t); });
      return;
    }
    jobs.forEach((job) => { if (t - job.last >= (resume ? minGapMs : job.everyMs)) run(job, t); });
  }

  function add(name, fn, { everyMs, idleMs: jobIdleMs = 0, immediate = false } = {}) {
    jobs.set(name, { fn, everyMs, idleMs: jobIdleMs, last: immediate ? -Infinity : now(), running: false });
  }

  function remove(name) {
    if (name.endsWith('*')) {
      const prefix = name.slice(0, -1);
      for (const key of [...jobs.keys()]) if (key.startsWith(prefix)) jobs.delete(key);
    } else jobs.delete(name);
  }

  function touch() {
    const wasPaused = paused || manual || isIdle();
    manual = false;
    lastInteraction = now();
    if (wasPaused) {
      setPaused(false);
      tick(true);
    }
  }

  // pause() thủ công bị hủy khi người dùng thao tác (touch/resume)
  function pause() { manual = true; setPaused(true); }
  function resume() { touch(); }

  function attach(doc) {
    if (!visible) isVisible = () => doc.visibilityState === 'visible';
    const onTouch = () => touch();
    // Quay lại tab tính là một thao tác: hết rảnh, làm mới ngay (tôn trọng minGap)
    const onVisible = () => {
      if (!isVisible()) return;
      lastInteraction = now();
      manual = false;
      setPaused(false);
      tick(true);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((name) => doc.addEventListener(name, onTouch, { capture: true, passive: true }));
    doc.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => tick(), HEARTBEAT_MS);
    return function detach() {
      events.forEach((name) => doc.removeEventListener(name, onTouch, { capture: true }));
      doc.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }

  return { add, remove, touch, tick, pause, resume, isPaused: () => paused, attach };
}
