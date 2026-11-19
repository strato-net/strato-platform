import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDedicatedProtocolCall,
  buildDedicatedProtocolWorkflow,
  buildDedicatedCallPayload,
  canonicalizeSetupSigners,
  dedicatedWalletContractName,
  isUnlimitedTokenApproval,
  normalizeDedicatedArguments,
  parseDedicatedPendingUpgrade,
  parseDedicatedUpgradePaths,
  parseDedicatedTypedArguments,
} from "./dedicatedMultisig";
import {
  canonicalSolidityType,
  describeProposal,
  describeProposalWarning,
  proposalArgumentTypesMatch,
} from "./dedicatedProposal";
import { functionArgs } from "./contracts";
import { getMultisigConfigError, loadBackendConfig, runtime } from "@/lib/env";
import { parseUnsignedArgument, validateUnsignedTx } from "@/lib/walletTx";
import { deriveCanonicalUserAddress } from "./userWallets";

const wallet = "efa890674cad5e3a7640bb720c2a70bf3ae76709";
const signer = "fdb36b791a35ba52798bbc46ab066587cb60e032";
const spender = "5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71";

test("canonical User wallet addresses derive from UserRegistry", () => {
  assert.equal(
    deriveCanonicalUserAddress(
      "dnorwood-personal",
      "25a323eec280e9523b4f00017c696bec8ba9aba406f60c2348eaa471e8c6129e"
    ),
    "a697e3496a44f704e144c0f64081f0da69b0238f"
  );
});

test("dedicated setup signers are canonical and duplicate-free", () => {
  assert.deepEqual(
    canonicalizeSetupSigners([`0x${signer}`, wallet, signer]),
    [wallet, signer].sort()
  );
});

test("dedicated logic calls encode with the logic ABI at the permanent wallet address", () => {
  assert.equal(dedicatedWalletContractName("acceptNomination"), "MultisigLogic");
  assert.equal(dedicatedWalletContractName("executeUpgrade"), "MultisigWallet");
  assert.deepEqual(buildDedicatedCallPayload(dedicatedWalletContractName("acceptNomination"), `0x${wallet}`, "acceptNomination", {}), {
    contractName: "MultisigLogic",
    contractAddress: wallet,
    value: 0,
    method: "acceptNomination",
    args: {},
    metadata: {},
  });
});

test("external wallets sign only the transaction they requested", () => {
  const payload = {
    contractAddress: wallet,
    method: "transfer",
    args: {
      to: { type: "address", value: signer },
      value: { type: "uint256", value: "42" },
    },
  };
  const unsigned = {
    data: {
      nonce: 1,
      gasLimit: 600000,
      to: wallet,
      functionName: "transfer",
      args: [`"${signer}"`, "42"],
      network: "mercata",
      chainId: 123,
    },
  };

  assert.doesNotThrow(() => validateUnsignedTx(unsigned, "FUNCTION", payload, 123));
  assert.doesNotThrow(() => validateUnsignedTx(unsigned, "FUNCTION", {
    ...payload,
    args: {
      value: { type: "uint256", value: "42" },
      to: { type: "address", value: signer },
    },
  }, 123, undefined, ["to", "value"]));
  assert.deepEqual(
    parseUnsignedArgument(`[10000000000000000000,bool(true),string("abc123")]`),
    ["10000000000000000000", true, "abc123"]
  );
  assert.doesNotThrow(() => validateUnsignedTx({
    ...unsigned,
    data: {
      ...unsigned.data,
      functionName: "revokeIssueApproval",
      args: ['string("abc123")'],
    },
  }, "FUNCTION", {
    contractAddress: wallet,
    method: "revokeIssueApproval",
    args: { _issueId: { type: "string", value: "abc123" } },
  }, 123, undefined, ["_issueId"]));
  assert.doesNotThrow(() => validateUnsignedTx({
    ...unsigned,
    data: {
      ...unsigned.data,
      to: spender,
      functionName: "callContract",
      args: [`"${wallet}"`, '"transfer"', `["${signer}",42]`],
    },
  }, "FUNCTION", payload, 123, spender));
  assert.throws(() => validateUnsignedTx({
    ...unsigned,
    data: {
      ...unsigned.data,
      to: spender,
      functionName: "callContract",
      args: [`"${wallet}"`, '"transfer"', `["${signer}",42,43]`],
    },
  }, "FUNCTION", payload, 123, spender), /could not be verified/);
  assert.doesNotThrow(() => validateUnsignedTx({
    ...unsigned,
    data: {
      ...unsigned.data,
      functionName: "proposeIssue",
      args: [`"${signer}"`, '"transfer"', `"address"`, `"${wallet}"`],
    },
  }, "FUNCTION", {
    contractAddress: wallet,
    method: "proposeIssue",
    args: {
      _target: { type: "address", value: signer },
      _functionName: { type: "string", value: "transfer" },
      _arguments: [
        { type: "string", value: "address" },
        { type: "address", value: wallet },
      ],
    },
  }, 123));
  assert.throws(
    () => validateUnsignedTx(
      { ...unsigned, data: { ...unsigned.data, args: [`"${signer}"`, "43"] } },
      "FUNCTION",
      payload,
      123
    ),
    /could not be verified/
  );
  assert.throws(
    () => validateUnsignedTx(unsigned, "FUNCTION", payload, 456),
    /different network/
  );
});

test("dedicated issue review flags unlimited approvals", () => {
  assert.equal(isUnlimitedTokenApproval("approve", [spender, String(1n << 256n)]), true);
  assert.equal(isUnlimitedTokenApproval("transfer", [spender, String(1n << 256n)]), false);
});

test("dedicated issue review flags high-risk custom calls", () => {
  assert.equal(describeProposalWarning({
    target: wallet,
    functionName: "increaseAllowance",
    arguments: [spender, "1"],
  })?.title, "Token permission increase");
  assert.equal(describeProposalWarning({
    target: wallet,
    functionName: "transferFrom",
    arguments: [wallet, signer, "1"],
  })?.title, "Delegated token transfer");
  assert.equal(describeProposalWarning({
    target: wallet,
    functionName: "transferOwnership",
    arguments: [signer],
  })?.title, "Contract ownership transfer");
  assert.equal(describeProposalWarning({
    target: wallet,
    functionName: "renounceOwnership",
    arguments: [],
  })?.title, "Contract ownership removal");
  assert.equal(describeProposalWarning({
    target: wallet,
    functionName: "setLogicContract",
    arguments: [signer],
  })?.title, "Contract code replacement");
  assert.equal(describeProposalWarning({
    target: wallet,
    functionName: "setApprovalForAll",
    arguments: [signer, "true"],
  })?.title, "Token operator permission");
});

test("proposal argument types use canonical Solidity integer names", () => {
  assert.equal(canonicalSolidityType("uint"), "uint256");
  assert.equal(canonicalSolidityType("int[]"), "int256[]");
  assert.equal(canonicalSolidityType("uint128[2]"), "uint128[2]");
  assert.equal(proposalArgumentTypesMatch(["address", "uint256"], ["address", "uint"]), true);
  assert.equal(proposalArgumentTypesMatch(["address", "uint256"], ["uint256", "address"]), false);
});

test("contract-typed function arguments compare as addresses", () => {
  const args = functionArgs({
    _functions: {
      setToken: {
        _funcArgs: [["token", { index: 0, type: { tag: "Contract", typedef: "Token" } }]],
      },
    },
  }, "setToken");
  assert.equal(args[0]?.type, "Token");
  assert.equal(args[0]?.abiType, "address");
  assert.equal(proposalArgumentTypesMatch(args.map((argument) => argument.abiType || argument.type), ["address"]), true);
});

test("dedicated issue events decode JSON-string argument arrays", () => {
  assert.deepEqual(
    normalizeDedicatedArguments(`["${spender}","100000000000000000001"]`),
    [spender, "100000000000000000001"]
  );
  assert.deepEqual(
    normalizeDedicatedArguments(JSON.stringify([{ type: "address", value: spender }])),
    [spender]
  );
});

test("guided protocol calls preserve exact types and large integers", () => {
  const call = buildDedicatedProtocolCall("v3Increase", {
    target: wallet,
    amount: "100000000000000000001",
    amount2: "2",
    amount3: "0",
    amounts: ["0"],
    tokenId: "9007199254740993",
  }, 1_000);
  assert.deepEqual(call.argumentTypes, [
    "uint256", "uint256", "uint256", "uint256", "uint256", "uint256",
  ]);
  assert.deepEqual(
    call.arguments.map((argument: any) => argument.value),
    ["9007199254740993", "100000000000000000001", 2, 0, 0, 6_049_000]
  );
});

test("pool withdrawal encodes token B minimum before token A minimum", () => {
  const call = buildDedicatedProtocolCall("removeLiquidity", {
    target: wallet,
    amount: "100",
    amount2: "6000001",
    amount3: "18000000000000000001",
  }, 1_000);
  assert.deepEqual(
    call.arguments.map((argument: any) => argument.value),
    [100, 6000001, "18000000000000000001", 6_049_000]
  );
});

test("proposal descriptions use borrowed USDST units and show withdrawal receivers", () => {
  const collateral = "1111111111111111111111111111111111111111";
  const pool = "2222222222222222222222222222222222222222";
  const receiver = "3333333333333333333333333333333333333333";
  const metadata = {
    walletAddress: wallet,
    pools: [{ address: pool, poolName: "Stable pool" }] as any[],
    cdp: {
      registryAddress: "",
      engineAddress: spender,
      vaultAddress: "",
      usdstAddress: "",
      assets: [{ asset: collateral, symbol: "WBTC", decimals: 8, isPaused: false, isSupported: true }],
    },
  };
  assert.equal(
    describeProposal(
      { target: spender, functionName: "mint", arguments: [collateral, "100000000000000000000"] },
      [],
      metadata
    ).headline,
    "Borrow 100 USDST against WBTC"
  );
  assert.deepEqual(
    describeProposal(
      { target: pool, functionName: "removeliquidityOneCoin", arguments: ["1", "0", "1", receiver] },
      [],
      metadata
    ).addresses,
    [{ label: "Receiver", value: receiver }]
  );
});

test("proposal descriptions expose stable liquidity and governance destinations", () => {
  const pool = "2222222222222222222222222222222222222222";
  const receiver = "3333333333333333333333333333333333333333";
  assert.deepEqual(
    describeProposal(
      { target: pool, functionName: "addLiquidityGeneral", arguments: ["[]", "1", receiver] },
      [],
      { walletAddress: wallet, pools: [{ address: pool, poolName: "Stable pool" }] as any[] }
    ).addresses,
    [{ label: "Receiver", value: receiver }]
  );
  const current = { walletAddress: wallet, signers: [wallet, signer, receiver, spender], requiredApprovals: 3, pools: [] };
  const removal = describeProposal(
    { target: wallet, functionName: "removeSigner", arguments: [receiver, "2"] },
    [],
    current
  );
  assert.equal(removal.headline, "Remove signer 0x333333…3333");
  assert.equal(removal.detail, "4 signers become 3, approvals needed changes from 3 to 2");
  assert.deepEqual(removal.addresses, [{ label: "Signer to remove", value: receiver }]);
  assert.equal(
    describeProposal(
      { target: wallet, functionName: "removeSigner", arguments: [receiver, "2"] },
      [],
      { ...current, historical: true }
    ).detail,
    "Approvals needed: 2"
  );
  assert.equal(
    describeProposal(
      { target: wallet, functionName: "setRequiredApprovals", arguments: ["2"] },
      [],
      current
    ).headline,
    "Change approvals needed to 2"
  );
  const addSigner = describeProposal(
    { target: wallet, functionName: "nominateSigner", arguments: [spender] },
    [],
    { walletAddress: wallet, signers: [wallet, signer, receiver], requiredApprovals: 2, pools: [] }
  );
  assert.equal(addSigner.headline, "Add signer 0x5b8f21…9a71");
  assert.equal(addSigner.detail, "3 signers become 4, approvals needed stays 2");
  assert.equal(
    describeProposal(
      { target: wallet, functionName: "cancelIssue", arguments: ["proposal-7"] },
      [],
      { walletAddress: wallet, pools: [] }
    ).headline,
    "Cancel proposal proposal-7"
  );
});

test("proposal descriptions decode tokens not held by the multisig wallet", () => {
  assert.equal(
    describeProposal(
      { target: spender, functionName: "transfer", arguments: [signer, "123000000"] },
      [{ address: spender, symbol: "USDC", decimals: 6 }],
      { walletAddress: wallet, pools: [] }
    ).headline,
    "Send 123 USDC to 0xfdb36b…e032"
  );
});

test("guided workflows put typed approvals before the action", () => {
  const calls = buildDedicatedProtocolWorkflow("stake", {
    target: wallet,
    validator: signer,
    amount: "100",
  }, [{ token: spender, spender: wallet, amount: "100" }], 1_000);
  assert.deepEqual(calls.map((call) => call.functionName), ["approve", "stake"]);
  assert.deepEqual(calls[0].argumentTypes, ["address", "uint256"]);
});

test("typed argument JSON preserves arrays and integers above 2^53", () => {
  const parsed = parseDedicatedTypedArguments(
    '[{"type":"uint256[]","value":[1,9007199254740993]},{"type":"uint256","value":9007199254740993}]'
  );
  assert.deepEqual(parsed.types, ["uint256[]", "uint256"]);
  assert.deepEqual((parsed.args[0] as any).value, [1, "9007199254740993"]);
  assert.equal((parsed.args[1] as any).value, "9007199254740993");
});

test("pending upgrade is read from the JSON string Cirrus stores", () => {
  const stored = "{\"epoch\":\"1\",\"executableAt\":\"1794706828\",\"exists\":true,\"expiresAt\":\"1795311628\"," +
    "\"fromVersion\":\"3\",\"migrationFunction\":\"0000000000000000000000000000000000000000\"," +
    "\"targetLogic\":\"ea7b44ddc7340afdac6382fbaed1b8d76e2a97b1\",\"targetVersion\":\"4\"}";
  assert.deepEqual(parseDedicatedPendingUpgrade(stored), {
    targetLogic: "ea7b44ddc7340afdac6382fbaed1b8d76e2a97b1",
    fromVersion: "3",
    targetVersion: "4",
    migrationFunction: "",
    executableAt: 1794706828,
    expiresAt: 1795311628,
  });
  assert.equal(parseDedicatedPendingUpgrade({ exists: "true", migrationFunction: "migrate" })?.migrationFunction, "migrate");
  assert.equal(parseDedicatedPendingUpgrade("{\"exists\":false}"), undefined);
  assert.equal(parseDedicatedPendingUpgrade(undefined), undefined);
  assert.equal(parseDedicatedPendingUpgrade("not json"), undefined);
});

test("approved upgrade paths are read from nested factory mappings", () => {
  assert.deepEqual(parseDedicatedUpgradePaths([
    { key: { key: "1", key2: "2" }, value: true },
    { key: { key: "1", key2: "3" }, value: false },
  ]), [{ fromVersion: "1", toVersion: "2" }]);
});

test("upgrade proposal descriptions show the migration function", () => {
  assert.equal(describeProposal(
    {
      target: wallet,
      functionName: "scheduleUpgrade",
      arguments: [signer, "2", "migrateV2"],
    },
    [],
    { walletAddress: wallet, pools: [] }
  ).detail, "Migration: migrateV2");
});

test("backend configuration timeout does not block SMD startup", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { ENV: {}, setTimeout, clearTimeout },
  });
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch;
  const started = Date.now();
  try {
    await loadBackendConfig(10);
    assert.ok(Date.now() - started < 1_000, "startup remained blocked after the timeout");
    assert.equal(runtime.multisigFactoryAddress(), "");
    assert.equal(getMultisigConfigError(), "Multisig wallets could not be loaded. Refresh to try again.");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    globalThis.fetch = originalFetch;
  }
});
