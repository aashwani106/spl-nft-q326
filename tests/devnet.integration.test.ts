import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateKeyPairSigner } from "@solana/kit";
import { NoApprovalsError, update } from "@metaplex-foundation/mpl-core";
import { generateSigner, signerIdentity } from "@metaplex-foundation/umi";
import { AccountNotFoundError } from "@metaplex-foundation/umi";
import {
  burnCoreNft,
  isCoreTombstoneDeserializationError,
} from "../src/nft/nft_burn";
import { mintCoreNft } from "../src/nft/nft_mint";
import { transferCoreNft } from "../src/nft/nft_transfer";
import { updateCoreNft } from "../src/nft/nft_update";
import { formatDevnetPreflight, validateDevnetEnvironment } from "../src/preflight";
import { createSplMint } from "../src/spl/spl_init";
import { mintSplSupply } from "../src/spl/spl_mint";
import { transferSplTokens } from "../src/spl/spl_transfer";
import { updateState } from "../src/state";
import { createAssignmentUmi } from "../src/umi";
import { elapsedMs, withTimeout } from "../src/diagnostics";
import { fetchAssetWithDiagnostics, sendAndConfirmUmi } from "../src/umi-diagnostics";
import { loadMetadataFixture } from "./metadata-fixtures";

const enabled = process.env.RUN_DEVNET_TESTS === "true";

async function lifecycleStep<T>(number: number, name: string, operation: () => Promise<T>): Promise<T> {
  const label = `[${number}/8] ${name}`;
  const startedAt = Date.now();
  console.log(`${label}: started`);
  try {
    const result = await operation();
    console.log(`${label}: complete elapsed=${elapsedMs(startedAt)}ms`);
    return result;
  } catch (error) {
    console.error(`${label}: failed elapsed=${elapsedMs(startedAt)}ms error=${String(error)}`);
    throw error;
  }
}

test("full SPL Token and MPL Core lifecycle on devnet", { skip: !enabled }, async () => {
  process.env.SOLANA_CLUSTER = "devnet";
  const preflight = await validateDevnetEnvironment().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Devnet preflight failed before transaction submission.\n${message}\n` +
        "Run `npm run preflight:devnet` for the same read-only validation.",
    );
  });
  console.log(`\nDevnet preflight passed\n${formatDevnetPreflight(preflight)}\n`);

  const directory = mkdtempSync(join(tmpdir(), "spl-nft-integration-"));
  process.env.STATE_PATH = join(directory, "state.json");
  try {
    const createdMint = await lifecycleStep(1, "Create SPL Mint", createSplMint);
    assert.ok(createdMint.signature);
    console.log(`[1/8] Create SPL Mint: mint=${createdMint.mint} signature=${createdMint.signature}`);

    const minted = await lifecycleStep(2, "Mint SPL Supply", mintSplSupply);
    assert.ok(minted.amount > 0n);
    console.log(`[2/8] Mint SPL Supply: ata=${minted.ata} signature=${minted.signature}`);

    const tokenRecipient = await withTimeout(
      "Generate SPL recipient signer",
      generateKeyPairSigner(),
    );
    const transferredTokens = await lifecycleStep(3, "Transfer SPL Tokens", () =>
      transferSplTokens(tokenRecipient.address),
    );
    assert.ok(transferredTokens.signature);
    console.log(
      `[3/8] Transfer SPL Tokens: recipient=${tokenRecipient.address} ` +
        `signature=${transferredTokens.signature}`,
    );

    const initialMetadata = loadMetadataFixture("core-metadata.json");
    const updatedMetadata = loadMetadataFixture("core-metadata-updated.json");
    console.log(`[metadata] initial=${initialMetadata.uri}`);
    console.log(`[metadata] updated=${updatedMetadata.uri}`);
    process.env.NFT_NAME = initialMetadata.metadata.name;
    process.env.NFT_UPDATED_NAME = updatedMetadata.metadata.name;
    process.env.NFT_UPDATED_URI = updatedMetadata.uri;
    updateState({ metadataUri: initialMetadata.uri });
    const context = createAssignmentUmi();
    const createdAsset = await lifecycleStep(4, "Create MPL Core Asset", () =>
      mintCoreNft(context),
    );
    assert.ok(createdAsset.asset.publicKey);
    console.log(
      `[4/8] Create MPL Core Asset: asset=${createdAsset.asset.publicKey} ` +
        `signature=${createdAsset.signature}`,
    );

    const attacker = generateSigner(context.umi);
    await lifecycleStep(5, "Unauthorized Update Test", async () => {
      context.umi.use(signerIdentity(attacker, false));
      try {
        await assert.rejects(
          sendAndConfirmUmi(
            "Unauthorized MPL Core update",
            update(context.umi, {
              asset: createdAsset.asset,
              payer: context.signer,
              authority: attacker,
              name: "Unauthorized update",
              uri: updatedMetadata.uri,
            }),
            context.umi,
            "finalized",
          ),
          (error: unknown) => {
            assert.ok(error instanceof NoApprovalsError);
            assert.match(String(error), /Neither the asset or any plugins have approved/i);
            console.log(`[5/8] Unauthorized Update Test: expectedError=${error.name}`);
            return true;
          },
        );
      } finally {
        context.umi.use(signerIdentity(context.signer, false));
      }
    });
    const unchangedAsset = await fetchAssetWithDiagnostics(
      "Verify rejected unauthorized update",
      context.umi,
      createdAsset.asset.publicKey,
      { commitment: "finalized" },
    );
    assert.equal(unchangedAsset.name, initialMetadata.metadata.name);
    assert.equal(unchangedAsset.uri, initialMetadata.uri);
    assert.equal(unchangedAsset.owner, createdAsset.asset.owner);
    assert.deepEqual(unchangedAsset.updateAuthority, createdAsset.asset.updateAuthority);

    const updatedAsset = await lifecycleStep(6, "Authorized Update", () =>
      updateCoreNft(context),
    );
    assert.equal(updatedAsset.asset.publicKey, createdAsset.asset.publicKey);
    assert.equal(updatedAsset.asset.owner, createdAsset.asset.owner);
    assert.deepEqual(updatedAsset.asset.updateAuthority, createdAsset.asset.updateAuthority);
    assert.equal(updatedAsset.asset.name, updatedMetadata.metadata.name);
    assert.equal(updatedAsset.asset.uri, updatedMetadata.uri);
    console.log(`[6/8] Authorized Update: signature=${updatedAsset.signature}`);

    const recipient = generateSigner(context.umi);
    const transferredAsset = await lifecycleStep(7, "Transfer NFT", () =>
      transferCoreNft(recipient.publicKey, context),
    );
    assert.equal(transferredAsset.asset.owner, recipient.publicKey);
    console.log(
      `[7/8] Transfer NFT: recipient=${recipient.publicKey} signature=${transferredAsset.signature}`,
    );

    context.umi.use(signerIdentity(recipient, false));
    const burnedAsset = await lifecycleStep(8, "Burn NFT", () =>
      burnCoreNft({ umi: context.umi, signer: recipient }),
    );
    assert.equal(burnedAsset.asset, createdAsset.asset.publicKey);
    assert.ok(burnedAsset.signature);
    assert.equal(burnedAsset.transactionFinalized, true);
    assert.equal(burnedAsset.verification.fetchFailed, true);
    assert.equal(burnedAsset.verification.ownerRemoved, true);
    assert.match(burnedAsset.verification.accountState, /^(missing|core-tombstone)$/);
    console.log(
      `[8/8] Burn NFT: asset=${burnedAsset.asset} signature=${burnedAsset.signature} ` +
        `accountState=${burnedAsset.verification.accountState}`,
    );
    await assert.rejects(
      fetchAssetWithDiagnostics(
        "Independent post-burn asset fetch",
        context.umi,
        createdAsset.asset.publicKey,
        { commitment: "finalized" },
      ),
      (error: unknown) => {
        assert.ok(
          error instanceof AccountNotFoundError || isCoreTombstoneDeserializationError(error),
        );
        return true;
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
