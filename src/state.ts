import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { getConfig } from "./config";

export type AssignmentState = {
  splMint?: string;
  splMintTransaction?: string;
  splOwnerAta?: string;
  imageUri?: string;
  metadataUri?: string;
  asset?: string;
  assetOwner?: string;
  transactions?: Record<string, string>;
};

export function readState(path = getConfig().statePath): AssignmentState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("state must be a JSON object");
    }
    return parsed as AssignmentState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Unable to read assignment state at ${path}: ${String(error)}`);
  }
}

export function updateState(
  update: Partial<AssignmentState>,
  path = getConfig().statePath,
): AssignmentState {
  const next = { ...readState(path), ...update };
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
  return next;
}

export function requireState<K extends keyof AssignmentState>(
  key: K,
  path = getConfig().statePath,
): NonNullable<AssignmentState[K]> {
  const value = readState(path)[key];
  if (value === undefined || value === "") {
    throw new Error(`State value \"${key}\" is missing. Run the preceding command first.`);
  }
  return value as NonNullable<AssignmentState[K]>;
}

export function recordTransaction(name: string, signature: string): void {
  const state = readState();
  updateState({ transactions: { ...state.transactions, [name]: signature } });
}
