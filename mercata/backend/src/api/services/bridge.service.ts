import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";

const { MercataBridge } = constants;

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
      select: `withdrawals:${MercataBridge}-withdrawals(id,destChainId,token,user,dest,amount,requestedAt,bridgeStatus)`,
      "withdrawals.user": `eq.${userAddress}`,
    };

    const { data: bridgeData } = await cirrus.get(accessToken, `/${MercataBridge}`, { params });

    if (!bridgeData || !Array.isArray(bridgeData) || bridgeData.length === 0) {
      return [];
    }

    const withdrawals = bridgeData[0].withdrawals || [];
    return withdrawals;
  } catch (error) {
    throw error;
  }
};

export const getBridgeableTokens = async (
  accessToken: string
) => {
  try {
    const params = {
      select: `assets:${MercataBridge}-assets(stratoToken,extToken,extDecimals,chainId,enabled)`,
      "assets.enabled": "eq.true"
    };

    const { data: bridgeData } = await cirrus.get(accessToken, `/${MercataBridge}`, { params });

    if (!bridgeData || !Array.isArray(bridgeData) || bridgeData.length === 0) {
      return [];
    }

    const assets = bridgeData[0].assets || [];
    
    return assets.map((asset: any) => ({
      address: asset.stratoToken,
      extToken: asset.extToken,
      extDecimals: asset.extDecimals,
      chainId: asset.chainId,
      bridgeable: true
    }));
  } catch (error) {
    throw error;
  }
};

export const getEthereumConfig = async () => {
  try {
    return {
      chainId: "1",
      networkName: "Ethereum Mainnet",
      rpcUrl: process.env.ETH_RPC_URL || "https://mainnet.infura.io/v3/your-project-id",
      blockExplorer: "https://etherscan.io",
      nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18
      }
    };
  } catch (error) {
    throw error;
  }
};
