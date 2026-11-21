import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = fileURLToPath(new URL("../", import.meta.url));
const api = spawn(process.execPath, [path.join(backendRoot, "dist", "server.js")], {
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
const preview = spawn(process.execPath, [path.join(backendRoot, "scripts", "dev.mjs"), "--api-origin", `http://127.0.0.1:${process.env.PORT ?? "8082"}`], {
  cwd: backendRoot,
  stdio: "inherit",
  windowsHide: true,
});
let stopping = false;
let failureCode = 0;
let receivedSignal = false;
let exited = 0;
const children = [api, preview];
const finished = new Set();
const stop = (signal) => {
  if (!stopping) {
    stopping = true;
    for (const child of children) {
      if (!finished.has(child)) child.kill(signal);
    }
  }
};
const onSigint = () => {
  receivedSignal = true;
  stop("SIGINT");
};
const onSigterm = () => {
  receivedSignal = true;
  stop("SIGTERM");
};
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

const complete = (child, code, signal) => {
  if (finished.has(child)) return;
  finished.add(child);
  exited += 1;
  if (code !== 0 && code !== null) failureCode = code;
  else if (signal && !receivedSignal) failureCode ||= 1;
  if (!stopping && !receivedSignal) {
    failureCode ||= 1;
    stop("SIGTERM");
  }
  if (exited === children.length) {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.exitCode = failureCode;
  }
};

for (const child of children) {
  child.once("error", () => {
    console.error("Không khởi động được tiến trình MIO.");
    failureCode = 1;
    complete(child, 1, null);
    stop("SIGTERM");
  });
  child.once("exit", (code, signal) => {
    complete(child, code, signal);
  });
}
