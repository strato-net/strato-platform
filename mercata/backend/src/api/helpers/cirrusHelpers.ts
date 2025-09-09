import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

export const fetchTokenBalances = (accessToken: string, userAddress: string, tokenAddrs: string[]) =>
  cirrus.get(accessToken, `/${constants.Token}-_balances`, {
    params: { 
      select: "address,balance:value::text", 
      key: `eq.${userAddress}`, 
      address: `in.(${tokenAddrs.join(",")})` 
    }
  }).then((r: any) => new Map<string, bigint>(r.data.map((b: any) => [b.address, BigInt(b.balance || "0")])));

export const getTokenMetadata = async (accessToken: string, tokenAddresses: string[]) => {
  if (!tokenAddresses.length) return new Map();
  
  const { data: tokenData } = await cirrus.get(accessToken, `/${constants.Token}`, {
    params: { select: "address,_name,_symbol", address: `in.(${tokenAddresses.join(",")})` }
  });
  
  return new Map(tokenData.map((token: any) => [token.address, { name: token._name, symbol: token._symbol }]));
};
