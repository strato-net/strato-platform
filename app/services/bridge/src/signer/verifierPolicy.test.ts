import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getAddress, TypedDataEncoder } from "ethers";
import {
  evaluateDepositPolicy,
  evaluateWithdrawalPolicy,
  type VerifierPolicy,
} from "./verifierPolicy";
import type { DepositSettlementAttestation } from "./settlementValidation";

const externalToken = "0x1111111111111111111111111111111111111111";
const stratoToken = "2222222222222222222222222222222222222222";

const policy: VerifierPolicy = {
  version: "test-1",
  baselinePolicyHash: `sha256:${"a".repeat(64)}`,
  verifierIndex: 1,
  settlementAttestor: "8888888888888888888888888888888888888888",
  sourceChainId: "9001",
  sourceBridge: "3333333333333333333333333333333333333333",
  destinationChainId: "11155111",
  destinationVault: "0x4444444444444444444444444444444444444444",
  routes: [{
    externalToken,
    stratoToken,
    depositsEnabled: true,
    autoRouteEnabled: false,
    maxAutoDepositAmount: "100",
  }],
  tokens: [{
    token: externalToken,
    withdrawalsEnabled: true,
    maxAutoWithdrawalAmount: "50",
  }],
};

const deposit = {
  externalChainId: "11155111",
  depositRouter: "0x5555555555555555555555555555555555555555",
  depositId: "1",
  externalSender: "0x6666666666666666666666666666666666666666",
  externalToken,
  externalTokenAmount: "100",
  externalTxHash: `0x${"1".repeat(64)}`,
  externalBlockHash: `0x${"2".repeat(64)}`,
  externalLogIndex: 0,
  stratoRecipient: "7777777777777777777777777777777777777777",
  stratoToken,
  action: "0",
  actionToken: "0000000000000000000000000000000000000000",
  minFinalOut: "0",
} satisfies DepositSettlementAttestation;

// Load the actual route check without starting the verifier or initializing KMS.
const signerSource = ts.createSourceFile(
  "index.ts",
  readFileSync(resolve(__dirname, "../../src/signer/index.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const routeCheck = signerSource.statements.find(
  (statement) => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) => declaration.name.getText(signerSource) === "validateSourceDepositRoute",
    ),
);
assert.ok(routeCheck);
const routeCheckCode = ts.transpileModule(routeCheck.getText(signerSource), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

test("validates structured Cirrus deposit routes and AUTO_ROUTE permissions", async () => {
  let route: unknown = { depositsEnabled: true, withdrawalsEnabled: false, externalDecimals: 18 };
  let autoRoute = false;
  const validate = runInNewContext(`${routeCheckCode}\nvalidateSourceDepositRoute`, {
    sourceBridge: policy.sourceBridge,
    normalize: (value: string) => value.replace(/^0x/, "").toLowerCase(),
    stratoGet: async (path: string, params: Record<string, string>) => {
      assert.equal(params.address, `eq.${policy.sourceBridge}`);
      assert.equal(params.key, `eq.${externalToken.slice(2)}`);
      assert.equal(params.key2, `eq.${deposit.externalChainId}`);
      assert.equal(params.key3, `eq.${stratoToken}`);
      assert.equal(params.select, "value");
      if (path.endsWith("-routes")) {
        assert.equal(params["value->>depositsEnabled"], "eq.true");
        assert.equal(params.value, undefined);
        return { data: route === undefined ? [] : [{ value: route }] };
      }
      assert.equal(path, "/cirrus/search/BlockApps-ExternalAssetBridge-depositActionConfigs");
      assert.equal(params["value->>depositsEnabled"], undefined);
      return { data: [{ value: { autoRoute } }] };
    },
  }) as (input: DepositSettlementAttestation) => Promise<void>;

  await validate(deposit);
  for (route of [undefined, false, true, {}, { depositsEnabled: false }, { depositsEnabled: "true" }]) {
    await assert.rejects(validate(deposit), /Deposit route is not enabled/);
  }
  route = { depositsEnabled: true };
  await assert.rejects(validate({ ...deposit, action: "4" }), /AUTO_ROUTE is not enabled/);
  autoRoute = true;
  await validate({ ...deposit, action: "4" });
});

test("requires local review above the automatic deposit limit", () => {
  assert.equal(evaluateDepositPolicy(policy, deposit).decision, "approve");
  assert.equal(
    evaluateDepositPolicy(policy, {
      ...deposit,
      externalTokenAmount: "101",
    }).decision,
    "manual_review",
  );
});

test("rejects AUTO_ROUTE unless the local route enables it", () => {
  assert.throws(
    () => evaluateDepositPolicy(policy, { ...deposit, action: "4" }),
    /rejects the deposit action/,
  );
});

test("requires local review above the automatic withdrawal limit", () => {
  assert.equal(
    evaluateWithdrawalPolicy(policy, { token: externalToken, amount: "50" })
      .decision,
    "approve",
  );
  assert.equal(
    evaluateWithdrawalPolicy(policy, { token: externalToken, amount: "51" })
      .decision,
    "manual_review",
  );
});

test("validates historical releases independently of current authorization eligibility", async () => {
  const names = ["AUTHORIZATION_TYPES", "domain", "validateDestinationIdentity", "validateDestination", "validateReleasedDestination"];
  const code = names.map((name) => {
    const statement = signerSource.statements.find((node) =>
      ts.isVariableStatement(node) && node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(signerSource) === name,
      ),
    );
    assert.ok(statement, name);
    return statement.getText(signerSource);
  }).join("\n");
  const authorization = {
    sourceChainId: "9001", sourceBridge: `0x${policy.sourceBridge}`, sourceWithdrawalId: "7",
    destinationChainId: policy.destinationChainId, destinationVault: policy.destinationVault,
    token: externalToken, recipient: deposit.externalSender, amount: "100",
    notBefore: "1000", deadline: "1100", signerSetVersion: "1",
  };
  const reservationId = `0x${"a".repeat(64)}`;
  let timestamp = 1101;
  let version = 1n;
  let enabled = true;
  const reservation = { status: 2n, authorizationDigest: "" };
  const checks = runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText + "\n({ validateDestination, validateReleasedDestination, digest: (a) => TypedDataEncoder.hash(domain(a), AUTHORIZATION_TYPES, a) })", {
    destinationChainId: BigInt(policy.destinationChainId), destinationVault: policy.destinationVault,
    authorizationSignerAddress: "signer", getAddress, TypedDataEncoder,
    normalize: (value: string) => value.replace(/^0x/, "").toLowerCase(),
    provider: { getBlock: async () => ({ timestamp }) },
    vault: {
      getReservationId: async () => reservationId,
      reservations: async () => reservation,
      maxAuthorizationValiditySeconds: async () => 1800n,
      signerSetVersion: async () => version,
      attestationSigners: async () => enabled,
    },
  });
  reservation.authorizationDigest = checks.digest(authorization);
  await checks.validateReleasedDestination(authorization, reservationId);
  await assert.rejects(checks.validateDestination(authorization), /timing or signer set/);
  timestamp = 1050;
  version = 2n;
  await checks.validateReleasedDestination(authorization, reservationId);
  await assert.rejects(checks.validateDestination(authorization), /timing or signer set/);
  enabled = false;
  await checks.validateReleasedDestination(authorization, reservationId);
  await assert.rejects(checks.validateDestination(authorization), /signer is not enabled/);
  for (const mismatch of [{ destinationChainId: "1" }, { destinationVault: externalToken }]) {
    await assert.rejects(checks.validateReleasedDestination(
      { ...authorization, ...mismatch }, reservationId,
    ), /Destination mismatch/);
  }
  await assert.rejects(checks.validateReleasedDestination(
    authorization, `0x${"b".repeat(64)}`,
  ), /does not match authorization/);
  await assert.rejects(checks.validateReleasedDestination(
    { ...authorization, amount: "101" }, reservationId,
  ), /does not match authorization/);
  for (const status of [0n, 1n, 3n]) {
    reservation.status = status;
    await assert.rejects(checks.validateReleasedDestination(authorization, reservationId), /does not match authorization/);
  }
});

const loadSignerChecks = (names: string[], context: Record<string, unknown>) => {
  const code = names.map((name) => {
    const node = signerSource.statements.find((statement) => ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) => declaration.name.getText(signerSource) === name));
    assert.ok(node, name);
    return node.getText(signerSource);
  }).join("\n");
  return runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText + `\n({${names.join(",")}})`, context);
};

test("pins actual RPC identities without truncating STRATO network IDs", async () => {
  let externalId = "0x1";
  let networkID: string | undefined = "123456789012345678901234";
  const { validateRpcIdentity } = loadSignerChecks(["validateRpcIdentity"], {
    destinationChainId: 1n, sourceChainId: BigInt(networkID),
    provider: { send: async (method: string) => { assert.equal(method, "eth_chainId"); return externalId; } },
    stratoGet: async (path: string) => {
      assert.equal(path, "/strato-api/eth/v1.2/metadata");
      return { data: { networkID } };
    },
  });
  await validateRpcIdentity();
  externalId = "0x2";
  await assert.rejects(validateRpcIdentity(), /External RPC chain ID mismatch/);
  externalId = "0x1";
  networkID = "123456789012345678901235";
  await assert.rejects(validateRpcIdentity(), /STRATO RPC network ID mismatch/);
  networkID = undefined;
  await assert.rejects(validateRpcIdentity(), /STRATO RPC network ID mismatch/);
});

test("refund attestations reject paid, reserved, unconfirmed, or mismatched vault state", async () => {
  const authorization = {
    sourceChainId: "9001", sourceBridge: `0x${policy.sourceBridge}`, sourceWithdrawalId: "7",
    destinationChainId: policy.destinationChainId, destinationVault: policy.destinationVault,
    token: externalToken, recipient: deposit.externalSender, amount: "100",
    notBefore: "1000", deadline: "1100", signerSetVersion: "1",
  };
  let confirmedTimestamp = 1101;
  let status = 0;
  let digest = "";
  const checks = loadSignerChecks(["AUTHORIZATION_TYPES", "domain", "validateDestinationIdentity", "validateRefundDestination"], {
    destinationChainId: BigInt(policy.destinationChainId), destinationVault: policy.destinationVault,
    verifierConfirmations: 5, getAddress, TypedDataEncoder,
    normalize: (value: string) => value.replace(/^0x/, "").toLowerCase(),
    provider: { getBlock: async (tag: string | number) => tag === "latest"
      ? { number: 20, timestamp: 1200 } : { number: 15, timestamp: confirmedTimestamp } },
    vault: {
      getReservationId: async () => "reservation",
      reservations: async (_id: string, options: { blockTag: number }) => {
        assert.equal(options.blockTag, 15);
        return { status, authorizationDigest: digest };
      },
    },
  });
  await checks.validateRefundDestination(authorization);
  confirmedTimestamp = 1100;
  await assert.rejects(checks.validateRefundDestination(authorization), /has not expired/);
  confirmedTimestamp = 1101;
  for (status of [1, 2]) {
    await assert.rejects(checks.validateRefundDestination(authorization), /not refundable/);
  }
  status = 3;
  digest = `0x${"0".repeat(64)}`;
  await assert.rejects(checks.validateRefundDestination(authorization), /not refundable/);
  digest = TypedDataEncoder.hash(checks.domain(authorization), checks.AUTHORIZATION_TYPES, authorization);
  await checks.validateRefundDestination(authorization);
  await assert.rejects(checks.validateRefundDestination({ ...authorization, amount: "101" }), /not refundable/);
});
