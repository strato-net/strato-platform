import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";

const { MercataBridge, Token } = constants;

export const bridgeOut = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  const { destChainId, token, amount, destAddress } = body;

  if (!constants.mercataBridge) {
    throw new Error("Bridge contract address not configured");
  }

  const tx = buildFunctionTx([
    {
      contractName: extractContractName(Token),
      contractAddress: token || "",
      method: "approve",
      args: { spender: constants.mercataBridge, value: amount },
    },
    {
      contractName: extractContractName(MercataBridge),
      contractAddress: constants.mercataBridge,
      method: "requestWithdrawal",
      args: { destChainId, token, amount, destAddress },
    }
  ]);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash, message: "Withdrawal request submitted successfully" };
};

export const getBridgeStatus = async (
  accessToken: string,
  userAddress: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    if (!userAddress) {
      throw new Error('User address is required');
    }

    // Extract status from rawParams
    const { status } = rawParams;
   
    
    let url: string;
    let params: Record<string, any>;

    if (status === 'WithdrawalInitiated') {
      console.log("Processing WithdrawalInitiated status");
      // Same params and URL as before for WithdrawalInitiated
      url = `/${MercataBridge}-withdrawals`;
      params = {
        select: "withdrawalId:key,withdrawalInfo:value",
        "value->>user": `eq.${userAddress}`,
        address: `eq.${constants.mercataBridge}`
      };
      
   
      
    } else if (status === 'DepositInitiated') {
      console.log("Processing DepositInitiated status");
      // Different URL and params for DepositInitiated
      url = `/${MercataBridge}-deposits`;
      params = {
        select: "depositId:key,depositInfo:value",
          "value->>user": `eq.${userAddress}`,   // how to get this address?
        address: `eq.${constants.mercataBridge}`
      };
      
      
    } else {
      console.log("Invalid status received:", status);
      throw new Error('Invalid status. Must be either "WithdrawalInitiated" or "DepositInitiated"');
    }
    
  
    
    const { data: results } = await cirrus.get(accessToken, url, { params });
    return results || [];
  } catch (error) {
    console.error("Error in getBridgeStatus:", error);
    throw error;
  }
};

export const getBridgeableTokens = async (accessToken: string, chainId: string) => {
  const params = {
    select: "stratoTokenAddress:key,assetInfo:value",
    "value->>enabled": "eq.true",
    "value->>chainId": `eq.${chainId}`,
    address: `eq.${constants.mercataBridge}`
  };
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, { params });
  if (!assets.length) return [];
  const tokenAddresses = assets.map((a: any) => a.stratoTokenAddress).filter(Boolean);
  const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
    params: { select: "address,_name,_symbol", address: `in.(${tokenAddresses.join(",")})` }
  });
  const tokenMap = new Map(tokenData.map((t: any) => [t.address, { name: t._name, symbol: t._symbol }]));
  return assets.map((a: any) => {
    const info = tokenMap.get(a.stratoTokenAddress) as { name?: string; symbol?: string } | undefined;
    if (a.assetInfo.extToken) a.assetInfo.extToken = ensureHexPrefix(a.assetInfo.extToken);
    return { stratoTokenAddress: a.stratoTokenAddress, stratoTokenName: info?.name || "", stratoTokenSymbol: info?.symbol || "", ...a.assetInfo };
  });
};

export const getNetworkConfigs = async (accessToken: string) => {
  try {
    const { data } = await cirrus.get(accessToken, `/${MercataBridge}-chains`, {
      params: {
        select: "chainId:key,ChainInfo:value",
        "value->>enabled": "eq.true",
        address: `eq.${constants.mercataBridge}`
      }
    });
    return data.map((c: any) => {
      if (c.ChainInfo.depositRouter) c.ChainInfo.depositRouter = ensureHexPrefix(c.ChainInfo.depositRouter);
      return { chainId: c.chainId, chainInfo: c.ChainInfo };
    });
  } catch (e) {
    throw e;
  }
};
