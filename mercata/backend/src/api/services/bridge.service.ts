import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";

const { MercataBridge, Token } = constants;

export const bridgeOut = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const { destChainId, token, amount, destAddress } = body;

    const bridgeContractName = extractContractName(MercataBridge);
    const bridgeContractAddress = constants.mercataBridge;
    
    if (!bridgeContractAddress) {
      throw new Error("Bridge contract address not configured");
    }

    const tx = buildFunctionTx({
      contractName: bridgeContractName,
      contractAddress: bridgeContractAddress,
      method: "requestWithdrawal",
      args: {
        destChainId,
        token,
        amount,
        destAddress
      },
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
      message: "Withdrawal request submitted successfully"
    };
  } catch (error) {
    throw error;
  }
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

    const params = {
      select: "withdrawalId:key,withdrawalInfo:value",
      "value->>user": `eq.${userAddress}`,
    };

    const { data: withdrawals } = await cirrus.get(accessToken, `/${MercataBridge}-withdrawals`, { params });

    return withdrawals || [];
  } catch (error) {
    throw error;
  }
};

export const getBridgeableTokens = async (
  accessToken: string,
  chainId: string
) => {
  try {
    const params = {
      select: "stratoTokenAddress:key,assetInfo:value",
      "value->>enabled": "eq.true",
      "value->>chainId": `eq.${chainId}`
    };

    const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, { params });
    
    if (assets.length === 0) {
      return [];
    }

    // Get token addresses from assets
    const tokenAddresses = assets.map((asset: any) => asset.assetInfo?.stratoToken).filter(Boolean);
    
    // Fetch token metadata
    const tokenParams = {
      select: "address,_name,_symbol",
      address: `in.(${tokenAddresses.join(",")})`
    };

    const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, { params: tokenParams });
    
    // Create a map of token addresses to their metadata
    const tokenMap = new Map();
    tokenData.forEach((token: any) => {
      tokenMap.set(token.address, { name: token._name, symbol: token._symbol });
    });
    
    return assets.map((asset: any) => ({
      stratoTokenAddress: asset.stratoTokenAddress,
      stratoTokenName: tokenMap.get(asset.assetInfo?.stratoToken)?._name || "",
      stratoTokenSymbol: tokenMap.get(asset.assetInfo?.stratoToken)?._symbol || "",
      ...asset.assetInfo
    }));
  } catch (error) {
    throw error;
  }
};

export const getNetworkConfigs = async (accessToken: string) => {
  try {
    const { data: chains } = await cirrus.get(accessToken, `/${MercataBridge}-chains`, {
      params: {
        select: "chainId:key,ChainInfo:value",
        "value->>enabled": "eq.true"
      }
    });

    // Return array of key-value pairs
    return chains.map((chain: any) => ({
      chainId: chain.chainId,
      chainInfo: chain.ChainInfo
    }));
  } catch (error) {
    throw error;
  }
};
