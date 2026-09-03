import { generateKeyPairSigner, isSome } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import { fetchMint, getInitializeMintInstruction, getMintSize, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { runCli } from "../cli";
import { positiveIntegerEnv } from "../config";
import { createKitClients, sendInstructions } from "../kit";
import { withRpcDiagnostics } from "../diagnostics";
import { recordTransaction, updateState } from "../state";
import { loadKitSigner } from "../wallet";

export async function createSplMint(): Promise<{ mint: string; signature: string }> {
  const payer = await loadKitSigner();
  const mint = await generateKeyPairSigner();
  const decimals = positiveIntegerEnv("SPL_DECIMALS", 6);
  if (decimals > 18) throw new Error("SPL_DECIMALS cannot exceed 18.");
  const { rpc } = createKitClients();
  const space = getMintSize();
  const lamports = await withRpcDiagnostics(
    "SPL mint rent exemption",
    rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
  );
  const signature = await sendInstructions(payer, [
    getCreateAccountInstruction({
      payer,
      newAccount: mint,
      lamports,
      space: BigInt(space),
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals,
      mintAuthority: payer.address,
      freezeAuthority: payer.address,
    }),
  ]);
  const account = await withRpcDiagnostics(
    "Verify created SPL mint",
    fetchMint(rpc, mint.address, { commitment: "confirmed" }),
  );
  if (
    !account.data.isInitialized ||
    account.data.decimals !== decimals ||
    !isSome(account.data.mintAuthority) ||
    account.data.mintAuthority.value !== payer.address ||
    !isSome(account.data.freezeAuthority) ||
    account.data.freezeAuthority.value !== payer.address
  ) {
    throw new Error("Mint account verification failed after confirmation.");
  }
  updateState({ splMint: mint.address, splMintTransaction: signature });
  recordTransaction("splCreateMint", signature);
  return { mint: mint.address, signature };
}

async function main() {
  const result = await createSplMint();
  console.log(`Mint address: ${result.mint}`);
  console.log(`Create mint transaction: ${result.signature}`);
}

if (require.main === module) runCli(main);
