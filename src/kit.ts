import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getConfig } from "./config";
import { elapsedMs, operationTimeoutMs, withTimeout } from "./diagnostics";

export function createKitClients() {
  const config = getConfig();
  return {
    rpc: createSolanaRpc(config.rpcUrl),
    rpcSubscriptions: createSolanaRpcSubscriptions(config.rpcSubscriptionsUrl),
  };
}

export async function sendInstructions(
  feePayer: TransactionSigner,
  instructions: readonly Instruction[],
): Promise<string> {
  const { rpc, rpcSubscriptions } = createKitClients();
  const timeoutMs = operationTimeoutMs();
  const { value: latestBlockhash } = await withTimeout(
    "SPL getLatestBlockhash RPC",
    rpc.getLatestBlockhash().send(),
    timeoutMs,
  );
  const message = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      latestBlockhash,
      setTransactionMessageFeePayerSigner(
        feePayer,
        createTransactionMessage({ version: 0 }),
      ),
    ),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(transaction);
  const signature = getSignatureFromTransaction(transaction);
  const startedAt = Date.now();
  const wireTransaction = getBase64EncodedWireTransaction(transaction);
  const simulationResponse = await withTimeout(
    `SPL transaction ${signature} simulation`,
    rpc
      .simulateTransaction(wireTransaction, {
        commitment: "confirmed",
        encoding: "base64",
        sigVerify: true,
      })
      .send(),
    timeoutMs,
  );
  const simulation = simulationResponse.value;
  console.log(
    `[sim] SPL transaction: signature=${signature} slot=${simulationResponse.context.slot} ` +
      `result=${simulation.err ? "failed" : "ok"} units=${simulation.unitsConsumed ?? "unknown"} ` +
      `logs=${simulation.logs?.length ?? 0}`,
  );
  if (simulation.err) {
    const programLogs = simulation.logs?.slice(-8).join("\n") ?? "No program logs returned.";
    throw new Error(
      `SPL transaction ${signature} simulation failed: ${String(simulation.err)}\n${programLogs}`,
    );
  }
  console.log(
    `[tx] SPL transaction: signature=${signature} instructions=${instructions.length} ` +
      `confirmation=confirmed status=sending`,
  );
  await withTimeout(
    `SPL transaction ${signature} send and confirmed WebSocket confirmation`,
    sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(transaction, {
      abortSignal: AbortSignal.timeout(timeoutMs),
      commitment: "confirmed",
    }),
    timeoutMs,
  );
  const { value: statuses } = await withTimeout(
    `SPL transaction ${signature} signature status`,
    rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send(),
    timeoutMs,
  );
  const status = statuses[0];
  console.log(
    `[tx] SPL transaction: signature=${signature} slot=${status?.slot ?? "unknown"} ` +
      `confirmation=${status?.confirmationStatus ?? "unknown"} error=${status?.err ? "present" : "none"} ` +
      `elapsed=${elapsedMs(startedAt)}ms`,
  );
  return signature;
}
