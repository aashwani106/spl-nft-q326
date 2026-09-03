import { runCli } from "../cli";
import { requireState, updateState } from "../state";
import { createAssignmentUmi } from "../umi";
import { assertMetadataUri } from "../validation";
import { inferImageContentType } from "./nft_image";
import { elapsedMs, withTimeout } from "../diagnostics";

export type NftMetadata = {
  name: string;
  description: string;
  image: string;
  attributes: Array<{ trait_type: string; value: string }>;
  properties: { files: Array<{ uri: string; type: string }>; category: "image" };
};

export function validateNftMetadata(metadata: NftMetadata): void {
  if (!metadata.name.trim()) throw new Error("NFT metadata name is required.");
  if (!metadata.description.trim()) throw new Error("NFT metadata description is required.");
  assertMetadataUri(metadata.image);
  if (!Array.isArray(metadata.attributes)) throw new Error("NFT metadata attributes must be an array.");
  if (metadata.properties.category !== "image" || metadata.properties.files.length === 0) {
    throw new Error("NFT metadata must include at least one image file.");
  }
  const [file] = metadata.properties.files;
  if (file.uri !== metadata.image || !file.type.startsWith("image/")) {
    throw new Error("NFT metadata image file must match the top-level image URI and MIME type.");
  }
}

export function buildNftMetadata(image = requireState("imageUri")): NftMetadata {
  const metadata: NftMetadata = {
    name: process.env.NFT_NAME ?? "Turbine Core NFT",
    description:
      process.env.NFT_DESCRIPTION ?? "An MPL Core NFT created for the Q3 2026 assignment.",
    image,
    attributes: [
      { trait_type: "Standard", value: "MPL Core" },
      { trait_type: "Network", value: process.env.SOLANA_CLUSTER ?? "devnet" },
    ],
    properties: {
      files: [{ uri: image, type: inferImageContentType(process.env.NFT_IMAGE_PATH ?? "image.jpeg") }],
      category: "image",
    },
  };
  validateNftMetadata(metadata);
  return metadata;
}

export async function uploadNftMetadata(metadata = buildNftMetadata()) {
  validateNftMetadata(metadata);
  const { umi } = createAssignmentUmi({ uploader: true });
  const startedAt = Date.now();
  console.log(`[upload] NFT metadata: name=${metadata.name} image=${metadata.image}`);
  const metadataUri = await withTimeout("NFT metadata upload", umi.uploader.uploadJson(metadata));
  console.log(`[upload] NFT metadata: uri=${metadataUri} elapsed=${elapsedMs(startedAt)}ms`);
  updateState({ metadataUri });
  return metadataUri;
}

async function main() {
  console.log(`Metadata URI: ${await uploadNftMetadata()}`);
}

if (require.main === module) runCli(main);
