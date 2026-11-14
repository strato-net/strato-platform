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
  parseDedicatedTypedArguments,
} from "./dedicatedMultisig";
import {
  canonicalSolidityType,
  describeProposal,
  describeProposalWarning,
  proposalArgumentTypesMatch,
} from "./dedicatedProposal";
import { functionArgs } from "./contracts";
import { loadBackendConfig } from "@/lib/env";

const wallet = "efa890674cad5e3a7640bb720c2a70bf3ae76709";
const signer = "fdb36b791a35ba52798bbc46ab066587cb60e032";
const spender = "5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71";

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
  assert.equal(
    describeProposal(
      {
        target: wallet,
        functionName: "applyConfiguration",
        arguments: [JSON.stringify([wallet, signer]), "2"],
      },
      [],
      { walletAddress: wallet, signers: [wallet, signer, receiver], requiredApprovals: 3, pools: [] }
    ).headline,
    "Remove signer 0x333333…3333 and change approvals needed to 2"
  );
  assert.equal(
    describeProposal(
      {
        target: wallet,
        functionName: "applyConfiguration",
        arguments: ["unreadable", "2"],
      },
      [],
      { walletAddress: wallet, signers: [wallet, signer, receiver], requiredApprovals: 3, pools: [] }
    ).headline,
    "Set signers and approvals needed to 2"
  );
  assert.equal(
    describeProposal(
      {
        target: wallet,
        functionName: "applyConfiguration",
        arguments: [JSON.stringify([wallet, signer]), "2"],
      },
      [],
      {
        walletAddress: wallet,
        signers: [wallet, signer, receiver],
        requiredApprovals: 3,
        historical: true,
        pools: [],
      }
    ).headline,
    "Set 2 signers and approvals needed to 2"
  );
  const addSigner = describeProposal(
    {
      target: wallet,
      functionName: "nominateConfiguration",
      arguments: [spender, JSON.stringify([wallet, signer, receiver, spender]), "3"],
    },
    [],
    { walletAddress: wallet, signers: [wallet, signer, receiver], requiredApprovals: 3, pools: [] }
  );
  assert.equal(addSigner.headline, "Add signer 0x5b8f21…9a71");
  assert.equal(addSigner.detail, "3 signers become 4, approvals needed stays 3");
  const legacyNomination = describeProposal(
    {
      target: wallet,
      functionName: "nominateConfiguration",
      arguments: [spender, JSON.stringify([wallet, signer, spender]), "2"],
    },
    [],
    { walletAddress: wallet, signers: [wallet, signer, receiver], requiredApprovals: 3, pools: [] }
  );
  assert.equal(
    legacyNomination.headline,
    "Remove signer 0x333333…3333 and add signer 0x5b8f21…9a71 and change approvals needed to 2"
  );
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
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    globalThis.fetch = originalFetch;
  }
});
