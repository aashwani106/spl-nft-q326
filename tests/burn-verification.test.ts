import assert from "node:assert/strict";
import test from "node:test";
import { MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";
import {
  lamports,
  publicKey,
  type Context,
  type MaybeRpcAccount,
} from "@metaplex-foundation/umi";
import { verifyCoreAssetBurned } from "../src/nft/nft_burn";

const assetAddress = publicKey("11111111111111111111111111111111");

function tombstone(overrides: Partial<Extract<MaybeRpcAccount, { exists: true }>> = {}) {
  return {
    exists: true as const,
    publicKey: assetAddress,
    executable: false,
    owner: MPL_CORE_PROGRAM_ID,
    lamports: lamports(897_840),
    data: new Uint8Array([0]),
    ...overrides,
  };
}

function verificationContext(
  getAccount: Context["rpc"]["getAccount"],
): Pick<Context, "rpc" | "programs"> {
  return {
    rpc: { getAccount } as Context["rpc"],
    programs: {} as Context["programs"],
  };
}

test("burn verification accepts only the Core zero-byte tombstone state", async () => {
  const context = verificationContext(async () => tombstone());
  const result = await verifyCoreAssetBurned(context, assetAddress);
  assert.equal(result.fetchFailed, true);
  assert.equal(result.ownerRemoved, true);
  assert.equal(result.accountState, "core-tombstone");
  assert.equal(result.retainedLamports, 897_840n);
});

test("burn verification rejects a tombstone owned by another program", async () => {
  const context = verificationContext(async () =>
    tombstone({ owner: publicKey("SysvarRent111111111111111111111111111111111") }),
  );
  await assert.rejects(
    verifyCoreAssetBurned(context, assetAddress),
    /tombstone owner.*expected MPL Core/,
  );
});

test("burn verification rejects a tombstone without retained rent", async () => {
  const context = verificationContext(async () => tombstone({ lamports: lamports(0) }));
  await assert.rejects(
    verifyCoreAssetBurned(context, assetAddress),
    /tombstone retained no lamports/,
  );
});

test("burn verification does not swallow unrelated RPC failures", async () => {
  const rpcFailure = new Error("RPC transport unavailable");
  let callCount = 0;
  const context = verificationContext(async () => {
    callCount += 1;
    if (callCount === 1) throw rpcFailure;
    return tombstone();
  });
  await assert.rejects(verifyCoreAssetBurned(context, assetAddress), (error) => error === rpcFailure);
});
