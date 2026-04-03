import { ethers } from "ethers";
import axios from "axios";
import { getChainRpcUrl } from "../config";
import { logInfo, logError } from "../utils/logger";
import {
  AcrossQuoteParams,
  AcrossQuoteResponse,
  AcrossLimitsResponse,
  AcrossRoute,
  AcrossDepositParams,
  AcrossDepositResult,
  AcrossDepositStatusParams,
  AcrossDepositStatusResponse,
  AcrossChainTokens,
} from "../types/across";

const LOG_CTX = "AcrossService";

// =============================================================================
// Constants
// =============================================================================

const ACROSS_TESTNET_API = "https://testnet.across.to/api";

const SPOKE_POOL_ABI = [
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes calldata message) external payable",
];

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

// Token addresses per chain (testnet and mainnet)
const CHAIN_TOKENS: Record<number, AcrossChainTokens> = {
  // Sepolia
  11155111: {
    ETH: {
      address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", // WETH on Sepolia (used by SpokePool)
      symbol: "ETH",
      decimals: 18,
    },
    USDC: {
      address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      symbol: "USDC",
      decimals: 6,
    },
    USDT: {
      address: "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06",
      symbol: "USDT",
      decimals: 6,
    },
  },
  // Base Sepolia
  84532: {
    ETH: {
      address: "0x4200000000000000000000000000000000000006", // WETH on Base Sepolia
      symbol: "ETH",
      decimals: 18,
    },
    USDC: {
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      symbol: "USDC",
      decimals: 6,
    },
    USDT: {
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia maps USDT->USDC
      symbol: "USDT",
      decimals: 6,
    },
  },
  // Linea Sepolia (note: Across testnet does NOT support Linea Sepolia routes;
  // these addresses are canonical tokens for non-Across bridge flows)
  59141: {
    ETH: {
      address: "0x06565ed324Ee9fb4DB0FF80B7eDbE4Cb007555a3", // WETH on Linea Sepolia
      symbol: "ETH",
      decimals: 18,
    },
    USDC: {
      address: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
      symbol: "USDC",
      decimals: 6,
    },
  },
  // Linea Mainnet
  59144: {
    ETH: {
      address: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f", // WETH on Linea
      symbol: "ETH",
      decimals: 18,
    },
    USDC: {
      address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
      symbol: "USDC",
      decimals: 6,
    },
    USDT: {
      address: "0xA219439258ca9da29E9Cc4cE5596924745e12B93",
      symbol: "USDT",
      decimals: 6,
    },
  },
};

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

// =============================================================================
// Helpers
// =============================================================================

function getSignerForChain(chainId: number): ethers.Wallet {
  const pk = process.env.ACROSS_SIGNER_PRIVATE_KEY;
  if (!pk) {
    throw new Error("ACROSS_SIGNER_PRIVATE_KEY is not configured");
  }
  const rpcUrl = getChainRpcUrl(chainId);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
}

function resolveTokenAddress(
  chainId: number,
  symbol: string,
): string {
  const tokens = CHAIN_TOKENS[chainId];
  if (!tokens) throw new Error(`Unsupported chain: ${chainId}`);
  const token = tokens[symbol.toUpperCase()];
  if (!token) throw new Error(`Unsupported token ${symbol} on chain ${chainId}`);
  return token.address;
}

function resolveTokenPair(
  originChainId: number,
  destinationChainId: number,
  symbol: string,
): { inputToken: string; outputToken: string } {
  return {
    inputToken: resolveTokenAddress(originChainId, symbol),
    outputToken: resolveTokenAddress(destinationChainId, symbol),
  };
}

async function acrossGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const response = await axios.get<T>(`${ACROSS_TESTNET_API}${path}`, {
    params,
    headers: { Accept: "application/json" },
    timeout: 30_000,
  });
  return response.data;
}

// =============================================================================
// API Functions
// =============================================================================

export async function getQuote(params: AcrossQuoteParams): Promise<AcrossQuoteResponse> {
  logInfo(LOG_CTX, "Fetching quote", {
    origin: params.originChainId,
    dest: params.destinationChainId,
    amount: params.amount,
  });

  const quote = await acrossGet<AcrossQuoteResponse>("/suggested-fees", {
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    originChainId: params.originChainId,
    destinationChainId: params.destinationChainId,
    amount: params.amount,
  });

  if (quote.isAmountTooLow) {
    throw new Error(
      `Amount too low. Minimum deposit: ${quote.limits.minDeposit}`,
    );
  }

  return quote;
}

export async function getLimits(
  originChainId: number,
  destinationChainId: number,
  inputToken: string,
  outputToken: string,
): Promise<AcrossLimitsResponse> {
  return acrossGet<AcrossLimitsResponse>("/limits", {
    inputToken,
    outputToken,
    originChainId,
    destinationChainId,
  });
}

export async function getAvailableRoutes(
  originChainId?: number,
  destinationChainId?: number,
): Promise<AcrossRoute[]> {
  const params: Record<string, string | number> = {};
  if (originChainId) params.originChainId = originChainId;
  if (destinationChainId) params.destinationChainId = destinationChainId;
  return acrossGet<AcrossRoute[]>("/available-routes", params);
}

export async function getDepositStatus(
  params: AcrossDepositStatusParams,
): Promise<AcrossDepositStatusResponse> {
  return acrossGet<AcrossDepositStatusResponse>("/deposit/status", {
    originChainId: params.originChainId,
    depositTxHash: params.depositTxHash,
  });
}

// =============================================================================
// Intent Initiation
// =============================================================================

export async function initiateIntent(
  params: AcrossDepositParams,
): Promise<AcrossDepositResult> {
  const {
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount,
    recipient,
    message = "0x",
  } = params;

  logInfo(LOG_CTX, "Initiating Across intent", {
    originChainId,
    destinationChainId,
    inputToken,
    inputAmount,
    recipient,
  });

  // 1. Get quote from Across API
  const quote = await getQuote({
    inputToken,
    outputToken,
    originChainId,
    destinationChainId,
    amount: inputAmount,
  });

  const spokePoolAddress = quote.spokePoolAddress;
  const signer = getSignerForChain(originChainId);
  const depositor = await signer.getAddress();

  const isNativeEth =
    inputToken.toLowerCase() === NATIVE_TOKEN ||
    inputToken.toLowerCase() === CHAIN_TOKENS[originChainId]?.ETH?.address.toLowerCase();

  // 2. Approve SpokePool if ERC20 (not native ETH)
  if (!isNativeEth) {
    const erc20 = new ethers.Contract(inputToken, ERC20_APPROVE_ABI, signer);
    const currentAllowance: bigint = await erc20.allowance(depositor, spokePoolAddress);

    if (currentAllowance < BigInt(inputAmount)) {
      logInfo(LOG_CTX, "Approving SpokePool for token spend", {
        token: inputToken,
        spender: spokePoolAddress,
      });
      const approveTx = await erc20.approve(spokePoolAddress, inputAmount);
      await approveTx.wait();
      logInfo(LOG_CTX, "Approval confirmed");
    }
  }

  // 3. Call depositV3 on SpokePool
  const spokePool = new ethers.Contract(
    spokePoolAddress,
    SPOKE_POOL_ABI,
    signer,
  );

  const txOverrides: ethers.Overrides = {};
  if (isNativeEth) {
    txOverrides.value = BigInt(inputAmount);
  }

  logInfo(LOG_CTX, "Submitting depositV3", {
    spokePool: spokePoolAddress,
    outputAmount: quote.outputAmount,
    quoteTimestamp: quote.timestamp,
    fillDeadline: quote.fillDeadline,
  });

  const tx = await spokePool.depositV3(
    depositor,
    recipient,
    inputToken,
    outputToken,
    inputAmount,
    quote.outputAmount,
    destinationChainId,
    quote.exclusiveRelayer,
    Number(quote.timestamp),
    Number(quote.fillDeadline),
    quote.exclusivityDeadline,
    message,
    txOverrides,
  );

  const receipt = await tx.wait();

  logInfo(LOG_CTX, "Across intent submitted", {
    txHash: receipt.hash,
    originChainId,
    destinationChainId,
  });

  return {
    txHash: receipt.hash,
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount,
    outputAmount: quote.outputAmount,
    recipient,
    depositor,
    quoteTimestamp: Number(quote.timestamp),
    fillDeadline: Number(quote.fillDeadline),
  };
}

// =============================================================================
// Convenience: initiate by symbol
// =============================================================================

export async function initiateIntentBySymbol(
  originChainId: number,
  destinationChainId: number,
  symbol: string,
  inputAmount: string,
  recipient: string,
): Promise<AcrossDepositResult> {
  const { inputToken, outputToken } = resolveTokenPair(
    originChainId,
    destinationChainId,
    symbol,
  );

  return initiateIntent({
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount,
    recipient,
  });
}

// =============================================================================
// Exports (convenience)
// =============================================================================

export const getSupportedTokens = (chainId: number) => CHAIN_TOKENS[chainId] ?? {};
