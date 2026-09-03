import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getConfig,
  positiveIntegerEnv,
  requiredEnv,
  resolveUserPath,
  resolveWalletPath,
} from "../src/config";
import { buildNftMetadata, validateNftMetadata } from "../src/nft/nft_metadata";
import { DEVNET_GENESIS_HASH } from "../src/preflight";
import { readState, requireState, updateState } from "../src/state";
import { assertBigIntEqual, assertMetadataUri, toBaseUnits } from "../src/validation";
import { readWalletBytes } from "../src/wallet";
import { loadMetadataFixture, METADATA_FIXTURE_BASE_URL } from "./metadata-fixtures";

test("configuration defaults to devnet and blocks accidental mainnet", () => {
  const config = getConfig({});
  assert.equal(config.cluster, "devnet");
  assert.match(config.rpcUrl, /devnet/);
  assert.throws(
    () => getConfig({ SOLANA_CLUSTER: "mainnet-beta", SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" }),
    /Mainnet is disabled/,
  );
});

test("devnet preflight uses the canonical genesis hash", () => {
  assert.equal(DEVNET_GENESIS_HASH, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
});

test("wallet paths prefer the environment and otherwise use the Solana CLI default", () => {
  assert.equal(
    resolveWalletPath({ WALLET_PATH: "keys/devnet.json" }, "/project", "/home/reviewer"),
    "/project/keys/devnet.json",
  );
  assert.equal(resolveWalletPath({}, "/project", "/home/reviewer"), "/home/reviewer/.config/solana/id.json");
  assert.equal(
    resolveUserPath("~/keys/devnet.json", "/project", "/home/reviewer"),
    "/home/reviewer/keys/devnet.json",
  );
});

test("environment readers reject missing and invalid values", () => {
  assert.throws(() => requiredEnv("RECIPIENT", {}), /RECIPIENT is required/);
  assert.equal(positiveIntegerEnv("AMOUNT", 12, {}), 12);
  assert.throws(() => positiveIntegerEnv("AMOUNT", 1, { AMOUNT: "1.5" }), /safe integer/);
});

test("token amounts are converted to base units without floating point", () => {
  assert.equal(toBaseUnits(1_000_000, 6), 1_000_000_000_000n);
  assert.equal(toBaseUnits(100, 6), 100_000_000n);
  assert.throws(() => toBaseUnits(-1, 6), /non-negative/);
  assert.doesNotThrow(() => assertBigIntEqual(10n, 10n, "balance"));
  assert.throws(() => assertBigIntEqual(9n, 10n, "balance"), /expected 10/);
});

test("assignment state is merged and written atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "spl-nft-state-"));
  const path = join(directory, "state.json");
  try {
    assert.deepEqual(readState(path), {});
    updateState({ splMint: "mint-address" }, path);
    updateState({ asset: "asset-address" }, path);
    assert.deepEqual(readState(path), { splMint: "mint-address", asset: "asset-address" });
    assert.equal(requireState("splMint", path), "mint-address");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).asset, "asset-address");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wallet loader accepts exactly 64 bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "spl-nft-wallet-"));
  const path = join(directory, "wallet.json");
  try {
    writeFileSync(path, JSON.stringify(Array.from({ length: 64 }, (_, index) => index)));
    assert.equal(readWalletBytes(path).length, 64);
    writeFileSync(path, "{not-json");
    assert.throws(() => readWalletBytes(path), /not valid JSON/);
    writeFileSync(path, JSON.stringify([1, 2, 3]));
    assert.throws(() => readWalletBytes(path), /exactly 64/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wallet loader reports the resolved path and remediation for missing files", () => {
  const directory = mkdtempSync(join(tmpdir(), "spl-nft-missing-wallet-"));
  const path = join(directory, "missing.json");
  try {
    assert.throws(
      () => readWalletBytes(path),
      (error: unknown) => {
        assert.match(String(error), /Wallet file does not exist/);
        assert.match(String(error), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(String(error), /solana-keygen new/);
        return true;
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("MPL Core metadata follows the expected image schema", () => {
  const imageUri = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E";
  const metadata = buildNftMetadata(imageUri);
  assert.equal(metadata.image, imageUri);
  assert.equal(metadata.properties.category, "image");
  assert.equal(metadata.properties.files[0].uri, metadata.image);
  assert.ok(metadata.attributes.some((attribute) => attribute.value === "MPL Core"));
  assert.doesNotThrow(() => validateNftMetadata(metadata));
  assert.doesNotThrow(() => assertMetadataUri("ipfs://bafybeigdyrzt/metadata.json"));
  assert.throws(() => assertMetadataUri("not a URI"), /invalid/);
  assert.throws(
    () => validateNftMetadata({ ...metadata, image: "not a URI" }),
    /invalid/,
  );
});

test("published metadata fixtures contain resolvable required fields and images", () => {
  for (const filename of ["core-metadata.json", "core-metadata-updated.json"] as const) {
    const { metadata, uri } = loadMetadataFixture(filename);
    assert.equal(uri, `${METADATA_FIXTURE_BASE_URL}${filename}`);
    assert.ok(metadata.name.trim());
    assert.ok(metadata.description.trim());
    assert.match(decodeURIComponent(metadata.image), /^data:image\/svg\+xml,<svg/);
    assert.equal(metadata.properties.files[0].uri, metadata.image);
  }
});
