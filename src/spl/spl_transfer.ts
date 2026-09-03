import { address } from "@solana/kit";
import {
  fetchMaybeToken,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { runCli } from "../cli";
import { positiveIntegerEnv, requiredEnv } from "../config";
import { createKitClients, sendInstructions } from "../kit";
import { withRpcDiagnostics, withTimeout } from "../diagnostics";
import { recordTransaction, requireState } from "../state";
import { assertBigIntEqual, toBaseUnits } from "../validation";
import { loadKitSigner } from "../wallet";

export async function transferSplTokens(recipient = requiredEnv("SPL_RECIPIENT")) {
  const signer = await loadKitSigner();
  const mint = address(requireState("splMint"));
  const to = address(recipient);
  const decimals = positiveIntegerEnv("SPL_DECIMALS", 6);
  const amount = toBaseUnits(positiveIntegerEnv("SPL_TRANSFER_AMOUNT", 100), decimals);
  const [source] = await withTimeout(
    "Derive source associated token account",
    findAssociatedTokenPda({
      mint,
      owner: signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
  );
  const [destination] = await withTimeout(
    "Derive destination associated token account",
    findAssociatedTokenPda({ mint, owner: to, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
  );
  const { rpc } = createKitClients();
  const sourceBefore = (
    await withRpcDiagnostics(
      "Fetch source ATA before transfer",
      fetchToken(rpc, source, { commitment: "confirmed" }),
    )
  ).data.amount;
  const existingDestination = await withRpcDiagnostics(
    "Fetch destination ATA before transfer",
    fetchMaybeToken(rpc, destination, { commitment: "confirmed" }),
  );
  const destinationBefore = existingDestination.exists ? existingDestination.data.amount : 0n;
  const signature = await sendInstructions(signer, [
    await withTimeout(
      "Build idempotent destination ATA instruction",
      getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: signer,
        ata: destination,
        owner: to,
        mint,
      }),
    ),
    getTransferCheckedInstruction({ source, mint, destination, authority: signer, amount, decimals }),
  ]);
  const [sourceAfter, destinationAfter] = await Promise.all([
    withRpcDiagnostics("Verify source ATA after transfer", fetchToken(rpc, source, { commitment: "confirmed" })),
    withRpcDiagnostics("Verify destination ATA after transfer", fetchToken(rpc, destination, { commitment: "confirmed" })),
  ]);
  assertBigIntEqual(sourceAfter.data.amount, sourceBefore - amount, "Sender balance");
  assertBigIntEqual(destinationAfter.data.amount, destinationBefore + amount, "Recipient balance");
  recordTransaction("splTransfer", signature);
  return { source, destination, amount, signature };
}

async function main() {
  const result = await transferSplTokens();
  console.log(`Source ATA: ${result.source}`);
  console.log(`Recipient ATA: ${result.destination}`);
  console.log(`Transferred base units: ${result.amount}`);
  console.log(`Transfer transaction: ${result.signature}`);
}

if (require.main === module) runCli(main);
