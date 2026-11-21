import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = fileURLToPath(new URL("../", import.meta.url));
const distEntry = path.join(backendRoot, "dist", "server.js");
if (!existsSync(distEntry)) {
  console.error("Chưa có dist/server.js. Chạy npm run build trong VC_FOOODSAVE trước.");
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [distEntry], {
    cwd: backendRoot,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      PORT: process.env.PORT ?? "8082",
      LABEL_AUTOMATION_INTERVAL_MS: process.env.LABEL_AUTOMATION_INTERVAL_MS ?? "0",
      CORS_ORIGINS: [...new Set([...(process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean), "http://127.0.0.1:5500", "http://localhost:5500"])].join(","),
      SOCKET_CORS_ORIGINS: [...new Set([...(process.env.SOCKET_CORS_ORIGINS ?? "").split(",").filter(Boolean), "http://127.0.0.1:5500", "http://localhost:5500"])].join(","),
    },
  });
  let stopping = false;
  let failureCode = 0;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  };
  const onSigint = () => stop("SIGINT");
  const onSigterm = () => stop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.exitCode = failureCode || code || (signal ? 1 : 0);
  });
  child.once("error", () => {
    console.error("Không khởi động được MIO API.");
    failureCode = 1;
  });
}
