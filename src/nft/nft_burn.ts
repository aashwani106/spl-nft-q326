import { burn, MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";
import {
  AccountNotFoundError,
  publicKey,
  type Context,
  type PublicKey,
  UnexpectedAccountError,
} from "@metaplex-foundation/umi";
import {
  base58,
  DeserializingEmptyBufferError,
  NotEnoughBytesError,
} from "@metaplex-foundation/umi/serializers";
import { runCli } from "../cli";
import { recordTransaction, requireState } from "../state";
import { createAssignmentUmi } from "../umi";
import { withTimeout } from "../diagnostics";
import {
  fetchAssetWithDiagnostics,
  getAccountWithDiagnostics,
  sendAndConfirmUmi,
} from "../umi-diagnostics";
import { assertAssetOwner } from "../validation";

export type BurnVerification = {
  fetchFailed: true;
  ownerRemoved: true;
  accountState: "missing" | "core-tombstone";
  retainedLamports: bigint;
};

export function isCoreTombstoneDeserializationError(error: unknown): boolean {
  const cause = error instanceof UnexpectedAccountError ? error.cause : error;
  return cause instanceof DeserializingEmptyBufferError || cause instanceof NotEnoughBytesError;
}

/**
 * A burned Core asset is no longer deserializable. Current Core behavior keeps
 * a program-owned account with rent, but truncates its data to one zero byte.
 * A fully absent account is also accepted for RPC/runtime compatibility.
 */
export async function verifyCoreAssetBurned(
  umi: Pick<Context, "rpc" | "programs">,
  assetAddress: PublicKey,
): Promise<BurnVerification> {
  let fetchError: unknown;
  try {
    await fetchAssetWithDiagnostics(
      "Verify burned MPL Core asset is not deserializable",
      umi as Context,
      assetAddress,
      { commitment: "finalized" },
    );
  } catch (error) {
    fetchError = error;
  }

  if (!fetchError) {
    throw new Error("Burn verification failed: fetchAsset still returned an active asset.");
  }

  const rawAccount = await getAccountWithDiagnostics(
    "Inspect burned MPL Core tombstone",
    umi,
    assetAddress,
    { commitment: "finalized" },
  );
  if (!rawAccount.exists) {
    if (!(fetchError instanceof AccountNotFoundError)) throw fetchError;
    return {
      fetchFailed: true,
      ownerRemoved: true,
      accountState: "missing",
      retainedLamports: 0n,
    };
  }

  if (rawAccount.owner.toString() !== MPL_CORE_PROGRAM_ID.toString()) {
    throw new Error(
      `Burn verification failed: tombstone owner is ${rawAccount.owner}, expected MPL Core.`,
    );
  }
  if (rawAccount.data.length !== 1 || rawAccount.data[0] !== 0) {
    throw new Error(
      `Burn verification failed: expected one zero tombstone byte, received ${rawAccount.data.length} bytes.`,
    );
  }
  if (rawAccount.lamports.basisPoints <= 0n) {
    throw new Error("Burn verification failed: Core tombstone retained no lamports.");
  }
  if (!isCoreTombstoneDeserializationError(fetchError)) throw fetchError;

  return {
    fetchFailed: true,
    ownerRemoved: true,
    accountState: "core-tombstone",
    retainedLamports: rawAccount.lamports.basisPoints,
  };
}

export async function burnCoreNft(context = createAssignmentUmi()) {
  const { umi, signer } = context;
  const assetAddress = publicKey(requireState("asset"));
  const asset = await fetchAssetWithDiagnostics(
    "Fetch MPL Core asset before burn",
    umi,
    assetAddress,
    { commitment: "finalized" },
  );
  assertAssetOwner(asset, signer.publicKey.toString());
  const result = await sendAndConfirmUmi(
    "Burn MPL Core asset",
    burn(umi, { asset, authority: signer }),
    umi,
    "finalized",
  );
  const [status] = await withTimeout(
    "Burn MPL Core asset final signature status",
    umi.rpc.getSignatureStatuses([result.signature], {
      commitment: "finalized",
      searchTransactionHistory: true,
    }),
  );
  if (!status || status.error || status.commitment !== "finalized") {
    throw new Error("Burn verification failed: transaction is not finalized successfully.");
  }
  const verification = await verifyCoreAssetBurned(umi, assetAddress);
  const signature = base58.deserialize(result.signature)[0];
  recordTransaction("nftBurn", signature);
  return { asset: assetAddress, signature, transactionFinalized: true as const, verification };
}

async function main() {
  const result = await burnCoreNft();
  console.log(`Burned asset: ${result.asset}`);
  console.log(`Burn NFT transaction: ${result.signature}`);
}

if (require.main === module) runCli(main);
