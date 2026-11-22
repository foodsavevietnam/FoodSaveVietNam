// Dữ liệu mẫu cho GET /admin/automation (mảng của automationRunService.overview).
const run = (id, job, ok, startedAt, error = null) => ({
  id, job, trigger: 'schedule', started_at: startedAt, finished_at: startedAt, ok, summary: { processed: 4 }, error,
});
const labelRun = run('r-1', 'label-automation', true, '2026-11-23T08:00:00.000Z');
const orderRun = run('r-2', 'order-automation', true, '2026-11-23T08:00:00.000Z');
const failRun = run('r-3', 'complaint-escalation', false, '2026-11-22T20:00:00.000Z', 'Hết thời gian chờ cơ sở dữ liệu');
export default [
  { job: 'label-automation', name: 'Đổi nhãn / giá / chia hàng đỏ', schedule: 'mỗi 5 phút', last_run: labelRun, last_failure: null, runs_7d: 2016, failures_7d: 0, recent: [labelRun] },
  { job: 'order-automation', name: 'Đơn hàng: quá hạn thanh toán, vắng mặt, nhắc lấy hàng', schedule: 'mỗi 5 phút', last_run: orderRun, last_failure: null, runs_7d: 2016, failures_7d: 0, recent: [orderRun] },
  { job: 'complaint-escalation', name: 'Khiếu nại: tự chuyển Admin sau 12 giờ, hoàn tất hoàn tiền dang dở', schedule: 'chạy cùng tác vụ đơn hàng (5 phút)', last_run: failRun, last_failure: { started_at: failRun.started_at, error: failRun.error }, runs_7d: 2016, failures_7d: 1, recent: [failRun] },
  { job: 'push-reminders', name: 'Thông báo đẩy: nhắc nhiệm vụ tình nguyện viên', schedule: 'chạy cùng tác vụ đơn hàng (5 phút)', last_run: orderRun, last_failure: null, runs_7d: 2016, failures_7d: 0, recent: [orderRun] },
];
