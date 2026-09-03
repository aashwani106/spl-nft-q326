import type { TransactionBuilder } from "@metaplex-foundation/umi";
import type {
  Commitment,
  Context,
  PublicKey,
  RpcGetAccountOptions,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { fetchAsset, type AssetV1 } from "@metaplex-foundation/mpl-core";
import { elapsedMs, withTimeout } from "./diagnostics";

function resolveInstructionError(
  umi: Pick<Context, "programs">,
  transaction: Awaited<ReturnType<TransactionBuilder["buildAndSign"]>>,
  error: unknown,
  cause: Error,
) {
  if (!error || typeof error !== "object" || !("InstructionError" in error)) return null;
  const instructionError = (error as { InstructionError?: unknown }).InstructionError;
  if (!Array.isArray(instructionError) || instructionError.length !== 2) return null;
  const [instructionIndex, detail] = instructionError;
  if (
    typeof instructionIndex !== "number" ||
    !detail ||
    typeof detail !== "object" ||
    !("Custom" in detail) ||
    typeof (detail as { Custom?: unknown }).Custom !== "number"
  ) {
    return null;
  }
  const instruction = transaction.message.instructions[instructionIndex];
  const programId = instruction && transaction.message.accounts[instruction.programIndex];
  if (!programId || !umi.programs.has(programId)) return null;
  return umi.programs
    .get(programId)
    .getErrorFromCode((detail as { Custom: number }).Custom, cause);
}

export async function sendAndConfirmUmi(
  label: string,
  builder: TransactionBuilder,
  umi: Pick<Context, "transactions" | "rpc" | "payer" | "programs">,
  commitment: Commitment,
) {
  const startedAt = Date.now();
  console.log(`[tx] ${label}: preparing transaction`);
  const preparedBuilder = builder.getBlockhash()
    ? builder
    : await withTimeout(
        `${label} latest blockhash`,
        builder.setLatestBlockhash(umi, { commitment }),
      );
  const transaction = await withTimeout(
    `${label} build and sign transaction`,
    preparedBuilder.buildAndSign(umi),
  );
  const simulation = await withTimeout(
    `${label} simulate transaction`,
    umi.rpc.simulateTransaction(transaction, {
      commitment,
      verifySignatures: true,
    }),
  );
  console.log(
    `[sim] ${label}: result=${simulation.err ? "failed" : "ok"} ` +
      `units=${simulation.unitsConsumed ?? "unknown"} logs=${simulation.logs?.length ?? 0}`,
  );
  if (simulation.err) {
    const programLogs = simulation.logs?.slice(-8).join("\n") ?? "No program logs returned.";
    const simulationError = Object.assign(
      new Error(`${label} simulation failed: ${String(simulation.err)}\n${programLogs}`),
      { logs: simulation.logs ?? [] },
    );
    console.log(`[sim] ${label}: error=${JSON.stringify(simulation.err)}\n${programLogs}`);
    throw (
      umi.programs.resolveError(simulationError, transaction) ??
      resolveInstructionError(umi, transaction, simulation.err, simulationError) ??
      simulationError
    );
  }
  const signatureBytes = await withTimeout(
    `${label} send transaction`,
    umi.rpc.sendTransaction(transaction, {
      commitment,
      preflightCommitment: commitment,
    }),
  );
  const signature = base58.deserialize(signatureBytes)[0];
  console.log(
    `[tx] ${label}: signature=${signature} status=submitted; awaiting ${commitment} confirmation`,
  );
  const result = await withTimeout(
    `${label} ${commitment} confirmation for ${signature}`,
    preparedBuilder.confirm(umi, signatureBytes, { commitment }),
  );
  const [status] = await withTimeout(
    `${label} signature status`,
    umi.rpc.getSignatureStatuses([signatureBytes], {
      commitment,
      searchTransactionHistory: true,
    }),
  );
  console.log(
    `[tx] ${label}: signature=${signature} slot=${status?.slot ?? result.context.slot} ` +
      `confirmation=${status?.commitment ?? commitment} error=${status?.error ? "present" : "none"} ` +
      `elapsed=${elapsedMs(startedAt)}ms`,
  );
  return { signature: signatureBytes, result };
}

export async function fetchAssetWithDiagnostics(
  label: string,
  umi: Context,
  assetAddress: PublicKey,
  options: RpcGetAccountOptions = {},
): Promise<AssetV1> {
  const startedAt = Date.now();
  console.log(`[rpc] ${label}: fetchAsset address=${assetAddress}`);
  const asset = await withTimeout(
    `${label} fetchAsset`,
    fetchAsset(umi, assetAddress, options),
  );
  console.log(
    `[rpc] ${label}: fetchAsset complete address=${asset.publicKey} elapsed=${elapsedMs(startedAt)}ms`,
  );
  return asset;
}

export async function getAccountWithDiagnostics(
  label: string,
  umi: Pick<Context, "rpc">,
  address: PublicKey,
  options: RpcGetAccountOptions = {},
) {
  const startedAt = Date.now();
  console.log(`[rpc] ${label}: getAccount address=${address}`);
  const account = await withTimeout(
    `${label} getAccount`,
    umi.rpc.getAccount(address, options),
  );
  console.log(
    `[rpc] ${label}: getAccount complete address=${address} exists=${account.exists} ` +
      `elapsed=${elapsedMs(startedAt)}ms`,
  );
  return account;
}
