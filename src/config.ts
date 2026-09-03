import "dotenv/config";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const SOLANA_CLI_WALLET_PATH = "~/.config/solana/id.json";

export function resolveUserPath(
  path: string,
  cwd = process.cwd(),
  home = homedir(),
): string {
  const trimmed = path.trim();
  const expanded =
    trimmed === "~" ? home : trimmed.startsWith("~/") ? join(home, trimmed.slice(2)) : trimmed;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export function resolveWalletPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = homedir(),
): string {
  return resolveUserPath(env.WALLET_PATH?.trim() || SOLANA_CLI_WALLET_PATH, cwd, home);
}

export type AppConfig = {
  rpcUrl: string;
  rpcSubscriptionsUrl: string;
  cluster: string;
  walletPath: string;
  statePath: string;
};

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rpcUrl = env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const cluster = env.SOLANA_CLUSTER ?? "devnet";

  if (cluster === "mainnet-beta" && env.ALLOW_MAINNET !== "true") {
    throw new Error("Mainnet is disabled. Set ALLOW_MAINNET=true only after reviewing every transaction.");
  }

  return {
    rpcUrl,
    rpcSubscriptionsUrl:
      env.SOLANA_RPC_WSS ??
      (rpcUrl.startsWith("https://")
        ? rpcUrl.replace(/^https:\/\//, "wss://")
        : rpcUrl.replace(/^http:\/\//, "ws://")),
    cluster,
    walletPath: resolveWalletPath(env),
    statePath: resolve(env.STATE_PATH ?? ".assignment-state.json"),
  };
}

export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for this command.`);
  return value;
}

export function positiveIntegerEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return value;
}
