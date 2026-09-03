import { create } from "@metaplex-foundation/mpl-core";
import { generateSigner } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { runCli } from "../cli";
import { recordTransaction, requireState, updateState } from "../state";
import { createAssignmentUmi } from "../umi";
import { fetchAssetWithDiagnostics, sendAndConfirmUmi } from "../umi-diagnostics";
import {
  assertAssetMetadata,
  assertAssetOwner,
  assertAssetUpdateAuthority,
  assertMetadataUri,
} from "../validation";

export async function mintCoreNft(context = createAssignmentUmi()) {
  const { umi, signer } = context;
  const assetSigner = generateSigner(umi);
  const name = process.env.NFT_NAME ?? "Turbine Core NFT";
  const uri = process.env.NFT_METADATA_URI?.trim() || requireState("metadataUri");
  assertMetadataUri(uri);
  const result = await sendAndConfirmUmi(
    "Create MPL Core asset",
    create(umi, {
      asset: assetSigner,
      owner: signer.publicKey,
      updateAuthority: signer.publicKey,
      name,
      uri,
    }),
    umi,
    "finalized",
  );
  const asset = await fetchAssetWithDiagnostics(
    "Verify created MPL Core asset",
    umi,
    assetSigner.publicKey,
    { commitment: "finalized" },
  );
  assertAssetMetadata(asset, name, uri);
  assertAssetOwner(asset, signer.publicKey.toString());
  assertAssetUpdateAuthority(asset, signer.publicKey.toString());
  const signature = base58.deserialize(result.signature)[0];
  updateState({ asset: assetSigner.publicKey, assetOwner: signer.publicKey });
  recordTransaction("nftCreate", signature);
  return { asset, signature };
}

async function main() {
  const result = await mintCoreNft();
  console.log(`Asset address: ${result.asset.publicKey}`);
  console.log(`Create NFT transaction: ${result.signature}`);
}

if (require.main === module) runCli(main);
