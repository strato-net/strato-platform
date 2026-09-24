/**
 * Execute a Safe batch file through the custody Safe.
 *
 * This is the missing last step of scripts/fastPathPrepare.js and
 * scripts/fastPathDisable.js, which write a batch and stop. Dry-run by default;
 * nothing is sent without --execute.
 *
 *   node scripts/safeExecBatch.js <sepolia|baseSepolia> [--batch <file>] [--execute]
 *
 * BEFORE --execute, check the queue: `node scripts/safeDrainQueue.js --dry`.
 * Executing directly takes the Safe's next nonce, and a relayer proposal
 * sitting at that nonce is then reported "replaced", which the relayer reads
 * as a failed payout. Run scripts/fastPathForkDryRun.js too: the Safe reports
 * an inner revert only as GS013, with no hint of which call failed.
 *
 *
 * The Safe is threshold 1 and this key is an owner, so it executes directly
 * rather than queueing: a proposal left unexecuted at a nonce jams every later
 * proposal, and the queue on this Safe is already 235 dead entries deep.
 *
 * Signature is the Safe "approved hash" form (v=1, r=owner, s=0), valid when
 * msg.sender is the owner. That avoids hand-rolling the EIP-712 domain, which
 * is the usual source of a GS026 with a correct-looking signature.
 */
const { ethers } = require("ethers");
const fs = require("fs");

const SAFE = "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631";
// Safe 1.4.1 MultiSendCallOnly: performs CALLs only, so a buggy `to` can never
// delegatecall its way into the Safe's own storage.
const MULTISEND_CALL_ONLY = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";

const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getThreshold() view returns (uint256)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
];
const MS_ABI = ["function multiSend(bytes transactions) payable"];

function encodeMultiSend(calls) {
  return ethers.concat(calls.map((c) => ethers.solidityPacked(
    ["uint8", "address", "uint256", "uint256", "bytes"],
    [0, c.to, BigInt(c.value), ethers.dataLength(c.data), c.data],
  )));
}

async function main() {
  const net = process.argv[2];
  const execute = process.argv.includes("--execute");
  const batchPath = process.argv.includes("--batch")
    ? process.argv[process.argv.indexOf("--batch") + 1]
    : `/tmp/fastpath-safe-batch-${net}.json`;
  const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
  const calls = batch.transactions;

  const rpc = net === "sepolia"
    ? (process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com")
    : (process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
  const provider = new ethers.JsonRpcProvider(rpc);
  try {
    const wallet = new ethers.Wallet(fs.readFileSync(process.env.HOME + "/.secrets/strato-safe-owner", "utf8").trim(), provider);
    const safe = new ethers.Contract(SAFE, SAFE_ABI, wallet);

    const msCode = await provider.getCode(MULTISEND_CALL_ONLY);
    if (msCode === "0x") throw new Error(`no MultiSendCallOnly at ${MULTISEND_CALL_ONLY} on ${net}`);

    console.log(`Safe ${SAFE} version ${await safe.VERSION()} threshold ${await safe.getThreshold()} nonce ${await safe.nonce()}`);
    console.log(`owner/executor ${wallet.address}`);
    console.log(`batching ${calls.length} calls through MultiSendCallOnly\n`);
    calls.forEach((c, i) => console.log(`  [${i}] ${c.label}`));

    const data = new ethers.Interface(MS_ABI).encodeFunctionData("multiSend", [encodeMultiSend(calls)]);
    const sig = ethers.concat([
      ethers.zeroPadValue(wallet.address, 32), ethers.zeroPadValue("0x00", 32), "0x01",
    ]);
    const args = [MULTISEND_CALL_ONLY, 0, data, 1, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, sig];

    // Dry run against live state first. execTransaction swallows an inner
    // revert and returns false rather than throwing, so check the return value
    // -- a bare "did not throw" proves nothing here.
    const ok = await safe.execTransaction.staticCall(...args);
    console.log(`\nsimulation: execTransaction returns ${ok}`);
    if (!ok) throw new Error("simulation returned false -- one of the inner calls reverts; not sending");

    if (!execute) { console.log("\ndry run only; pass --execute to send"); return; }

    const gas = await safe.execTransaction.estimateGas(...args);
    const tx = await safe.execTransaction(...args, { gasLimit: gas + gas / 5n });
    console.log(`\nsent ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`mined in block ${rcpt.blockNumber}, status ${rcpt.status}, gas used ${rcpt.gasUsed}`);
    // ExecutionSuccess vs ExecutionFailure is the Safe's own verdict.
    const failed = rcpt.logs.some((l) => l.topics[0] === ethers.id("ExecutionFailure(bytes32,uint256)"));
    console.log(failed ? "Safe reported ExecutionFailure" : "Safe reported ExecutionSuccess");
  } finally { provider.destroy(); }
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
