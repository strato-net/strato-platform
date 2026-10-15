#!/usr/bin/env node
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const {
  readJson,
  loadBridgeInterfaces,
  decodeCall,
  buildSafeTransaction,
  signatureRecord,
  executeSignedBatch,
} = require("./lib/safeBatchExecutor");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, signatures: [] };
  const allowed = new Set(["--file", "--chain-id", "--safe", "--rpc-url", "--output", "--signature", "--confirm"]);
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (!allowed.has(value) || !rest[i + 1] || rest[i + 1].startsWith("--")) {
      throw new Error(`Invalid argument: ${value}`);
    }
    if (value === "--signature") args.signatures.push(rest[++i]);
    else args[value.slice(2)] = rest[++i];
  }
  if (!["inspect", "sign", "execute"].includes(command) || !args.file || !args["chain-id"] || !args.safe) {
    throw new Error("Usage: npm run safe:batch -- <inspect|sign|execute> --file <batch.safe.json> --chain-id <id> --safe <address>");
  }
  return args;
}

function privateKey(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.startsWith("0x") ? value : `0x${value}`;
}

function review(context) {
  const interfaces = loadBridgeInterfaces();
  return {
    chainId: context.chainId,
    safeAddress: context.safeAddress,
    owners: context.owners,
    threshold: context.threshold,
    nonce: context.nonce,
    currentNonce: context.currentNonce,
    safeTxHash: context.safeTxHash,
    transactions: context.transactions.map(({ to, value, data }, index) => ({
      number: index + 1,
      to,
      value,
      selector: data.length >= 10 ? data.slice(0, 10) : data,
      data,
      decoded: decodeCall(data, interfaces),
    })),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const batch = readJson(path.resolve(args.file));
  const expected = {
    chainId: args["chain-id"],
    safeAddress: args.safe,
    rpcUrl: args["rpc-url"],
  };

  if (args.command === "inspect") {
    console.log(JSON.stringify(review(await buildSafeTransaction(batch, expected)), null, 2));
    return;
  }

  if (args.command === "sign") {
    const signer = new ethers.Wallet(privateKey("SAFE_OWNER_PRIVATE_KEY"));
    const context = await buildSafeTransaction(batch, { ...expected, signer: signer.privateKey });
    console.log(JSON.stringify(review(context), null, 2));
    const record = signatureRecord(context, await context.protocolKit.signHash(context.safeTxHash));
    const output = path.resolve(args.output || `${args.file}.${record.signer}.signature.json`);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(output, 0o600);
    console.log(JSON.stringify({ status: "SIGNED", signer: record.signer, file: output }, null, 2));
    return;
  }

  if (args.signatures.length === 0 || !args.confirm) {
    throw new Error("Execute requires one --signature per owner signature and --confirm <safeTxHash>");
  }
  const records = args.signatures.map(file => readJson(path.resolve(file)));
  const nonce = records[0]?.nonce;
  const signer = new ethers.Wallet(privateKey("SAFE_TX_EXECUTOR_PRIVATE_KEY"));
  const context = await buildSafeTransaction(batch, {
    ...expected,
    signer: signer.privateKey,
    executorAddress: signer.address,
    nonce,
  });
  console.log(JSON.stringify(review(context), null, 2));
  const result = await executeSignedBatch(context, records, args.confirm);
  console.log(JSON.stringify({ status: "EXECUTED", ...result }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, review, main };
