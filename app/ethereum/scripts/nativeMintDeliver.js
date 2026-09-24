/**
 * Deliver a STRATO native withdrawal on the external chain: sign the mint
 * attestation and call the representation bridge.
 *
 * This is the leg the relayer normally performs. It is written as a standalone
 * script because the helium relayer has been dormant on this route since
 * 2026-07-20, so a withdrawal requested today is never delivered unless
 * something does this by hand.
 *
 *   ATTESTATION_SIGNER_KEY=<hex> node scripts/nativeMintDeliver.js <withdrawal.json>
 *
 * THE MINT IS EXECUTED BY THE CUSTODY SAFE, never by a hot key. There used to
 * be a MINT_EXECUTOR_ROLE that let a single key mint directly; it was revoked
 * and removed because it allowed representation supply to be created with no
 * Safe proposal at all. So this script only SIGNS the attestation with the
 * signer key; the mint call itself is sent through the Safe by a Safe owner
 * (~/.secrets/strato-safe-owner). The signer must be registered in
 * `attestationSigners`; that is checked before anything is sent.
 *
 * <withdrawal.json> is what scripts bridgeOut.ts emits:
 *   { withdrawalId, stratoToken, representationToken, recipient, amount,
 *     requestedAt, maxFee, feeHalfLife }
 */
const { ethers } = require("ethers");
const fs = require("fs");

// Verified on chain from the mint at Sepolia block 11312363, rather than taken
// from the relayer's test fixtures, which use an unrelated placeholder.
const STRATO_CHAIN_ID = 114784819836269n;
const STRATO_NATIVE_BRIDGE = "0x49f69252b00235030A4Dcd4C7EF17a64eF346258";
const REP_BRIDGE = "0x80f6497e8f8700c89b3a0b030c3e71aa874f6cf7";
const DEST_CHAIN_ID = 11155111n;

const V1_FIELDS = [
  { name: "sourceChainId", type: "uint256" },
  { name: "sourceBridge", type: "address" },
  { name: "destinationChainId", type: "uint256" },
  { name: "destinationBridge", type: "address" },
  { name: "sourceWithdrawalId", type: "uint256" },
  { name: "stratoToken", type: "address" },
  { name: "representationToken", type: "address" },
  { name: "recipient", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "notBefore", type: "uint256" },
  { name: "deadline", type: "uint256" },
];
const V2_TYPES = {
  NativeMintAttestationV2: [
    ...V1_FIELDS,
    { name: "maxFee", type: "uint256" },
    { name: "requestedAt", type: "uint256" },
    { name: "feeHalfLife", type: "uint256" },
  ],
};

const ABI = [
  "function mintRepresentationWithAttestationV2((uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,uint256 maxFee,uint256 requestedAt,uint256 feeHalfLife) attestation, bytes[] signatures)",
  "function attestationSigners(address) view returns (bool)",
  "function attestationThreshold() view returns (uint8)",
  "function routeActive(address) view returns (bool)",
  "function mintsPaused() view returns (bool)",
];

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: nativeMintDeliver.js <withdrawal.json>");
  const w = JSON.parse(fs.readFileSync(file, "utf8"));
  const key = process.env.ATTESTATION_SIGNER_KEY;
  if (!key) throw new Error("set ATTESTATION_SIGNER_KEY");

  const provider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  );
  try {
    const signer = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
    const bridge = new ethers.Contract(REP_BRIDGE, ABI, signer);

    const now = Math.floor(Date.now() / 1000);
    const attestation = {
      sourceChainId: STRATO_CHAIN_ID,
      sourceBridge: STRATO_NATIVE_BRIDGE,
      destinationChainId: DEST_CHAIN_ID,
      destinationBridge: ethers.getAddress(REP_BRIDGE),
      sourceWithdrawalId: BigInt(w.withdrawalId),
      stratoToken: ethers.getAddress(w.stratoToken),
      representationToken: ethers.getAddress(w.representationToken),
      recipient: ethers.getAddress(w.recipient),
      amount: BigInt(w.amount),
      // Default to the request time, NOT the local clock. `notBefore` is
      // compared against block.timestamp, and a local clock even slightly
      // ahead of the chain's latest block makes the mint revert
      // AttestationNotReady() -- which reads as "the review window has not
      // elapsed" when the real cause is clock skew of a second or two. The
      // request time is unambiguously in the past, and the review window is
      // enforced on the STRATO side regardless.
      notBefore: BigInt(w.notBefore ?? w.requestedAt ?? now),
      // Well inside maxAttestationValiditySeconds (7 days on this bridge).
      deadline: BigInt(w.deadline ?? now + 3600),
      maxFee: BigInt(w.maxFee ?? 0),
      requestedAt: BigInt(w.requestedAt ?? now),
      feeHalfLife: BigInt(w.feeHalfLife ?? 0),
    };

    // Pre-flight. Each of these failing produces a revert that is easy to
    // misread as a signature problem.
    const [registered, threshold, active, paused] = await Promise.all([
      bridge.attestationSigners(signer.address),
      bridge.attestationThreshold(),
      bridge.routeActive(attestation.stratoToken),
      bridge.mintsPaused(),
    ]);
    console.log(`signer ${signer.address} registered=${registered} threshold=${threshold}`);
    console.log(`route ${attestation.stratoToken} active=${active} mintsPaused=${paused}`);
    if (!registered) throw new Error("signer is not a registered attestation signer");
    if (Number(threshold) > 1) throw new Error(`threshold is ${threshold}; this script signs with one key`);
    if (!active) throw new Error("route is not active");
    if (paused) throw new Error("mints are paused");

    const signature = await signer.signTypedData(
      {
        name: "StratoNativeRepresentationBridge",
        version: "1",
        chainId: DEST_CHAIN_ID,
        verifyingContract: ethers.getAddress(REP_BRIDGE),
      },
      V2_TYPES,
      attestation,
    );
    const signatures = [ethers.Signature.from(signature).serialized];

    console.log(`\nminting ${ethers.formatUnits(attestation.amount, 18)} to ${attestation.recipient} via the custody Safe`);
    const SAFE = "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631";
    const owner = new ethers.Wallet(
      fs.readFileSync(`${process.env.HOME}/.secrets/strato-safe-owner`, "utf8").trim(), provider);
    const safe = new ethers.Contract(SAFE, [
      "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
    ], owner);
    const data = bridge.interface.encodeFunctionData(
      "mintRepresentationWithAttestationV2", [attestation, signatures]);

    // Simulate the mint AS THE SAFE first: this names DuplicateMint or a bad
    // digest, where the Safe itself would only say GS013.
    await provider.call({ from: SAFE, to: REP_BRIDGE, data });
    console.log("simulation ok");

    const sig = ethers.concat([ethers.zeroPadValue(owner.address, 32), ethers.zeroPadValue("0x00", 32), "0x01"]);
    const args = [REP_BRIDGE, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, sig];
    const gas = await safe.execTransaction.estimateGas(...args);
    const tx = await safe.execTransaction(...args, { gasLimit: (gas * 13n) / 10n });
    console.log(`sent ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`mined in block ${rcpt.blockNumber}, status ${rcpt.status}`);
    fs.writeFileSync(
      file.replace(/\.json$/, ".delivered.json"),
      JSON.stringify({ ...w, mintTxHash: tx.hash, mintBlock: rcpt.blockNumber }, null, 2),
    );
    console.log(`\nNow close the STRATO record: finalizeWithdrawal(${w.withdrawalId}, "${tx.hash}", "")`);
  } finally { provider.destroy(); }
}
main().catch((e) => {
  const d = e?.data ?? e?.info?.error?.data;
  console.error(e.shortMessage || e.message);
  if (typeof d === "string" && d !== "0x") console.error(`revert data ${d.slice(0, 10)}`);
  process.exit(1);
});
