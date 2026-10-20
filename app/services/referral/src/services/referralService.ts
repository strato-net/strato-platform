import { logError } from "../utils/logger";
import { config } from "../config";
import { execute } from "../utils/stratoHelper";

export interface RedeemReferralRequestParams {
  v: number;
  r: string;
  s: string;
  recipient: string;
  /** Claim from the NftEscrow (one NFT) instead of the token Escrow. */
  nft?: boolean;
}

export const redeemReferral = async (
  params: RedeemReferralRequestParams,
) => {
  try {
    const nft = !!params.nft;
    if (nft && !config.escrow.nftAddress) throw new Error("NFT airdrops are not configured on this server");
    return await execute({
      contractName: nft ? "NftEscrow" : "Escrow",
      contractAddress: nft ? config.escrow.nftAddress! : config.escrow.address!,
      method: "redeem",
      args: {
        v: params.v,
        r: params.r,
        s: params.s,
        recipient: params.recipient,
      },
    });
  } catch (error) {
    logError("ReferralService", error as Error);
    throw error;
  }
};