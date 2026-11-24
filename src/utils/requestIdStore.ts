import { AsyncLocalStorage } from "node:async_hooks";

interface RequestIdStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestIdStore>();

export const runWithRequestId = <T>(requestId: string, fn: () => T): T => {
  return storage.run({ requestId }, fn);
};

export const getRequestId = (): string | undefined => {
  return storage.getStore()?.requestId;
};
