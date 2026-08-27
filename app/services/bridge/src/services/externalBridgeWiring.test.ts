import assert from "node:assert/strict";
import test from "node:test";

for (const name of [
  "ALCHEMY_API_KEY",
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
  "SENDGRID_API_KEY",
  "STRATO_NODE_URL",
  "VAULT_PROXY_ADDRESS",
  "VOUCHER_CONTRACT_ADDRESS",
]) {
  process.env[name] ||= "1111111111111111111111111111111111111111";
}
process.env.SENDGRID_API_KEY = "SG.test.test";

const externalBridgeAddress = process.env.EXTERNAL_ASSET_BRIDGE_ADDRESS!;

test("records non-native deposits on ExternalAssetBridge", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const calls: any[] = [];
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "test" };
  };

  const { depositBatch } = await import("./bridgeService");
  await depositBatch([
    {
      externalChainId: 1,
      externalSender: "sender",
      externalToken: "external-token",
      externalTokenAmount: "100",
      externalTxHash: "transaction",
      stratoRecipient: "recipient",
      targetStratoToken: "strato-token",
    },
  ]);

  assert.deepEqual(calls[0], {
    contractName: "ExternalAssetBridge",
    contractAddress: externalBridgeAddress,
    method: "depositBatch",
    args: {
      externalChainIds: [1],
      externalTxHashes: ["transaction"],
      externalTokens: ["external-token"],
      externalTokenAmounts: ["100"],
      stratoRecipients: ["recipient"],
      externalSenders: ["sender"],
      stratoTokens: ["strato-token"],
    },
  });
});

test("reads pending deposits and vault custody from ExternalAssetBridge", async () => {
  const { cirrus } = await import("../utils/api");
  const requestedUrls: string[] = [];
  (cirrus as any).get = async (url: string) => {
    requestedUrls.push(url);
    if (url.includes("-deposits")) {
      return [{
        key: "1",
        key2: "transaction",
        value: {
          status: 1,
          externalToken: "external-token",
          stratoToken: "strato-token",
          stratoRecipient: "recipient",
        },
      }];
    }
    if (url.includes("-routes")) {
      return [{
        key: "external-token",
        key2: "1",
        key3: "strato-token",
        value: {
          depositsEnabled: true,
          externalDecimals: 18,
          externalToken: "external-token",
          stratoToken: "strato-token",
        },
      }];
    }
    if (url.includes("-chains")) {
      return [{
        key: "1",
        value: {
          chainName: "Ethereum",
          depositRouter: "router",
          enabled: true,
          lastProcessedBlock: 10,
          vault: "vault",
        },
      }];
    }
    return [];
  };

  const { getDepositsByStatus } = await import("./cirrusService");
  const deposits = await getDepositsByStatus("1");

  assert.equal(deposits[0].custodyAddress, "vault");
  assert.equal(deposits[0].bridgeStatus, 1);
  assert.ok(
    requestedUrls.every((url) => url.includes("BlockApps-ExternalAssetBridge")),
  );
});
