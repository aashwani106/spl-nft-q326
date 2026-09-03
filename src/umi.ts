import { mplCore } from "@metaplex-foundation/mpl-core";
import { signerIdentity } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { getConfig } from "./config";
import { loadUmiSigner } from "./wallet";

export function createAssignmentUmi(options: { uploader?: boolean } = {}) {
  const umi = createUmi(getConfig().rpcUrl).use(mplCore());
  const signer = loadUmiSigner(umi);
  umi.use(signerIdentity(signer));
  if (options.uploader) {
    umi.use(irysUploader({ address: "https://devnet.irys.xyz" }));
  }
  return { umi, signer };
}
