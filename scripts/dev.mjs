import { fileURLToPath } from 'node:url';
import { createPreviewServer } from './lib/dev-server.mjs';

const HELP = `MIO — chạy giao diện tại máy, không cần cài thêm thư viện.

Cách dùng:
  node scripts/dev.mjs
  node scripts/dev.mjs --port 5501
  node scripts/dev.mjs --api-origin http://127.0.0.1:8080

Tuỳ chọn:
  --port <cổng>         Cổng HTTP (mặc định: 5500).
  --api-origin <URL>    Chuyển tiếp /api/v1 tới backend đang chạy.
  --help               Hiện hướng dẫn.

Máy chủ chỉ lắng nghe trên 127.0.0.1 và chỉ phục vụ thư mục public/.
`;

function parseArguments(args) {
  const options = { port: 5500 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument !== '--port' && argument !== '--api-origin') {
      throw new Error('Tuỳ chọn không hợp lệ. Dùng --help để xem hướng dẫn.');
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('Tuỳ chọn thiếu giá trị.');
    if (argument === '--port') {
      if (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > 65535) {
        throw new Error('Cổng phải là số từ 1 đến 65535.');
      }
      options.port = Number(value);
    } else options.apiOrigin = value;
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
  } else {
    const server = createPreviewServer({
      publicDirectory: fileURLToPath(new URL('../public/', import.meta.url)),
      apiOrigin: options.apiOrigin,
    });
    server.on('error', (error) => {
      console.error(error.code === 'EADDRINUSE'
        ? 'Cổng đang được sử dụng. Chạy lại với --port 5501 hoặc một cổng trống khác.'
        : 'Không khởi động được máy chủ preview. Kiểm tra cổng và thử lại.');
      process.exitCode = 1;
    });
    server.listen(options.port, '127.0.0.1', () => {
      console.log(`MIO: http://127.0.0.1:${options.port}`);
      console.log(options.apiOrigin
        ? 'API proxy đã bật cho /api/v1.'
        : 'Đang xem giao diện. Dùng --help để xem cách kết nối backend.');
      console.log('Nhấn Ctrl+C để dừng.');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        server.close(() => { process.exitCode = 0; });
        server.closeIdleConnections();
      });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
