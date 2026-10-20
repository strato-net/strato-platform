// The service's own STRATO key. It signs the redeem transactions the service
// submits, and pays their gas, so it is the account to fund. No login is
// involved: the key is SIGNER_PRIVATE_KEY, or, when that is not set, a key the
// service makes on first start and keeps in data/signer.key (mode 600). The
// address is logged at startup and shown by /health.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { ethers } from "ethers";

const DATA_DIR = path.join(process.cwd(), "data");
const KEY_FILE = path.join(DATA_DIR, "signer.key");

let wallet: ethers.Wallet | undefined;

function load(): ethers.Wallet {
  if (wallet) return wallet;
  let pk = (process.env.SIGNER_PRIVATE_KEY ?? "").trim();
  if (!pk && existsSync(KEY_FILE)) pk = readFileSync(KEY_FILE, "utf8").trim();
  if (!pk) {
    pk = ethers.Wallet.createRandom().privateKey;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(KEY_FILE, pk + "\n", { mode: 0o600 });
    chmodSync(KEY_FILE, 0o600);
    console.log(`[Signer] Made a new signing key in ${KEY_FILE}`);
  }
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("SIGNER_PRIVATE_KEY is not a 32-byte hex private key");
  wallet = new ethers.Wallet(pk);
  return wallet;
}

/** The signer's address, 0x and checksummed. */
export const signerAddress = (): string => load().address;

/** STRATO's EIP-712 transaction digest (domain STRATO v1), as the node checks it. */
const DOMAIN = { name: "STRATO", version: "1" };
const TYPES = {
  Transaction: [
    { name: "to", type: "address" },
    { name: "funcName", type: "string" },
    { name: "args", type: "string[]" },
    { name: "nonce", type: "uint256" },
    { name: "gasLimit", type: "uint256" },
    { name: "network", type: "string" },
  ],
};

export interface UnsignedStratoTx {
  hash?: string;
  data: { nonce: number | string; gasLimit: number | string; to: string; functionName?: string; args?: string[] };
}

/** r and s as 64 hex characters, v as the 1-byte recovery id plus 27: the form the node takes. */
export function signStratoTx(tx: UnsignedStratoTx): { r: string; s: string; v: string } {
  const d = tx.data;
  const digest = ethers.TypedDataEncoder.hash(DOMAIN, TYPES, {
    to: `0x${d.to.replace(/^0x/, "")}`,
    funcName: d.functionName ?? "",
    args: d.args ?? [],
    nonce: BigInt(d.nonce),
    gasLimit: BigInt(d.gasLimit),
    network: "STRATO",
  });
  const sig = load().signingKey.sign(digest);
  return {
    r: sig.r.replace(/^0x/, "").padStart(64, "0"),
    s: sig.s.replace(/^0x/, "").padStart(64, "0"),
    v: sig.v.toString(16).padStart(2, "0"),
  };
}
