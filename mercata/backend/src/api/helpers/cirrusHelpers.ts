import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

const { Token } = constants;

export const toUTCTime = (d: Date) => d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');

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
  
  const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
    params: { select: "address,_name,_symbol", address: `in.(${tokenAddresses.join(",")})` }
  });
  
  return new Map(tokenData.map((token: any) => [token.address, { name: token._name, symbol: token._symbol }]));
};

export const getTokenDetails = async (
  accessToken: string,
  tokenAddresses: string[]
) => {
  if (!tokenAddresses.length) return new Map();

  const { data: tokenData } = await cirrus.get(
    accessToken,
    `/${Token}`,
    {
      params: {
        select:
          `address,_name,_symbol,_owner,_totalSupply::text,customDecimals,description,status,_paused,images:${Token}-images(value),attributes:${Token}-attributes(key,value)`,
        address: `in.(${tokenAddresses.join(",")})`,
      },
    }
  );

  return new Map(tokenData.map((token: any) => [token.address, token]));
};

