/**
 * Dry-run the fastPathPrepare Safe batch against a fork of the live chain.
 *
 *   FORK_RPC_URL=<rpc> BATCH=/tmp/fastpath-safe-batch-sepolia.json \
 *     npx hardhat run scripts/fastPathForkDryRun.js
 *
 * Why a fork rather than eth_call overrides: the batch is upgrade-then-
 * initialize, so call N+1 only makes sense against the code call N installed.
 * Public RPCs accept an eth_call state override and silently ignore it, which
 * produces confident nonsense -- an error selector from the OLD implementation
 * reported as though it came from the new one. A fork executes the calls in
 * order, as the Safe will.
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");

const SAFE = "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main() {
  if (!network.config.forking?.url) throw new Error("set FORK_RPC_URL");
  const path = process.env.BATCH || "/tmp/fastpath-safe-batch-sepolia.json";
  const calls = JSON.parse(fs.readFileSync(path, "utf8")).transactions;

  await network.provider.send("hardhat_impersonateAccount", [SAFE]);
  await network.provider.send("hardhat_setBalance", [SAFE, "0x21e19e0c9bab2400000"]);
  const safe = await ethers.getSigner(SAFE);

  // Every error the batch could plausibly raise, so a selector is reported by
  // name instead of as four opaque bytes.
  const errs = new ethers.Interface(
    [...new Set(
      ["contracts/bridge/DepositRouter.sol", "contracts/bridge/StratoNativeRepresentationBridge.sol"]
        .flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/error\s+([A-Za-z0-9_]+\([^)]*\))/g)].map((m) => `error ${m[1]}`)),
    )].concat([
      "error InvalidInitialization()", "error NotInitializing()",
      "error OwnableUnauthorizedAccount(address)",
      "error AccessControlUnauthorizedAccount(address,bytes32)",
    ]),
  );
  const explain = (e) => {
    const d = e?.data ?? e?.info?.error?.data;
    if (typeof d === "string" && d !== "0x") {
      try { const p = errs.parseError(d); if (p) return `${p.name}(${p.args.join(", ")})`; } catch {}
      if (d.startsWith("0x08c379a0")) {
        try { return `revert "${ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + d.slice(10))[0]}"`; } catch {}
      }
      return `unknown selector ${d.slice(0, 10)}`;
    }
    return e.shortMessage || e.message;
  };

  console.log(`fork of ${network.config.forking.url}`);
  console.log(`executing ${calls.length} calls sequentially as the Safe ${SAFE}\n`);

  let failed = false;
  for (const [i, c] of calls.entries()) {
    const implBefore = "0x" + (await ethers.provider.getStorage(c.to, IMPL_SLOT)).slice(26);
    try {
      const tx = await safe.sendTransaction({ to: c.to, data: c.data, value: BigInt(c.value) });
      const rcpt = await tx.wait();
      const implAfter = "0x" + (await ethers.provider.getStorage(c.to, IMPL_SLOT)).slice(26);
      const moved = implBefore !== implAfter ? `  impl ${implBefore} -> ${implAfter}` : "";
      console.log(`  [${i}] OK    gas ${rcpt.gasUsed}  ${c.label}${moved}`);
    } catch (e) {
      failed = true;
      console.log(`  [${i}] FAIL  ${c.label}\n        ${explain(e)}`);
      break; // MultiSend is atomic: everything after this is moot.
    }
  }
  console.log(failed ? "\nbatch would revert -- do not submit" : "\nbatch executes cleanly on fork");
}
main().catch((e) => { console.error(e); process.exit(1); });
