import { transfer } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { runCli } from "../cli";
import { requiredEnv } from "../config";
import { recordTransaction, requireState, updateState } from "../state";
import { createAssignmentUmi } from "../umi";
import { fetchAssetWithDiagnostics, sendAndConfirmUmi } from "../umi-diagnostics";
import { assertAssetOwner } from "../validation";

export async function transferCoreNft(
  recipient = requiredEnv("NFT_RECIPIENT"),
  context = createAssignmentUmi(),
) {
  const { umi, signer } = context;
  const assetAddress = publicKey(requireState("asset"));
  const asset = await fetchAssetWithDiagnostics(
    "Fetch MPL Core asset before transfer",
    umi,
    assetAddress,
    { commitment: "finalized" },
  );
  assertAssetOwner(asset, signer.publicKey.toString());
  const newOwner = publicKey(recipient);
  const result = await sendAndConfirmUmi(
    "Transfer MPL Core asset",
    transfer(umi, { asset, newOwner }),
    umi,
    "finalized",
  );
  const transferred = await fetchAssetWithDiagnostics(
    "Verify transferred MPL Core asset",
    umi,
    assetAddress,
    { commitment: "finalized" },
  );
  assertAssetOwner(transferred, newOwner.toString());
  const signature = base58.deserialize(result.signature)[0];
  updateState({ assetOwner: newOwner });
  recordTransaction("nftTransfer", signature);
  return { asset: transferred, signature };
}

async function main() {
  const result = await transferCoreNft();
  console.log(`New owner: ${result.asset.owner}`);
  console.log(`Transfer NFT transaction: ${result.signature}`);
}

if (require.main === module) runCli(main);
