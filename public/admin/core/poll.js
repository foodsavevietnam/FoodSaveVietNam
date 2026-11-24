// Lịch poll chung: dừng khi tab ẩn hoặc rảnh quá idleMs; thao tác lại thì làm mới ngay.
// Lỗi liên tiếp (ví dụ 5xx): giãn nhịp backoff và tạm dừng job sau maxFailures lần liên tiếp cho tới khi chạy thành công hoặc người dùng bấm tiếp tục/chuyển tab.
// Không chạm document/window ở cấp module (import được trong Node).
const HEARTBEAT_MS = 5000;
const DEFAULT_MAX_FAILURES = 3;

export const isPollFailure = (err) => Boolean(
  err && err.name !== 'AbortError' && (err.status >= 500 || err.code === 'NETWORK' || err.code === 'TIMEOUT'),
);

export function createPoll({
  now = Date.now,
  visible,
  idleMs = 900000,
  minGapMs = 10000,
  maxFailures = DEFAULT_MAX_FAILURES,
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

  function recordFailure(job, error) {
    job.failures += 1;
    if (job.failures >= maxFailures) {
      job.halted = true;
      console.warn('[MIO] Tạm dừng làm mới do lỗi liên tiếp:', error);
    } else {
      console.warn('[MIO] Không làm mới được dữ liệu:', error);
    }
  }

  function resetFailures() {
    jobs.forEach((job) => { job.failures = 0; job.halted = false; });
  }

  function run(job, t) {
    if (job.running || job.halted) return;
    job.last = t;
    let result;
    try { result = job.fn(); } catch (error) { recordFailure(job, error); return; }
    if (result && typeof result.then === 'function') {
      job.running = true;
      result.then(
        () => { job.failures = 0; job.halted = false; job.running = false; },
        (error) => { recordFailure(job, error); job.running = false; },
      );
    } else {
      job.failures = 0;
      job.halted = false;
    }
  }

  function gapOf(baseMs, job) {
    return job.failures > 0 ? baseMs * (2 ** job.failures) : baseMs;
  }

  function tick(resume = false) {
    if (demo) return;
    const idle = manual || isIdle();
    setPaused(idle);
    if (!isVisible()) return;
    const t = now();
    if (idle) {
      // Rảnh: chỉ job có idleMs riêng chạy thưa
      jobs.forEach((job) => { if (!job.halted && job.idleMs && t - job.last >= gapOf(job.idleMs, job)) run(job, t); });
      return;
    }
    jobs.forEach((job) => {
      if (job.halted) return;
      const gap = resume ? minGapMs : gapOf(job.everyMs, job);
      if (t - job.last >= gap) run(job, t);
    });
  }

  function add(name, fn, { everyMs, idleMs: jobIdleMs = 0, immediate = false } = {}) {
    jobs.set(name, { fn, everyMs, idleMs: jobIdleMs, last: immediate ? -Infinity : now(), running: false, failures: 0, halted: false });
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
      resetFailures();
      setPaused(false);
      tick(true);
    }
  }

  // pause() thủ công bị hủy khi người dùng thao tác (touch/resume)
  function pause() { manual = true; setPaused(true); }
  function resume() { resetFailures(); touch(); }

  function attach(doc) {
    if (!visible) isVisible = () => doc.visibilityState === 'visible';
    const onTouch = () => touch();
    // Quay lại tab tính là một thao tác: hết rảnh, làm mới ngay (tôn trọng minGap)
    const onVisible = () => {
      if (!isVisible()) return;
      lastInteraction = now();
      manual = false;
      resetFailures();
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
