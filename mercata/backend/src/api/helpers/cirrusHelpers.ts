import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

export const fetchBalances = (accessToken: string, userAddress: string, tokenAddrs: string[]) =>
  cirrus.get(accessToken, `/${constants.Token}-_balances`, {
    params: { 
      select: "address,balance:value::text", 
      user: `eq.${userAddress}`, 
      address: `in.(${tokenAddrs.join(",")})` 
    }
  }).then((r: any) => new Map<string, bigint>(r.data.map((b: any) => [b.address, BigInt(b.balance || "0")])));
