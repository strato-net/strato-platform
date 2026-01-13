import { logError } from "../utils/logger";
import { config } from "../config";
import { execute } from "../utils/stratoHelper";

export interface RedeemReferralRequestParams {
  v: number;
  r: string;
  s: string;
  recipient: string;
}

export const redeemReferral = async (
  params: RedeemReferralRequestParams,
) => {
  try {
    console.log(`AYOOO: ${JSON.stringify(params)}`)
    return await execute({
      contractName: "Escrow",
      contractAddress: config.escrow.address!,
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