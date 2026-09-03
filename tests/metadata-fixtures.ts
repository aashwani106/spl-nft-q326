import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type NftMetadata, validateNftMetadata } from "../src/nft/nft_metadata";

export const METADATA_FIXTURE_BASE_URL =
  "https://raw.githubusercontent.com/aashwani106/spl-nft-q326/main/tests/fixtures/";

export type MetadataFixtureName = "core-metadata.json" | "core-metadata-updated.json";

export function loadMetadataFixture(
  filename: MetadataFixtureName,
): { metadata: NftMetadata; uri: string } {
  const path = join(__dirname, "fixtures", filename);
  const metadata = JSON.parse(readFileSync(path, "utf8")) as NftMetadata;
  validateNftMetadata(metadata);

  const imageUrl = new URL(metadata.image);
  if (imageUrl.protocol !== "data:" || !metadata.image.startsWith("data:image/svg+xml,")) {
    throw new Error(`${filename} must contain a self-contained SVG data URI.`);
  }
  const encodedSvg = metadata.image.slice(metadata.image.indexOf(",") + 1);
  if (!decodeURIComponent(encodedSvg).includes("<svg")) {
    throw new Error(`${filename} image does not decode to SVG.`);
  }

  return {
    metadata,
    uri: new URL(filename, METADATA_FIXTURE_BASE_URL).toString(),
  };
}
