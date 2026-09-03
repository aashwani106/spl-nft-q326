import type { AssetV1 } from "@metaplex-foundation/mpl-core";

export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Token amount must be a non-negative safe integer.");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Token decimals must be an integer between 0 and 18.");
  }
  return BigInt(amount) * 10n ** BigInt(decimals);
}

export function assertBigIntEqual(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}.`);
  }
}

export function assertAssetMetadata(asset: AssetV1, name: string, uri: string): void {
  if (asset.name !== name || asset.uri !== uri) {
    throw new Error(
      `Asset metadata mismatch. Expected name=${name}, uri=${uri}; received name=${asset.name}, uri=${asset.uri}.`,
    );
  }
}

export function assertAssetOwner(asset: AssetV1, owner: string): void {
  if (asset.owner.toString() !== owner) {
    throw new Error(`Asset owner mismatch. Expected ${owner}, received ${asset.owner}.`);
  }
}

export function assertAssetAddress(asset: AssetV1, address: string): void {
  if (asset.publicKey.toString() !== address) {
    throw new Error(`Asset address mismatch. Expected ${address}, received ${asset.publicKey}.`);
  }
}

export function assertAssetUpdateAuthority(asset: AssetV1, authority: string): void {
  if (
    asset.updateAuthority.type !== "Address" ||
    asset.updateAuthority.address?.toString() !== authority
  ) {
    throw new Error(`Asset update authority mismatch. Expected ${authority}.`);
  }
}

export function assertMetadataUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Metadata URI is invalid: ${uri}`);
  }

  const supportedProtocols = new Set(["https:", "ipfs:", "ar:", "data:"]);
  if (!supportedProtocols.has(parsed.protocol)) {
    throw new Error(`Metadata URI protocol is unsupported: ${parsed.protocol}`);
  }
}
