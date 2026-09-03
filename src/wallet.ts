import { existsSync, readFileSync, statSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { createSignerFromKeypair, type Signer, type Umi } from "@metaplex-foundation/umi";
import { getConfig, resolveUserPath } from "./config";

function walletRemediation(path: string): string {
  return [
    `Resolved wallet path: ${path}`,
    "Set WALLET_PATH to an existing Solana JSON keypair, or create the CLI default wallet:",
    "solana-keygen new --no-bip39-passphrase --outfile ~/.config/solana/id.json",
    "Then fund it on devnet:",
    "solana airdrop 2 $(solana address -k ~/.config/solana/id.json) --url devnet",
  ].join("\n");
}

export function readWalletBytes(path = getConfig().walletPath): Uint8Array {
  const resolvedPath = resolveUserPath(path);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Wallet file does not exist.\n${walletRemediation(resolvedPath)}`);
  }
  if (!statSync(resolvedPath).isFile()) {
    throw new Error(`Wallet path is not a file.\n${walletRemediation(resolvedPath)}`);
  }

  let contents: string;
  try {
    contents = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read wallet file.\n${walletRemediation(resolvedPath)}\nCause: ${String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Wallet is not valid JSON.\n${walletRemediation(resolvedPath)}\nCause: ${String(error)}`,
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    parsed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error(
      `Wallet must be a JSON array containing exactly 64 integer byte values from 0 to 255.\n${walletRemediation(resolvedPath)}`,
    );
  }
  return Uint8Array.from(parsed);
}

export function loadKitSigner() {
  return createKeyPairSignerFromBytes(readWalletBytes());
}

export function loadUmiSigner(umi: Umi): Signer {
  const keypair = umi.eddsa.createKeypairFromSecretKey(readWalletBytes());
  return createSignerFromKeypair(umi, keypair);
}
