import { createMetadataAccountV3, mplTokenMetadata, type DataV2Args } from "@metaplex-foundation/mpl-token-metadata";
import { publicKey } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { runCli } from "../cli";
import { requiredEnv } from "../config";
import { recordTransaction, requireState } from "../state";
import { createAssignmentUmi } from "../umi";
import { sendAndConfirmUmi } from "../umi-diagnostics";

export async function createSplMetadata(): Promise<string> {
  const { umi, signer } = createAssignmentUmi();
  umi.use(mplTokenMetadata());
  const data: DataV2Args = {
    name: process.env.SPL_TOKEN_NAME ?? "Turbine Token",
    symbol: process.env.SPL_TOKEN_SYMBOL ?? "TURB",
    uri: requiredEnv("SPL_TOKEN_URI"),
    sellerFeeBasisPoints: 0,
    creators: null,
    collection: null,
    uses: null,
  };
  const result = await sendAndConfirmUmi(
    "Create SPL token metadata",
    createMetadataAccountV3(umi, {
      mint: publicKey(requireState("splMint")),
      mintAuthority: signer,
      payer: signer,
      updateAuthority: signer.publicKey,
      data,
      isMutable: true,
      collectionDetails: null,
    }),
    umi,
    "confirmed",
  );
  const signature = base58.deserialize(result.signature)[0];
  recordTransaction("splCreateMetadata", signature);
  return signature;
}

async function main() {
  console.log(`Create metadata transaction: ${await createSplMetadata()}`);
}

if (require.main === module) runCli(main);
