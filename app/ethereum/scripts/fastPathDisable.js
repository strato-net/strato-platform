/**
 * Close the fast path on the EVM chains until the relayer image understands it.
 *
 * WHY BOTH FLAGS. The routers were upgraded ahead of the relayer, which still
 * runs an image compiling in only `DepositRouted` and `DepositRoutedWithAction`:
 *
 *   feeBpsCeiling -> 0   `depositWithFee` emits ONLY `DepositRoutedWithFee`, so
 *                        the running relayer cannot see it: the router takes the
 *                        depositor's tokens into custody and nothing ever
 *                        relays them. isFeeCapAllowed returns false when the
 *                        ceiling is 0, so any real fee now reverts FeeTooLarge.
 *
 *   enableFills -> false `fillWithdrawal` is worse than unserviced. A solver
 *                        would pay the recipient, and the old relayer -- which
 *                        knows nothing of claims or routed settlement -- would
 *                        then propose a direct transfer to that same recipient.
 *                        The recipient is paid twice and the solver eats it.
 *
 * The half-life is preserved: it must satisfy isHalfLifeAllowed, and keeping it
 * means re-enabling is a one-field change back to the ceiling.
 *
 * REVERSIBLE: re-run with --enable once the new relayer image is deployed.
 *
 *   node scripts/fastPathDisable.js <sepolia|baseSepolia> [--enable] [--only <Name>]
 *
 * --only targets ONE contract. The two flags are not equally risky and should
 * not always move together: re-enabling fills on the representation bridge is
 * safe even against the old relayer, because settlement there is the attested
 * mint and a V1 mint REVERTS ClaimExists() when a claim exists, so it cannot
 * pay twice. The DepositRouter has no such interlock -- the old relayer would
 * propose a direct transfer to a recipient a solver has already paid.
 */
const { ethers } = require("ethers");
const fs = require("fs");

const SAFE = "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631";
const HALF_LIFE = 21600;
const CEILING_WHEN_LIVE = 500;

const TARGETS = {
  sepolia: {
    chainId: 11155111,
    contracts: [
      { name: "DepositRouter", address: "0x1f0457d1d8c3f0da3e579be3843dd6e093163b84" },
      { name: "StratoNativeRepresentationBridge", address: "0x80f6497e8f8700c89b3a0b030c3e71aa874f6cf7" },
    ],
  },
  baseSepolia: {
    chainId: 84532,
    contracts: [
      { name: "DepositRouter", address: "0x35fa3e487f0edfdfda90ecfec15399bdb8bba199" },
    ],
  },
};

function main() {
  const net = process.argv[2];
  const enable = process.argv.includes("--enable");
  const cfg = TARGETS[net];
  if (!cfg) throw new Error(`usage: fastPathDisable.js <${Object.keys(TARGETS).join("|")}> [--enable]`);

  const fillsOnly = process.argv.includes("--fills-only");
  const ceiling = enable && !fillsOnly ? CEILING_WHEN_LIVE : 0;
  const fills = enable;
  const iface = new ethers.Interface([
    "function setFeeConfig(uint64 halfLifeSeconds,uint16 feeBpsCeiling,bool enableFills)",
  ]);

  const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]
    : null;
  const chosen = only ? cfg.contracts.filter((c) => c.name === only) : cfg.contracts;
  if (chosen.length === 0) {
    throw new Error(`--only ${only} matched nothing; have ${cfg.contracts.map((c) => c.name).join(", ")}`);
  }

  const transactions = chosen.map((c) => ({
    label: `${c.name}.setFeeConfig(${HALF_LIFE}, ${ceiling}, ${fills})`,
    to: c.address,
    value: "0",
    data: iface.encodeFunctionData("setFeeConfig", [HALF_LIFE, ceiling, fills]),
  }));

  const out = { safe: SAFE, chainId: cfg.chainId, transactions };
  const suffix = only ? `-${only}` : "";
  const path = `/tmp/fastpath-${enable ? "enable" : "disable"}-${net}${suffix}.json`;
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`${enable ? "RE-ENABLING" : "DISABLING"} the fast path on ${net}`);
  transactions.forEach((t, i) => console.log(`  [${i}] ${t.label}\n      to ${t.to}`));
  console.log(`\nwritten: ${path}`);
}
main();
