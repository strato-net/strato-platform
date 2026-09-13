// A signed STRATO transaction, Ethereum legacy shape with an EIP-155 v,
// exactly as the app's wallet path builds it (app/ui/src/lib/stratoWallet.ts)
// and as the node decodes it (Blockchain.Data.TransactionDef). A native
// transfer of value > 0 with empty data runs the native token's transfer,
// which is the cheapest transaction that exercises the whole pipeline.
const { secp256k1 } = require("@noble/curves/secp256k1");
const { keccak_256 } = require("@noble/hashes/sha3");

const strip0x = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const hexToBytes = (h) => {
  const s = strip0x(h);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Minimal big-endian bytes of a non-negative integer; empty for zero (RLP's scalar rule). */
const intToBytes = (n) => {
  const v = BigInt(n);
  if (v < 0n) throw new Error("negative scalar");
  if (v === 0n) return new Uint8Array(0);
  let h = v.toString(16);
  if (h.length % 2) h = "0" + h;
  return hexToBytes(h);
};

const concat = (arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

const rlpLength = (len, offset) => {
  if (len < 56) return new Uint8Array([offset + len]);
  const lenBytes = intToBytes(len);
  return concat([new Uint8Array([offset + 55 + lenBytes.length]), lenBytes]);
};

/** RLP encode a byte string or a (nested) list of them. */
const rlpEncode = (item) => {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0] < 0x80) return item;
    return concat([rlpLength(item.length, 0x80), item]);
  }
  const body = concat(item.map(rlpEncode));
  return concat([rlpLength(body.length, 0xc0), body]);
};

const keccak = (bytes) => keccak_256(bytes);

const addressFromPrivateKey = (privHex) => {
  const pub = secp256k1.getPublicKey(hexToBytes(privHex), false); // 65 bytes, 0x04 prefix
  return bytesToHex(keccak(pub.slice(1)).slice(12));
};

/**
 * Sign {nonce, gasPrice, gasLimit, to, value, data} for chainId with the
 * private key. Returns the raw transaction hex (0x-prefixed) and the hash
 * the node will report (keccak of the signed RLP).
 */
const buildSignedTransaction = ({ privateKey, chainId, nonce, gasPrice, gasLimit, to, value, data }) => {
  const fields = [
    intToBytes(nonce),
    intToBytes(gasPrice),
    intToBytes(gasLimit),
    hexToBytes(to),
    intToBytes(value),
    hexToBytes(data || "0x"),
  ];
  const signingHash = keccak(rlpEncode([...fields, intToBytes(chainId), new Uint8Array(0), new Uint8Array(0)]));
  const sig = secp256k1.sign(signingHash, hexToBytes(privateKey)); // low-s, with recovery
  const v = BigInt(chainId) * 2n + 35n + BigInt(sig.recovery);
  const signed = rlpEncode([...fields, intToBytes(v), intToBytes(sig.r), intToBytes(sig.s)]);
  return { rawTx: "0x" + bytesToHex(signed), hash: "0x" + bytesToHex(keccak(signed)), v: v.toString(), r: sig.r.toString(16), s: sig.s.toString(16) };
};

module.exports = { rlpEncode, keccak, intToBytes, hexToBytes, bytesToHex, addressFromPrivateKey, buildSignedTransaction };
