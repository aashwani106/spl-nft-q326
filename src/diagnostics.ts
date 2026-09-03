export const DEFAULT_OPERATION_TIMEOUT_MS = 60_000;
export const DEFAULT_SLOW_OPERATION_MS = 20_000;

export function operationTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.RPC_TIMEOUT_MS ?? DEFAULT_OPERATION_TIMEOUT_MS);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("RPC_TIMEOUT_MS must be a positive integer number of milliseconds.");
  }
  return value;
}

export async function withTimeout<T>(
  label: string,
  operation: Promise<T>,
  timeoutMs = operationTimeoutMs(),
): Promise<T> {
  const startedAt = Date.now();
  const slowAfterMs = Math.min(DEFAULT_SLOW_OPERATION_MS, Math.max(1, timeoutMs - 1));
  const slowTimer = setTimeout(() => {
    console.warn(
      `[wait] ${label} is still pending after ${Date.now() - startedAt}ms; timeout=${timeoutMs}ms`,
    );
  }, slowAfterMs);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(slowTimer);
    if (timeout) clearTimeout(timeout);
  }
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export async function withRpcDiagnostics<T>(label: string, operation: Promise<T>): Promise<T> {
  const startedAt = Date.now();
  console.log(`[rpc] ${label}: started`);
  const result = await withTimeout(`${label} RPC`, operation);
  console.log(`[rpc] ${label}: complete elapsed=${elapsedMs(startedAt)}ms`);
  return result;
}
