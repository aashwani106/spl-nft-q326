import { address } from "@solana/kit";
import { fetchMaybeToken, fetchMint, fetchToken, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync, getMintToCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { runCli } from "../cli";
import { positiveIntegerEnv } from "../config";
import { createKitClients, sendInstructions } from "../kit";
import { withRpcDiagnostics, withTimeout } from "../diagnostics";
import { recordTransaction, requireState, updateState } from "../state";
import { assertBigIntEqual, toBaseUnits } from "../validation";
import { loadKitSigner } from "../wallet";

export async function mintSplSupply() {
  const signer = await loadKitSigner();
  const mint = address(requireState("splMint"));
  const decimals = positiveIntegerEnv("SPL_DECIMALS", 6);
  const amount = toBaseUnits(positiveIntegerEnv("SPL_MINT_AMOUNT", 1_000_000), decimals);
  const [ata] = await withTimeout(
    "Derive owner associated token account",
    findAssociatedTokenPda({ mint, owner: signer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
  );
  const { rpc } = createKitClients();
  const [mintBefore, tokenBefore] = await Promise.all([
    withRpcDiagnostics("Fetch SPL mint before minting", fetchMint(rpc, mint, { commitment: "confirmed" })),
    withRpcDiagnostics("Fetch owner ATA before minting", fetchMaybeToken(rpc, ata, { commitment: "confirmed" })),
  ]);
  if (mintBefore.data.decimals !== decimals) {
    throw new Error(
      `Configured decimals ${decimals} do not match on-chain decimals ${mintBefore.data.decimals}.`,
    );
  }
  if (mintBefore.data.supply !== 0n || (tokenBefore.exists && tokenBefore.data.amount !== 0n)) {
    throw new Error("Mint supply already exists; refusing to mint the configured initial supply twice.");
  }
  const signature = await sendInstructions(signer, [
    await withTimeout(
      "Build idempotent owner ATA instruction",
      getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, ata, owner: signer.address, mint }),
    ),
    getMintToCheckedInstruction({ mint, token: ata, mintAuthority: signer, amount, decimals }),
  ]);
  const [mintAccount, tokenAccount] = await Promise.all([
    withRpcDiagnostics("Verify SPL mint supply", fetchMint(rpc, mint, { commitment: "confirmed" })),
    withRpcDiagnostics("Verify owner ATA balance", fetchToken(rpc, ata, { commitment: "confirmed" })),
  ]);
  assertBigIntEqual(tokenAccount.data.amount, amount, "Owner ATA balance");
  assertBigIntEqual(mintAccount.data.supply, amount, "Mint supply");
  updateState({ splOwnerAta: ata });
  recordTransaction("splMintSupply", signature);
  return { ata, amount, signature };
}

async function main() {
  const result = await mintSplSupply();
  console.log(`Owner ATA: ${result.ata}`);
  console.log(`Minted base units: ${result.amount}`);
  console.log(`Mint supply transaction: ${result.signature}`);
}

if (require.main === module) runCli(main);
