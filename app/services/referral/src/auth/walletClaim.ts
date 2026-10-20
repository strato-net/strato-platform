// Authorization for POST /redeem-referral: the redeem signature itself. There
// is no login; a self-custody wallet and the STRATO app alike send the claim.
// Only the holder of the ephemeral key can produce it, and the recipient is
// inside the signed digest, so a third party can change nothing. The service
// still pays the gas, so before submitting it checks that the recovered
// ephemeral address has a live deposit in the Escrow: a bogus signature never
// reaches the chain. Same digest as Escrow.redeem:
// keccak256(rlp["STRATO_ESCROW_REDEEM_V1", recipient]).
import { ethers } from "ethers";
import { cirrus } from "../utils/api";
import { config } from "../config";

const bare = (a: string) => a.replace(/^0x/, "").toLowerCase();

export interface WalletClaimBody {
  v?: unknown;
  r?: unknown;
  s?: unknown;
  recipient?: unknown;
}

/** The ephemeral address a redeem signature was made with, or a throw when it is not a valid signature. */
export function recoverEphemeral(recipient: string, v: number, r: string, s: string): string {
  const digest = ethers.keccak256(ethers.encodeRlp([ethers.toUtf8Bytes("STRATO_ESCROW_REDEEM_V1"), `0x${bare(recipient)}`]));
  return bare(ethers.recoverAddress(digest, { r, s, v }));
}

/**
 * Checks a redeem request and returns the recipient's address. The request
 * authorizes itself: a valid signature over the recipient by an ephemeral key
 * that still has a deposit. When an X-Wallet-Address header is sent, it must
 * be the recipient.
 * @throws when the body or signature is not acceptable, or nothing is left to claim.
 */
export async function walletClaimAddress(walletAddress: unknown, body: WalletClaimBody | undefined): Promise<string> {
  const { v, r, s, recipient } = body ?? {};
  if (typeof recipient !== "string" || !/^(0x)?[0-9a-f]{40}$/i.test(recipient)) throw new Error("recipient must be an address");
  if (walletAddress !== undefined && (typeof walletAddress !== "string" || bare(walletAddress) !== bare(recipient))) throw new Error("X-Wallet-Address must be the recipient");
  if (typeof r !== "string" || typeof s !== "string" || (v !== 27 && v !== 28)) throw new Error("A redeem signature (v, r, s) is required");

  let ephemeral: string;
  try {
    ephemeral = recoverEphemeral(recipient, v, r, s);
  } catch {
    throw new Error("The redeem signature is not valid");
  }

  // The deposit's struct row in the Escrow's `deposits` mapping: what is left, and until when.
  const rows: any[] = await cirrus.get("/mapping", {
    params: {
      select: "key,value",
      address: `eq.${bare(config.escrow.address!)}`,
      collection_name: "eq.deposits",
      "key->>key": `eq.${ephemeral}`,
    },
  });
  const parse = (x: any) => {
    try {
      return typeof x === "string" ? JSON.parse(x) : x;
    } catch {
      return x;
    }
  };
  const struct = (Array.isArray(rows) ? rows : []).map((row) => ({ k: parse(row.key), v: parse(row.value) })).find(({ k }) => !k?.key2);
  const quantity = Number(struct?.v?.quantity ?? 0);
  const expiry = Number(struct?.v?.expiry ?? 0);
  if (!(quantity > 0)) throw new Error("Nothing is left to claim under this link");
  if (expiry > 0 && expiry * 1000 <= Date.now()) throw new Error("This airdrop has expired");
  return bare(recipient);
}
