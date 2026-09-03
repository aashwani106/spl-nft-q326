import { createSolanaRpc } from "@solana/kit";
import { runCli } from "./cli";
import { getConfig, positiveIntegerEnv } from "./config";
import { loadKitSigner } from "./wallet";
import { withRpcDiagnostics } from "./diagnostics";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEFAULT_MINIMUM_DEVNET_BALANCE_LAMPORTS = 50_000_000;

export type DevnetPreflightSummary = {
  walletPath: string;
  address: string;
  balanceLamports: bigint;
  cluster: "devnet";
  rpcUrl: string;
};

function displayRpcUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fractional = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional} SOL` : `${whole} SOL`;
}

export function formatDevnetPreflight(summary: DevnetPreflightSummary): string {
  return [
    `Wallet: ${summary.walletPath}`,
    `Address: ${summary.address}`,
    `Balance: ${formatSol(summary.balanceLamports)}`,
    `Cluster: ${summary.cluster}`,
    `RPC: ${displayRpcUrl(summary.rpcUrl)}`,
  ].join("\n");
}

export async function validateDevnetEnvironment(): Promise<DevnetPreflightSummary> {
  const config = getConfig();
  if (config.cluster !== "devnet") {
    throw new Error(
      `SOLANA_CLUSTER must be devnet for this lifecycle; received ${config.cluster}.`,
    );
  }

  const signer = await loadKitSigner();
  const rpc = createSolanaRpc(config.rpcUrl);
  let genesisHash: string;
  let balanceLamports: bigint;
  try {
    const [genesis, balance] = await Promise.all([
      withRpcDiagnostics("Devnet genesis hash", rpc.getGenesisHash().send()),
      withRpcDiagnostics(
        "Devnet wallet balance",
        rpc.getBalance(signer.address, { commitment: "confirmed" }).send(),
      ),
    ]);
    genesisHash = genesis;
    balanceLamports = balance.value;
  } catch (error) {
    throw new Error(
      `RPC is unreachable or rejected the preflight request at ${displayRpcUrl(config.rpcUrl)}. ` +
        `Verify SOLANA_RPC_URL and network access. Cause: ${String(error)}`,
    );
  }

  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `RPC is not Solana devnet. Expected genesis hash ${DEVNET_GENESIS_HASH}, received ${genesisHash}.`,
    );
  }

  const minimumLamports = BigInt(
    positiveIntegerEnv(
      "MIN_DEVNET_BALANCE_LAMPORTS",
      DEFAULT_MINIMUM_DEVNET_BALANCE_LAMPORTS,
    ),
  );
  if (balanceLamports <= minimumLamports) {
    throw new Error(
      `Wallet balance ${formatSol(balanceLamports)} must be greater than ${formatSol(minimumLamports)}. ` +
        `Fund it with: solana airdrop 2 ${signer.address} --url devnet`,
    );
  }

  return {
    walletPath: config.walletPath,
    address: signer.address,
    balanceLamports,
    cluster: "devnet",
    rpcUrl: config.rpcUrl,
  };
}

async function main() {
  console.log(formatDevnetPreflight(await validateDevnetEnvironment()));
}

if (require.main === module) runCli(main);
