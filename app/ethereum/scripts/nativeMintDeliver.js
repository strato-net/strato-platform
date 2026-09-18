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
 * The signer must be registered in `attestationSigners` on the destination
 * bridge and the sender must hold MINT_EXECUTOR_ROLE. Both are checked before
 * anything is sent, because a mint that reverts after signing looks identical
 * to a bad signature and sends you hunting the wrong thing.
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
  "function hasRole(bytes32,address) view returns (bool)",
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

    console.log(`\nminting ${ethers.formatUnits(attestation.amount, 18)} to ${attestation.recipient}`);
    // staticCall first: this surfaces DuplicateMint, a bad digest, or a missing
    // MINT_EXECUTOR_ROLE as a named error instead of a burned transaction.
    await bridge.mintRepresentationWithAttestationV2.staticCall(attestation, signatures);
    console.log("simulation ok");

    const tx = await bridge.mintRepresentationWithAttestationV2(attestation, signatures);
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
