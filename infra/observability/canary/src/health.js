// CloudWatch Synthetics canary: the user's view of the whole system, once a
// minute. Pings the edge, reads the latest block over JSON-RPC, records the
// block's age as a metric, and fails when the edge is down or the chain is
// stale. The time-to-inclusion step (submit a no-op transaction, wait for
// its receipt) is the next thing to add here; it needs a funded canary key
// in Secrets Manager and the node's transaction encoding.
const synthetics = require("Synthetics");
const log = require("SyntheticsLogger");
const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const nodeUrl = (process.env.NODE_URL || "").replace(/\/$/, "");
const maxAge = Number(process.env.MAX_BLOCK_AGE_SECONDS || 30);
const envName = process.env.ENV_NAME || "unknown";
// Transaction step: set when the canary has a funded key (Secrets Manager
// JSON {"privateKey":"0x..."}). The key is read by the canary at run time
// through its role; it is never in the template or the environment.
const keySecretId = process.env.CANARY_KEY_SECRET_ID || "";
const maxInclusion = Number(process.env.CANARY_MAX_INCLUSION_SECONDS || 30);
const gasLimit = Number(process.env.CANARY_GAS_LIMIT || 1000000);

const rpc = async (method, params) => {
  const res = await fetch(`${nodeUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
};

const putMetric = async (name, value, unit) => {
  const cw = new CloudWatchClient({});
  await cw.send(
    new PutMetricDataCommand({
      Namespace: "STRATO",
      MetricData: [{ MetricName: name, Value: value, Unit: unit, Dimensions: [{ Name: "Environment", Value: envName }] }],
    })
  );
};

exports.handler = async () => {
  await synthetics.executeStep("ping", async () => {
    const res = await fetch(`${nodeUrl}/_ping`);
    if (!res.ok) throw new Error(`/_ping returned ${res.status}`);
  });

  let ageSeconds = null;
  await synthetics.executeStep("latestBlock", async () => {
    const block = await rpc("eth_getBlockByNumber", ["latest", false]);
    if (!block || !block.number) throw new Error("eth_getBlockByNumber returned no block");
    const number = parseInt(block.number, 16);
    ageSeconds = Date.now() / 1000 - parseInt(block.timestamp, 16);
    log.info(`best block ${number}, age ${ageSeconds.toFixed(1)}s`);
    await putMetric("BlockAgeSeconds", ageSeconds, "Seconds");
    await putMetric("BestBlockNumber", number, "None");
  });

  await synthetics.executeStep("blockAge", async () => {
    if (ageSeconds === null || ageSeconds > maxAge) {
      throw new Error(`block age ${ageSeconds === null ? "unknown" : ageSeconds.toFixed(1) + "s"} exceeds ${maxAge}s`);
    }
  });

  if (keySecretId) await transactionStep();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Submit a no-op transaction (one unit of the native token to itself) and
// time it to inclusion. That single number is the user's experience of the
// whole system: edge, API, bus, sequencer, VM, indexers.
const transactionStep = async () => {
  const { addressFromPrivateKey, buildSignedTransaction } = require("./strato-tx");
  const sm = new SecretsManagerClient({});
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: keySecretId }));
  const privateKey = JSON.parse(secret.SecretString || "{}").privateKey;
  if (!privateKey) throw new Error(`secret ${keySecretId} has no privateKey field`);
  const address = addressFromPrivateKey(privateKey);

  let submittedAt = 0;
  let hash = "";
  await synthetics.executeStep("submitTransaction", async () => {
    const [chainIdHex, nonceHex] = await Promise.all([rpc("eth_chainId", []), rpc("eth_getTransactionCount", ["0x" + address, "latest"])]);
    const tx = buildSignedTransaction({
      privateKey,
      chainId: parseInt(chainIdHex, 16),
      nonce: parseInt(nonceHex, 16),
      gasPrice: 0,
      gasLimit,
      to: address,
      value: 1,
      data: "0x",
    });
    log.info(`canary ${address}: submitting nonce ${parseInt(nonceHex, 16)} as ${tx.hash}`);
    submittedAt = Date.now();
    const returned = await rpc("eth_sendRawTransaction", [tx.rawTx]);
    hash = typeof returned === "string" ? returned : tx.hash;
  });

  await synthetics.executeStep("awaitInclusion", async () => {
    const deadline = submittedAt + maxInclusion * 1000;
    let receipt = null;
    while (Date.now() < deadline) {
      receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (receipt) break;
      await sleep(1000);
    }
    const seconds = (Date.now() - submittedAt) / 1000;
    if (!receipt) {
      await putMetric("TxCanarySuccess", 0, "Count");
      throw new Error(`transaction ${hash} not included within ${maxInclusion}s`);
    }
    const ok = receipt.status === undefined || receipt.status === "0x1" || receipt.status === 1;
    await putMetric("TimeToInclusionSeconds", seconds, "Seconds");
    await putMetric("TxCanarySuccess", ok ? 1 : 0, "Count");
    log.info(`canary ${address}: ${hash} included in block ${receipt.blockNumber} after ${seconds.toFixed(1)}s, status ${receipt.status}`);
    if (!ok) throw new Error(`transaction ${hash} included but failed (status ${receipt.status}); is the canary address funded with the native token?`);
  });
};
