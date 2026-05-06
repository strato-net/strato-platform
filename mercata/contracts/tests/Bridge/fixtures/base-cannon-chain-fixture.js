/**
 * Cannon parent-chain fixture for BaseLightClientChain.test.sol.
 *
 *   - Real Base Sepolia anchor block + N consecutive parent headers
 *     (RLP-encoded; round-trip-verified via keccak == block.hash).
 *   - Real L2ToL1MessagePasser storage root for the anchor block.
 *   - Synthetic L1 receipts trie carrying one DisputeGameCreated log
 *     bound to the anchor block via the canonical outputRoot preimage.
 *
 * The N parent headers exercise BaseLightClient.anchorBaseBlockChainViaCannon's
 * walk: each header's keccak must equal the previous child's parentHash;
 * each header's number must be contiguous (anchor.number, anchor.number-1, …).
 */
const Module = require("module");
const requireBackend = Module.createRequire(
  "/Users/dustinnorwood/BlockApps/pbbo/mercata/backend/package.json"
);
const ax = requireBackend("axios");
const { keccak_256 } = requireBackend("@noble/hashes/sha3");
const { RLP } = requireBackend("@ethereumjs/rlp");
const { Trie } = requireBackend("@ethereumjs/trie");

/** Number of parent headers to walk back from the anchor. */
const CHAIN_DEPTH = 8;

const baseRpcs = [
  "https://base-sepolia.publicnode.com",
  "https://sepolia.base.org",
  "https://base-sepolia-rpc.publicnode.com",
];

const MSG_PASSER = "0x4200000000000000000000000000000000000016";
const FACTORY = "0xd6E6dBf4F7EA0ac412fD8b65ED297e64BB7a06E1";
const DISPUTE_GAME_CREATED_SIG =
  "0x5b565efe82411da98814f356d0e7bcb8f0219b8d970307c5afb4a6903a8b2e35";
const GAME_TYPE = 1;

const k256 = (b) => Buffer.from(keccak_256(b));
const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);
const hexToBuf = (s) => Buffer.from(stripHex(s), "hex");

async function rpc(url, m, p) {
  const r = await ax.post(url, { jsonrpc: "2.0", id: 1, method: m, params: p });
  if (r.data.error) throw new Error(JSON.stringify(r.data.error));
  return r.data.result;
}
async function tryRpc(urls, m, p) {
  let last;
  for (const u of urls) { try { return await rpc(u, m, p); } catch (e) { last = e; } }
  throw last;
}

function rlpEncodeHeader(b) {
  const intToBuf = (h) => {
    if (h === undefined || h === null || h === "0x" || h === "0x0") return Buffer.alloc(0);
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

function encodeDgcReceipt({ outputRoot, proxyAddr, gameType }) {
  const sig32 = hexToBuf(DISPUTE_GAME_CREATED_SIG);
  const u256 = (n) => Buffer.from(BigInt(n).toString(16).padStart(64, "0"), "hex");
  const addrAsU256 = (h) => Buffer.from(stripHex(h).padStart(64, "0"), "hex");
  const topics = [sig32, addrAsU256(proxyAddr), u256(gameType), hexToBuf(outputRoot)];
  const log = [hexToBuf(FACTORY), topics, Buffer.alloc(0)];
  const receipt = [Buffer.from([0x01]), rlpUint(0xCAFE), Buffer.alloc(256), [log]];
  return Buffer.concat([Buffer.from([0x02]), Buffer.from(RLP.encode(receipt))]);
}

async function buildL1ReceiptsTrie(targetReceiptBytes) {
  const trie = new Trie();
  const dummy = (n) => {
    const data = Buffer.from(RLP.encode([
      Buffer.from([n & 1]), rlpUint(n * 1000), Buffer.alloc(256), [],
    ]));
    return Buffer.concat([Buffer.from([0x02]), data]);
  };
  await trie.put(rlpUint(0), dummy(0));
  await trie.put(rlpUint(1), targetReceiptBytes);
  await trie.put(rlpUint(2), dummy(2));
  const root = Buffer.from(trie.root());
  const proof = (await trie.createProof(rlpUint(1))).map((n) => Buffer.from(n));
  return { root, proof, txIndex: 1, logIndex: 0 };
}

(async () => {
  // 1. Pick a finalized Base Sepolia block to anchor; fetch CHAIN_DEPTH+1
  //    consecutive headers (anchor + parents).
  const tip = parseInt(await tryRpc(baseRpcs, "eth_blockNumber", []), 16);
  const anchorNum = tip - 50;
  const headers = [];
  for (let i = 0; i <= CHAIN_DEPTH; i++) {
    const num = anchorNum - i;
    const block = await tryRpc(baseRpcs, "eth_getBlockByNumber", ["0x" + num.toString(16), false]);
    headers.push(block);
  }
  const anchor = headers[0];

  // 2. Verify each header's RLP encoding round-trips to the published hash;
  //    also verify the parentHash chain links each pair.
  const headerRLPs = headers.map(rlpEncodeHeader);
  for (let i = 0; i < headers.length; i++) {
    const computed = "0x" + k256(headerRLPs[i]).toString("hex");
    if (computed.toLowerCase() !== headers[i].hash.toLowerCase()) {
      throw new Error(`header[${i}] RLP mismatch: ${computed} vs ${headers[i].hash}`);
    }
    if (i > 0) {
      const expectedParent = headers[i - 1].parentHash;
      const actualHash = headers[i].hash;
      if (expectedParent.toLowerCase() !== actualHash.toLowerCase()) {
        throw new Error(`parent chain broken at ${i}: ${expectedParent} != ${actualHash}`);
      }
    }
  }

  // 3. withdrawalStorageRoot for the anchor block.
  const proofResp = await tryRpc(baseRpcs, "eth_getProof",
    [MSG_PASSER, [], "0x" + anchorNum.toString(16)]);
  const withdrawalStorageRoot = proofResp.storageHash;

  // 4. Compute outputRoot for the anchor block.
  const preimage = Buffer.concat([
    Buffer.from([0x00]),
    hexToBuf(anchor.stateRoot),
    hexToBuf(withdrawalStorageRoot),
    hexToBuf(anchor.hash),
  ]);
  const outputRoot = "0x" + k256(preimage).toString("hex");

  // 5. Synthetic L1 DGC receipt + MPT proof.
  const PROXY = "0xb9c83f8d89c4d13ed3b93021f90d59d57bdda6c1";
  const recBytes = encodeDgcReceipt({ outputRoot, proxyAddr: PROXY, gameType: GAME_TYPE });
  const { root: l1Root, proof: l1Proof, txIndex, logIndex } =
    await buildL1ReceiptsTrie(recBytes);

  // 6. Emit Solidity-ready output.
  const sl = (s) => stripHex(s);
  console.log(`// === Generated by base-cannon-chain-fixture.js ===`);
  console.log(`// Anchor block ${anchorNum} + ${CHAIN_DEPTH} parents (${anchorNum - CHAIN_DEPTH}..${anchorNum}).`);
  console.log(`// Real Base Sepolia data; synthetic L1 DGC log bound to the anchor.`);
  console.log(``);
  console.log(`uint256 constant L1_BLOCK_NUMBER = 12345;`);
  console.log(`uint256 constant TX_INDEX  = ${txIndex};`);
  console.log(`uint256 constant LOG_INDEX = ${logIndex};`);
  console.log(`uint256 constant ANCHOR_BLOCK_NUMBER = ${anchorNum};`);
  console.log(`uint256 constant OLDEST_BLOCK_NUMBER = ${anchorNum - CHAIN_DEPTH};`);
  console.log(`uint256 constant CHAIN_DEPTH = ${CHAIN_DEPTH};`);
  console.log(``);
  console.log(`function _l1ReceiptsRoot() internal pure returns (bytes32) {`);
  console.log(`    return bytes32(hex"${l1Root.toString("hex")}");`);
  console.log(`}`);
  console.log(`function _withdrawalStorageRoot() internal pure returns (bytes32) {`);
  console.log(`    return bytes32(hex"${sl(withdrawalStorageRoot)}");`);
  console.log(`}`);
  console.log(`function _anchorReceiptsRoot() internal pure returns (bytes32) {`);
  console.log(`    return bytes32(hex"${sl(anchor.receiptsRoot)}");`);
  console.log(`}`);
  console.log(``);
  console.log(`function _anchorHeaderRLP() internal pure returns (bytes) {`);
  console.log(`    return hex"${headerRLPs[0].toString("hex")}";`);
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
  console.log(``);
  console.log(`function _parentChain() internal pure returns (bytes[] memory chain) {`);
  console.log(`    chain = new bytes[](${CHAIN_DEPTH});`);
  for (let i = 1; i <= CHAIN_DEPTH; i++) {
    console.log(`    chain[${i - 1}] = hex"${headerRLPs[i].toString("hex")}";`);
  }
  console.log(`}`);
  console.log(``);
  console.log(`function _expectedParentReceiptsRoots() internal pure returns (bytes32[] memory rs) {`);
  console.log(`    rs = new bytes32[](${CHAIN_DEPTH});`);
  for (let i = 1; i <= CHAIN_DEPTH; i++) {
    console.log(`    rs[${i - 1}] = bytes32(hex"${sl(headers[i].receiptsRoot)}");`);
  }
  console.log(`}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
