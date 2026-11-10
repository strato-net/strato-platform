import { logError } from "../utils/logger";
import { config, REFERRAL_REDEMPTION_DOMAIN } from "../config";
import { execute } from "../utils/stratoHelper";
import { cirrus } from "../utils/api";
import { encodeRlp, keccak256, recoverAddress, toUtf8Bytes } from "ethers";
import { ReferralDepositState, ReferralRecipientState } from "../types";

const pendingOffers = new Set<string>();

export interface RedeemReferralRequestParams {
  v: number;
  r: string;
  s: string;
  recipient: string;
}

export const redeemReferral = async (
  params: RedeemReferralRequestParams,
) => {
  let pendingOffer: string | undefined;
  try {
    if (
      typeof params.recipient !== "string" ||
      !/^(0x)?[a-fA-F0-9]{40}$/.test(params.recipient) ||
      typeof params.r !== "string" || !/^(0x)?[a-fA-F0-9]{64}$/.test(params.r) ||
      typeof params.s !== "string" || !/^(0x)?[a-fA-F0-9]{64}$/.test(params.s) ||
      ![0, 1, 27, 28].includes(params.v)
    ) {
      throw new Error("Invalid redemption signature or recipient");
    }

    const recipient = params.recipient.replace(/^0x/, "").toLowerCase();
    // SolidVM hashes the RLP list of the domain and recipient, without a personal-sign prefix.
    const digest = keccak256(encodeRlp([toUtf8Bytes(REFERRAL_REDEMPTION_DOMAIN), `0x${recipient}`]));
    const offer = recoverAddress(digest, {
      v: params.v,
      r: `0x${params.r.replace(/^0x/, "")}`,
      s: `0x${params.s.replace(/^0x/, "")}`,
    }).slice(2).toLowerCase();

    // Serialize claims for an offer, including claims by different recipients for its last reward.
    if (pendingOffers.has(offer)) {
      throw new Error("A redemption for this offer is already pending");
    }
    pendingOffers.add(offer);
    pendingOffer = offer;

    const address = config.escrow.address!.replace(/^0x/, "").toLowerCase();
    const [deposits, recipients] = await Promise.all([
      cirrus.get<ReferralDepositState[]>("/mapping", { params: {
        address: `eq.${address}`,
        collection_name: "eq.deposits",
        "key->>key": `eq.${offer}`,
        "key->>key3": "is.null",
        select: "field:key->>key2,sender:value->>sender,quantity:value->>quantity,length:value->>length",
      } }),
      cirrus.get<ReferralRecipientState[]>("/mapping", { params: {
        address: `eq.${address}`,
        collection_name: "eq.depositRecipients",
        "key->>key": `eq.${offer}`,
        "key->>key2": `eq.${recipient}`,
        select: "value",
      } }),
    ]);

    const roots = Array.isArray(deposits) ? deposits.filter(row => row.field === null) : [];
    const deposit = roots[0];
    if (roots.length !== 1 ||
        typeof deposit.sender !== "string" || typeof deposit.quantity !== "string" ||
        !/^(0x)?[a-fA-F0-9]{40}$/.test(deposit.sender) ||
        /^0+$/.test(deposit.sender.replace(/^0x/, "")) ||
        !/^\d+$/.test(deposit.quantity) || BigInt(deposit.quantity) <= 0n ||
        !["tokens", "amounts"].every(field => {
          const length = deposits.find(row => row.field === field)?.length;
          return typeof length === "string" && /^\d+$/.test(length) && BigInt(length) > 0n;
        })) {
      throw new Error("Referral offer is unavailable or exhausted");
    }
    if (!Array.isArray(recipients) || recipients.length > 1 ||
        (recipients.length === 1 && recipients[0].value !== false && recipients[0].value !== "false")) {
      throw new Error("Recipient has already redeemed this referral or its state is unavailable");
    }

    return await execute({
      contractName: "Escrow",
      contractAddress: config.escrow.address!,
      method: "redeem",
      args: {
        v: params.v,
        r: params.r,
        s: params.s,
        recipient,
      },
    });
  } catch (error) {
    logError("ReferralService", error as Error);
    throw error;
  } finally {
    if (pendingOffer) pendingOffers.delete(pendingOffer);
  }
};
