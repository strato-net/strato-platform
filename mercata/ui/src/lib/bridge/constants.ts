import type { Chain } from 'viem';
import { defineChain } from 'viem/utils';

export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

export const DEPOSIT_ROUTER_ABI = [
  {
    inputs: [{ name: "stratoAddress", type: "address" }],
    name: "depositETH",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "getTokenConfig",
    outputs: [
      { name: "allowed", type: "bool" },
      { name: "minAmount", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TokenNotAllowed",
    type: "error"
  },
  {
    inputs: [],
    name: "UseDepositETH",
    type: "error"
  },
  {
    inputs: [],
    name: "BelowMinimum",
    type: "error"
  },
  {
    inputs: [],
    name: "InvalidAddress",
    type: "error"
  },
  {
    inputs: [],
    name: "ETHTransferFailed",
    type: "error"
  },
  {
    inputs: [],
    name: "ArrayLengthMismatch",
    type: "error"
  },
  {
    inputs: [],
    name: "SameAddressProposed",
    type: "error"
  }
] as const;

const chainCache = new Map<number, Chain>();

type ChainHints = {
  name?: string;
  rpcUrl?: string;
  blockExplorerUrl?: string;
  nativeSymbol?: string;
  nativeName?: string;
  decimals?: number;
};

export async function resolveViemChain(chainId: number | string, hints: ChainHints = {}): Promise<Chain> {
  const id = typeof chainId === 'string' ? Number(chainId) : chainId;
  if (Number.isNaN(id)) throw new Error(`Invalid chainId: ${chainId}`);

  const cached = chainCache.get(id);
  if (cached) return cached;

  try {
    const chains = await import('viem/chains');
    switch (id) {
      case 1: return cache(id, chains.mainnet);
      case 11155111: return cache(id, chains.sepolia);
      case 137: return cache(id, chains.polygon);
      case 80002: return cache(id, chains.polygonAmoy);
      case 10: return cache(id, chains.optimism);
      case 8453: return cache(id, chains.base);
      case 42161: return cache(id, chains.arbitrum);
      case 42170: return cache(id, chains.arbitrumNova);
      case 56: return cache(id, chains.bsc);
      case 43114: return cache(id, chains.avalanche);
      default: break;
    }
  } catch {}

  const {
    name = `Chain ${id}`,
    rpcUrl,
    blockExplorerUrl,
    nativeName = 'Ether',
    nativeSymbol = 'ETH',
    decimals = 18,
  } = hints;

  const defined = defineChain({
    id,
    name,
    nativeCurrency: { name: nativeName, symbol: nativeSymbol, decimals },
    rpcUrls: rpcUrl ? { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } } : { default: { http: [] }, public: { http: [] } },
    blockExplorers: blockExplorerUrl ? { default: { name: 'explorer', url: blockExplorerUrl } } : undefined,
  });

  return cache(id, defined);
}

function cache(id: number, c: Chain): Chain {
  chainCache.set(id, c);
  return c;
}

export async function primeChainsFromApi(configs: Array<{ chainId: string | number; chainName?: string; rpcUrl?: string; explorer?: string }>) {
  await Promise.all(
    (configs || []).map((cfg) =>
      resolveViemChain(cfg.chainId, {
        name: cfg.chainName,
        rpcUrl: cfg.rpcUrl,
        blockExplorerUrl: cfg.explorer,
      })
    )
  );
}
