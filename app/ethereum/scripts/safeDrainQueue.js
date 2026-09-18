/**
 * Execute every pending custody-Safe proposal, in nonce order.
 *
 * WHY EXECUTE RATHER THAN REPLACE. Taking a nonce with your own transaction
 * makes the Safe service report the proposal sitting there as "rejected
 * (replaced by another tx)". The relayer reads that as a failed payout and
 * calls abortWithdrawalBatch, handing the user's escrow back and killing their
 * transfer. That is how MercataBridge withdrawal 317 died. Draining in order
 * settles the users and the solvers instead.
 *
 * Some proposals legitimately FAIL: a stale V1 mint for a withdrawal already
 * minted through V2 reverts DuplicateMint. A failure still consumes the nonce,
 * which is what unblocks everything queued behind it. The Safe reports that as
 * ExecutionFailure rather than reverting the outer call, so each result is read
 * from the logs.
 *
 *   PRIVATE_KEY unused; signs with ~/.secrets/strato-safe-owner
 *   node scripts/safeDrainQueue.js [--limit N] [--dry] [--only-nonce N]
 *
 * --only-nonce executes exactly ONE proposal, the one sitting at that nonce.
 * Preferred for anything that moves funds: one explicit action per invocation,
 * each auditable on its own, instead of a loop that settles eight at once.
 */
const { ethers } = require("ethers");
const fs = require("fs");

const SAFE = "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631";
const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
];
const SELECTORS = {
  "0x090a06d8": "mintRepresentationWithAttestation (V1)",
  "0x7527237c": "mintRepresentationWithAttestationV2",
  "0x134b6cae": "settleWithdrawal",
};

async function main() {
  const limit = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1])
    : 30;
  const dry = process.argv.includes("--dry");

  const apiKey = fs.readFileSync(`${__dirname}/../../backend/.env`, "utf8")
    .split("\n").find((l) => l.startsWith("SAFE_API_KEY="))
    ?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
  if (!apiKey) throw new Error("SAFE_API_KEY not found in app/backend/.env");

  const provider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  );
  try {
    const wallet = new ethers.Wallet(
      fs.readFileSync(`${process.env.HOME}/.secrets/strato-safe-owner`, "utf8").trim(),
      provider,
    );
    const safe = new ethers.Contract(SAFE, SAFE_ABI, wallet);
    const start = Number(await safe.nonce());
    console.log(`Safe ${SAFE} nonce ${start}, executor ${wallet.address}`);

    const res = await fetch(
      `https://api.safe.global/tx-service/sep/api/v1/safes/${SAFE}` +
        `/multisig-transactions/?executed=false&nonce__gte=${start}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    const body = await res.json();
    const pending = (body.results || []).sort((a, b) => a.nonce - b.nonce);
    console.log(`${pending.length} pending\n`);

    // "Approved hash" form: valid without any ECDSA signing when msg.sender is
    // the owner, so there is no EIP-712 domain to get wrong.
    const sig = ethers.concat([
      ethers.zeroPadValue(wallet.address, 32), ethers.zeroPadValue("0x00", 32), "0x01",
    ]);

    // --reject-nonce N: consume a nonce with a NO-OP (to the Safe itself, zero
    // value, empty calldata) instead of executing what is queued there.
    // REQUIRED for a proposal whose inner call reverts: the Safe raises GS013
    // and refuses the whole execTransaction rather than reporting
    // ExecutionFailure, so such a proposal can never be consumed by executing
    // it, and it blocks every nonce behind it. Only for a proposal that is
    // genuinely dead -- the relayer will see it as replaced.
    const rejectNonce = process.argv.includes("--reject-nonce")
      ? Number(process.argv[process.argv.indexOf("--reject-nonce") + 1])
      : null;
    if (rejectNonce !== null) {
      const at = Number(await safe.nonce());
      if (at !== rejectNonce) throw new Error(`chain is at nonce ${at}, not ${rejectNonce}`);
      const queued = pending.find((p) => p.nonce === rejectNonce);
      console.log(`  rejecting nonce ${rejectNonce}` +
        (queued ? ` (was ${SELECTORS[(queued.data || "").slice(0, 10)] || "unknown"} -> ${queued.to})` : ""));
      const tx = await safe.execTransaction(
        SAFE, 0, "0x", 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, sig, { gasLimit: 120000n },
      );
      const rcpt = await tx.wait();
      console.log(`  consumed nonce ${rejectNonce} in block ${rcpt.blockNumber}; Safe nonce now ${await safe.nonce()}`);
      return;
    }

    const onlyNonce = process.argv.includes("--only-nonce")
      ? Number(process.argv[process.argv.indexOf("--only-nonce") + 1])
      : null;

    let ok = 0, failed = 0;
    for (const p of pending) {
      if (onlyNonce !== null && p.nonce !== onlyNonce) continue;
      const at = Number(await safe.nonce());
      const label = `${p.nonce} -> ${p.to.slice(0, 12)} ${SELECTORS[(p.data || "").slice(0, 10)] || (p.data || "").slice(0, 10)}`;
      if (p.nonce !== at) {
        console.log(`  ${label}: skipped, chain is at nonce ${at}`);
        continue;
      }
      const args = [
        p.to, p.value || "0", p.data || "0x", p.operation ?? 0,
        p.safeTxGas || 0, p.baseGas || 0, p.gasPrice || 0,
        p.gasToken || ethers.ZeroAddress, p.refundReceiver || ethers.ZeroAddress, sig,
      ];
      if (dry) { console.log(`  ${label}: DRY`); continue; }
      try {
        // estimateGas can fail on a proposal whose inner call reverts, but the
        // Safe still needs executing to consume the nonce -- so fall back to a
        // fixed limit rather than skipping it.
        let gasLimit;
        try {
          const g = await safe.execTransaction.estimateGas(...args);
          gasLimit = g + g / 4n;
        } catch { gasLimit = 500000n; }
        const tx = await safe.execTransaction(...args, { gasLimit });
        const rcpt = await tx.wait();
        const bad = rcpt.logs.some(
          (l) => l.topics[0] === ethers.id("ExecutionFailure(bytes32,uint256)"),
        );
        if (bad) failed++; else ok++;
        console.log(`  ${label}: ${bad ? "ExecutionFailure (inner revert)" : "ExecutionSuccess"}  ${tx.hash}`);
      } catch (e) {
        console.log(`  ${label}: send failed ${(e.shortMessage || e.message).slice(0, 70)}`);
        break; // a stuck nonce blocks everything behind it
      }
    }
    console.log(`\n${ok} succeeded, ${failed} failed-but-consumed; Safe nonce now ${await safe.nonce()}`);
  } finally { provider.destroy(); }
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
