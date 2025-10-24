import type { Chain } from 'viem';
import { defineChain } from 'viem/utils';
import { ChainHints } from './types';

// Core Constants
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

// UI Constants
export const ITEMS_PER_PAGE = 10;

// Contract ABIs
export const ERC20_ABI = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'nonces',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

export const DEPOSIT_ROUTER_ABI = [
  // Functions
  {
    inputs: [{ name: 'stratoAddress', type: 'address' }],
    name: 'depositETH',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'stratoAddress', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'canDeposit',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'tokenConfig',
    outputs: [
      { name: 'min', type: 'uint96' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // Errors
  {
    inputs: [],
    name: 'UseDepositETH',
    type: 'error'
  },
  {
    inputs: [],
    name: 'BelowMinimum',
    type: 'error'
  },
  {
    inputs: [],
    name: 'ZeroAmount',
    type: 'error'
  },
  {
    inputs: [],
    name: 'PermitExpired',
    type: 'error'
  },
  {
    inputs: [],
    name: 'InvalidAddress',
    type: 'error'
  },
  {
    inputs: [],
    name: 'ETHTransferFailed',
    type: 'error'
  },
  {
    inputs: [],
    name: 'ArrayLengthMismatch',
    type: 'error'
  },
  {
    inputs: [],
    name: 'SameAddressProposed',
    type: 'error'
  },
  {
    inputs: [],
    name: 'SweepEthFailed',
    type: 'error'
  },
  {
    inputs: [],
    name: 'NotPermitted',
    type: 'error'
  },
  {
    inputs: [],
    name: 'InvalidPermissions',
    type: 'error'
  }
] as const;

// Chain Management
export const SUPPORTED_CHAINS = {
  MAINNET: 1,
  SEPOLIA: 11155111,
  POLYGON: 137,
  POLYGON_AMOY: 80002,
  OPTIMISM: 10,
  BASE: 8453,
  ARBITRUM: 42161,
  ARBITRUM_NOVA: 42170,
  BSC: 56,
  AVALANCHE: 43114
} as const;

const chainCache = new Map<number, Chain>();

export async function resolveViemChain(
  chainId: number | string, 
  hints: ChainHints = {}
): Promise<Chain> {
  // Normalize chain ID to number
  const id = typeof chainId === 'string' ? Number(chainId) : chainId;
  if (Number.isNaN(id)) {
    throw new Error(`Invalid chainId: ${chainId}`);
  }

  // Check cache first
  const cached = chainCache.get(id);
  if (cached) return cached;

  // Try to load built-in chain
  const builtInChain = await loadBuiltInChain(id);
  if (builtInChain) {
    return cacheChain(id, builtInChain);
  }

  // Create custom chain from hints
  return cacheChain(id, createCustomChain(id, hints));
}

async function loadBuiltInChain(id: number): Promise<Chain | null> {
  try {
    const chains = await import('viem/chains');
    
    switch (id) {
      case SUPPORTED_CHAINS.MAINNET:       return chains.mainnet;
      case SUPPORTED_CHAINS.SEPOLIA:       return chains.sepolia;
      case SUPPORTED_CHAINS.POLYGON:       return chains.polygon;
      case SUPPORTED_CHAINS.POLYGON_AMOY:  return chains.polygonAmoy;
      case SUPPORTED_CHAINS.OPTIMISM:      return chains.optimism;
      case SUPPORTED_CHAINS.BASE:          return chains.base;
      case SUPPORTED_CHAINS.ARBITRUM:      return chains.arbitrum;
      case SUPPORTED_CHAINS.ARBITRUM_NOVA: return chains.arbitrumNova;
      case SUPPORTED_CHAINS.BSC:           return chains.bsc;
      case SUPPORTED_CHAINS.AVALANCHE:     return chains.avalanche;
      default:                             return null;
    }
  } catch {
    return null;
  }
}

function createCustomChain(id: number, hints: ChainHints): Chain {
  const {
    name = `Chain ${id}`,
    rpcUrl,
    blockExplorerUrl,
    nativeName = 'Ether',
    nativeSymbol = 'ETH',
    decimals = 18,
  } = hints;

  return defineChain({
    id,
    name,
    nativeCurrency: { 
      name: nativeName, 
      symbol: nativeSymbol, 
      decimals 
    },
    rpcUrls: rpcUrl 
      ? { 
          default: { http: [rpcUrl] }, 
          public: { http: [rpcUrl] } 
        } 
      : { 
          default: { http: [] }, 
          public: { http: [] } 
        },
    blockExplorers: blockExplorerUrl 
      ? { 
          default: { 
            name: 'explorer', 
            url: blockExplorerUrl 
          } 
        } 
      : undefined,
  });
}

function cacheChain(id: number, chain: Chain): Chain {
  chainCache.set(id, chain);
  return chain;
}

export async function primeChainsFromApi(
  configs: Array<{
    chainId: string | number;
    chainName?: string;
    rpcUrl?: string;
    explorer?: string;
  }>
): Promise<void> {
  await Promise.all(
    configs.map(cfg =>
      resolveViemChain(cfg.chainId, {
        name: cfg.chainName,
        rpcUrl: cfg.rpcUrl,
        blockExplorerUrl: cfg.explorer,
      })
    )
  );
}

export function clearChainCache(): void {
  chainCache.clear();
}

export function getCachedChains(): Map<number, Chain> {
  return new Map(chainCache);
}

export type { Chain } from 'viem';