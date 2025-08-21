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
   
    // Get bridge assets to match with transactions
    const bridgeAssets = await getBridgeAssets(accessToken);
    
    let url: string;
    let params: Record<string, any>;

    if (status === 'WithdrawalInitiated') {
      // Same params and URL as before for WithdrawalInitiated
      url = `/${MercataBridge}-withdrawals`;
      params = {
        order: 'block_timestamp.desc',
        select: "withdrawalId:key,withdrawalInfo:value,block_timestamp,transaction_hash",
        "value->>user": `eq.${userAddress}`,
        address: `eq.${constants.mercataBridge}`
      };
      
   
      
    } else if (status === 'DepositInitiated') {
     
      // Different URL and params for DepositInitiated
      url = `/${MercataBridge}-deposits`;
      params = {  
         order: 'block_timestamp.desc',
     select: "chainId:key,depositInfo:value,block_timestamp,transaction_hash",
          "value->>user": `eq.${userAddress}`,   // how to get this address 156947246105159104636409351615097004700443525326?
        address: `eq.${constants.mercataBridge}`
      };
      
    } else {
      throw new Error('Invalid status. Must be either "WithdrawalInitiated" or "DepositInitiated"');
    }
    
    const { data: results } = await cirrus.get(accessToken, url, { params });
    
    if (!results || !results.length) return [];

    // Enrich results with bridge asset data
    const enrichedResults = results.map((result: any) => {
      let matchingAsset;
      
      if (status === 'WithdrawalInitiated') {
        // Match destChainId AND token from withdrawalInfo with bridge assets
        matchingAsset = bridgeAssets.find((asset: any) => 
          asset.value.chainId === result.withdrawalInfo?.destChainId &&
          asset.key === result.withdrawalInfo?.token
        );
      } else if (status === 'DepositInitiated') {
        // Match chainId AND token from depositInfo with bridge assets
        matchingAsset = bridgeAssets.find((asset: any) => 
          asset.value.chainId === String(result.chainId) &&
          asset.value.extToken === result.depositInfo?.token
        );
      }

      if (matchingAsset) {
        return {
          ...result,
          stratoToken: matchingAsset.stratoToken,
          stratoTokenName: matchingAsset.stratoTokenName,
          stratoTokenSymbol: matchingAsset.stratoTokenSymbol,
          extName: matchingAsset.value.extName,
          extToken: matchingAsset.value.extToken
        };
      } else {
        // Return result with default values if no match found
        return {
          ...result,
          stratoToken: "-",
          stratoTokenName: "-",
          stratoTokenSymbol: "-",
          extName: "-",
          extToken: "-"
        };
      }
    });
    return enrichedResults;
  
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

export const getBridgeAssets = async (accessToken: string) => {
  try {
    const { data: bridgeData } = await cirrus.get(accessToken, `/BlockApps-Mercata-MercataBridge`, {
      params: {
        select: "assets:BlockApps-Mercata-MercataBridge-assets(*)",
        address: `eq.${constants.mercataBridge}`
      }
    });

    const assets = bridgeData?.[0]?.assets || [];
    if (!assets.length) return [];

    const tokenAddresses = assets.map((asset: any) => asset.key);
    const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
      params: { select: "address,_name,_symbol", address: `in.(${tokenAddresses.join(",")})` }
    });

    const tokenMap = new Map(tokenData.map((t: any) => [t.address, { name: t._name, symbol: t._symbol }]));

    return assets.map((asset: any) => {
      const tokenInfo = tokenMap.get(asset.key) as { name?: string; symbol?: string } | undefined;
      return {
        key: asset.key,
        root: asset.root,
        value: asset.value,
        address: asset.address,
        stratoToken: asset.key,
        stratoTokenName: tokenInfo?.name || "",
        stratoTokenSymbol: tokenInfo?.symbol || ""
      };
    });
  } catch (error) {
    console.error("Error in getBridgeAssets:", error);
    throw error;
  }
};

export const getTokenLimit = async (accessToken: string, tokenAddress: string) => {
  try {

    
    const { data: tokenLimitData } = await cirrus.get(accessToken, `/${MercataBridge}-tokenLimits`, {
      params: {
        select: "token:key,tokenLimit:value",
        "key": `eq.${tokenAddress}`,
        address: `eq.${constants.mercataBridge}`
      }
    });

    if (!tokenLimitData || !tokenLimitData.length) {
      console.log("No token limit found for token:", tokenAddress);
      return {
        token: tokenAddress,
        maxPerTx: 0,
        isUnlimited: true
      };
    }

    const tokenLimit = tokenLimitData[0];
    const maxPerTx = tokenLimit.tokenLimit?.maxPerTx || 0;
    const isUnlimited = maxPerTx === 0;


    return {
      token: tokenAddress,
      maxPerTx,
      isUnlimited
    };
  } catch (error) {
    console.error("Error in getTokenLimit:", error);
    throw error;
  }
};
