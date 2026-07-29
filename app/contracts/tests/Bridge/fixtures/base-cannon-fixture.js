/**
 * Cannon-path fixture for BaseLightClientCannon.test.sol.
 *
 * Same shape as base-fixture.js (OutputProposed path):
 *   - Real Base Sepolia block header (RLP-encoded; verified).
 *   - Real L2ToL1MessagePasser storage root (eth_getProof).
 *   - Synthetic L1 receipts trie containing one DisputeGameCreated log
 *     bound to the real Base block via the canonical outputRoot
 *     preimage.
 *
 * Why synthetic-L1: real DisputeGameCreated logs commit to *proposed*
 * outputRoots, which for unresolved games may not match the actual
 * Base state. Using a synthesized log lets us bind to a known-good
 * Base block we can verify independently.
 */
const Module = require("module");
const requireBackend = Module.createRequire(
  "/Users/dustinnorwood/BlockApps/pbbo/mercata/backend/package.json"
);
const ax = requireBackend("axios");
const { keccak_256 } = requireBackend("@noble/hashes/sha3");
const { RLP } = requireBackend("@ethereumjs/rlp");
const { Trie } = requireBackend("@ethereumjs/trie");

const baseRpcs = [
  "https://base-sepolia.publicnode.com",
  "https://sepolia.base.org",
  "https://base-sepolia-rpc.publicnode.com",
];

const MSG_PASSER = "0x4200000000000000000000000000000000000016";
// Base Sepolia DisputeGameFactory.
const FACTORY = "0xd6E6dBf4F7EA0ac412fD8b65ED297e64BB7a06E1";
const DISPUTE_GAME_CREATED_SIG =
  "0x5b565efe82411da98814f356d0e7bcb8f0219b8d970307c5afb4a6903a8b2e35";
// gameType 1 = Cannon (post-fault-proof, full validation).
const GAME_TYPE = 1;

function keccak256(b) {
  return Buffer.from(keccak_256(b));
}
const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);
const hexToBuf = (s) => Buffer.from(stripHex(s), "hex");

async function rpc(url, method, params) {
  const r = await ax.post(url, { jsonrpc: "2.0", id: 1, method, params });
  if (r.data.error) throw new Error(JSON.stringify(r.data.error));
  return r.data.result;
}
async function tryRpc(urls, method, params) {
  let lastErr;
  for (const u of urls) {
    try { return await rpc(u, method, params); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function rlpEncodeHeader(b) {
  const intToBuf = (h) => {
    if (h === undefined || h === null) return null;
    if (h === "0x0" || h === "0x") return Buffer.alloc(0);
    let s = stripHex(h);
    if (s.length === 0) return Buffer.alloc(0);
    if (s.length % 2) s = "0" + s;
    let buf = Buffer.from(s, "hex");
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    return buf.slice(i);
  };
  const bytesField = (h) => h ? hexToBuf(h) : null;
  const fields = [
    bytesField(b.parentHash), bytesField(b.sha3Uncles), bytesField(b.miner),
    bytesField(b.stateRoot), bytesField(b.transactionsRoot), bytesField(b.receiptsRoot),
    bytesField(b.logsBloom), intToBuf(b.difficulty), intToBuf(b.number),
    intToBuf(b.gasLimit), intToBuf(b.gasUsed), intToBuf(b.timestamp),
    bytesField(b.extraData), bytesField(b.mixHash), bytesField(b.nonce),
    intToBuf(b.baseFeePerGas),
  ];
  if (b.withdrawalsRoot !== undefined) fields.push(bytesField(b.withdrawalsRoot));
  if (b.blobGasUsed !== undefined) fields.push(intToBuf(b.blobGasUsed));
  if (b.excessBlobGas !== undefined) fields.push(intToBuf(b.excessBlobGas));
  if (b.parentBeaconBlockRoot !== undefined) fields.push(bytesField(b.parentBeaconBlockRoot));
  if (b.requestsHash !== undefined) fields.push(bytesField(b.requestsHash));
  return Buffer.from(RLP.encode(fields.filter((f) => f !== null)));
}

function rlpUint(n) { return Buffer.from(RLP.encode(BigInt(n))); }

// Build a synthetic DisputeGameCreated receipt:
//   topic[0] = sig
//   topic[1] = disputeProxy (address, padded to 32B)
//   topic[2] = gameType (uint32, padded to 32B)
//   topic[3] = rootClaim (bytes32 — the L2 outputRoot)
function encodeDisputeGameCreatedReceipt({ outputRoot, proxyAddr, gameType }) {
  const sig32 = hexToBuf(DISPUTE_GAME_CREATED_SIG);
  const u256 = (n) => Buffer.from(BigInt(n).toString(16).padStart(64, "0"), "hex");
  const addrAsU256 = (h) => Buffer.from(stripHex(h).padStart(64, "0"), "hex");
  const topics = [sig32, addrAsU256(proxyAddr), u256(gameType), hexToBuf(outputRoot)];
  // Empty data — DisputeGameCreated has no non-indexed args.
  const data = Buffer.alloc(0);
  const log = [hexToBuf(FACTORY), topics, data];
  const status = Buffer.from([0x01]);
  const cumulative = rlpUint(0xCAFE);
  const bloom = Buffer.alloc(256);
  const receipt = [status, cumulative, bloom, [log]];
  const rlpEncoded = Buffer.from(RLP.encode(receipt));
  return Buffer.concat([Buffer.from([0x02]), rlpEncoded]);
}

async function buildL1ReceiptsTrie(targetReceiptBytes) {
  const trie = new Trie();
  const dummy = (n) => {
    const status = Buffer.from([n & 1]);
    const cum = rlpUint(n * 1000);
    const bloom = Buffer.alloc(256);
    const data = Buffer.from(RLP.encode([status, cum, bloom, []]));
    return Buffer.concat([Buffer.from([0x02]), data]);
  };
  await trie.put(rlpUint(0), dummy(0));
  await trie.put(rlpUint(1), targetReceiptBytes);   // our target at txIndex 1
  await trie.put(rlpUint(2), dummy(2));
  await trie.put(rlpUint(3), dummy(3));
  const root = Buffer.from(trie.root());
  const proof = (await trie.createProof(rlpUint(1))).map((n) => Buffer.from(n));
  return { root, proof, txIndex: 1, logIndex: 0 };
}

(async () => {
  const tip = parseInt(await tryRpc(baseRpcs, "eth_blockNumber", []), 16);
  const target = tip - 50;
  const targetHex = "0x" + target.toString(16);
  const block = await tryRpc(baseRpcs, "eth_getBlockByNumber", [targetHex, false]);
  const proofResp = await tryRpc(baseRpcs, "eth_getProof", [MSG_PASSER, [], targetHex]);
  const withdrawalStorageRoot = proofResp.storageHash;

  const headerRLP = rlpEncodeHeader(block);
  const computedHash = "0x" + keccak256(headerRLP).toString("hex");
  if (computedHash !== block.hash.toLowerCase()) {
    throw new Error(`header RLP mismatch: ${computedHash} vs ${block.hash}`);
  }

  const preimage = Buffer.concat([
    Buffer.from([0x00]),
    hexToBuf(block.stateRoot),
    hexToBuf(withdrawalStorageRoot),
    hexToBuf(block.hash),
  ]);
  const outputRoot = "0x" + keccak256(preimage).toString("hex");

  // Use the real Base Sepolia DisputeGameFactory dispute proxy address as
  // a plausible test value — bytes get encoded into the synthesized log.
  const PROXY = "0xb9c83f8d89c4d13ed3b93021f90d59d57bdda6c1";
  const recBytes = encodeDisputeGameCreatedReceipt({
    outputRoot,
    proxyAddr: PROXY,
    gameType: GAME_TYPE,
  });
  const { root: l1Root, proof: l1Proof, txIndex, logIndex } =
    await buildL1ReceiptsTrie(recBytes);

  // Emit Solidity-ready output.
  console.log(`// === Generated by /tmp/base-cannon-fixture.js ===`);
  console.log(`// Captured from Base Sepolia at block ${parseInt(block.number, 16)} (${block.number})`);
  console.log(`//`);
  console.log(`// Real Base header fields:`);
  console.log(`//   block.hash         = ${block.hash}`);
  console.log(`//   block.stateRoot    = ${block.stateRoot}`);
  console.log(`//   block.receiptsRoot = ${block.receiptsRoot}`);
  console.log(`// withdrawalStorageRoot = ${withdrawalStorageRoot}`);
  console.log(`// outputRoot           = ${outputRoot}`);
  console.log(`//`);
  console.log(`// L1: synthetic DisputeGameCreated log carrying the above outputRoot.`);
  console.log(`// FACTORY    = ${FACTORY}`);
  console.log(`// PROXY      = ${PROXY}`);
  console.log(`// gameType   = ${GAME_TYPE} (Cannon)`);
  console.log(``);
  console.log(`uint256 constant L1_BLOCK_NUMBER = 12345;`);
  console.log(`uint256 constant TX_INDEX  = ${txIndex};`);
  console.log(`uint256 constant LOG_INDEX = ${logIndex};`);
  console.log(`uint256 constant BASE_BLOCK_NUMBER = ${parseInt(block.number, 16)};`);
  console.log(``);
  console.log(`function _l1ReceiptsRoot() internal pure returns (bytes32) {`);
  console.log(`    return bytes32(hex"${l1Root.toString("hex")}");`);
  console.log(`}`);
  console.log(`function _expectedBaseReceiptsRoot() internal pure returns (bytes32) {`);
  console.log(`    return bytes32(hex"${stripHex(block.receiptsRoot)}");`);
  console.log(`}`);
  console.log(`function _withdrawalStorageRoot() internal pure returns (bytes32) {`);
  console.log(`    return bytes32(hex"${stripHex(withdrawalStorageRoot)}");`);
  console.log(`}`);
  console.log(``);
  console.log(`function _baseHeaderRLP() internal pure returns (bytes) {`);
  console.log(`    return hex"${headerRLP.toString("hex")}";`);
  console.log(`}`);
  console.log(``);
  console.log(`function _receiptValueBytes() internal pure returns (bytes) {`);
  console.log(`    return hex"${recBytes.toString("hex")}";`);
  console.log(`}`);
  console.log(``);
  console.log(`function _mptProof() internal pure returns (bytes[] memory proof) {`);
  console.log(`    proof = new bytes[](${l1Proof.length});`);
  l1Proof.forEach((n, i) => {
    console.log(`    proof[${i}] = hex"${n.toString("hex")}";`);
  });
  console.log(`}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
