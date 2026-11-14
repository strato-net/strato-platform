import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256 } from "./keccak256";

/**
 * The address that signed `message` with personal_sign (EIP-191), as 40
 * lowercase hex characters, or null when `signature` is not a 65-byte
 * r || s || v one or recovers no key. A contract wallet's signature is not
 * one: it is checked by a contract call on its own chain, which the backend
 * cannot make.
 */
export const recoverPersonalSigner = (message: string, signature: string): string | null => {
  const hex = /^0x([0-9a-fA-F]{130})$/.exec(signature)?.[1];
  if (!hex) return null;
  // Wallets send v as 27/28, hardware wallets sometimes as 0/1
  const v = parseInt(hex.slice(128), 16);
  const recovery = v === 27 || v === 28 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) return null;
  const text = Buffer.from(message, "utf8");
  const digest = keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${text.length}`, "utf8"), text]));
  try {
    const publicKey = secp256k1.Signature.fromCompact(hex.slice(0, 128)).addRecoveryBit(recovery).recoverPublicKey(digest).toRawBytes(false);
    // An address is the last 20 bytes of the hash of the key without its 0x04 prefix
    return keccak256(publicKey.subarray(1)).subarray(12).toString("hex");
  } catch {
    return null;
  }
};
