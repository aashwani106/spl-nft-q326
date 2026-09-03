import { update } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { runCli } from "../cli";
import { recordTransaction, requireState } from "../state";
import { createAssignmentUmi } from "../umi";
import { fetchAssetWithDiagnostics, sendAndConfirmUmi } from "../umi-diagnostics";
import {
  assertAssetAddress,
  assertAssetMetadata,
  assertAssetOwner,
  assertAssetUpdateAuthority,
  assertMetadataUri,
} from "../validation";

export async function updateCoreNft(context = createAssignmentUmi()) {
  const { umi, signer } = context;
  const assetAddress = publicKey(requireState("asset"));
  const current = await fetchAssetWithDiagnostics(
    "Fetch MPL Core asset before update",
    umi,
    assetAddress,
    { commitment: "finalized" },
  );
  assertAssetUpdateAuthority(current, signer.publicKey.toString());
  const name = process.env.NFT_UPDATED_NAME ?? `${current.name} Updated`;
  const uri = process.env.NFT_UPDATED_URI?.trim();
  if (!uri) throw new Error("NFT_UPDATED_URI is required and must differ from the current URI.");
  assertMetadataUri(uri);
  if (name === current.name || uri === current.uri) {
    throw new Error("NFT update must change both the asset name and metadata URI.");
  }
  const result = await sendAndConfirmUmi(
    "Update MPL Core asset",
    update(umi, { asset: current, name, uri }),
    umi,
    "finalized",
  );
  const updated = await fetchAssetWithDiagnostics(
    "Verify updated MPL Core asset",
    umi,
    assetAddress,
    { commitment: "finalized" },
  );
  assertAssetAddress(updated, current.publicKey.toString());
  assertAssetOwner(updated, current.owner.toString());
  assertAssetUpdateAuthority(updated, signer.publicKey.toString());
  assertAssetMetadata(updated, name, uri);
  const signature = base58.deserialize(result.signature)[0];
  recordTransaction("nftUpdate", signature);
  return { asset: updated, signature };
}

async function main() {
  const result = await updateCoreNft();
  console.log(`Updated asset: ${result.asset.publicKey}`);
  console.log(`Update NFT transaction: ${result.signature}`);
}

if (require.main === module) runCli(main);
