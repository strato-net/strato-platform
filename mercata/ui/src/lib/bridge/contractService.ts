import { createPublicClient, http } from 'viem';
import { 
  resolveViemChain, 
  DEPOSIT_ROUTER_ABI, 
  ERC20_ABI, 
  NATIVE_TOKEN_ADDRESS, 
  PERMIT2_ADDRESS,
  USDY_CONTRACT_ABI,
  USDY_ALLOWLIST_ABI,
  USDY_ETHEREUM_ADDRESS,
  USDY_SEPOLIA_ADDRESS,
  SUPPORTED_CHAINS,
} from './constants';
import { safeParseUnits, formatBalance } from '../../utils/numberUtils';
import { 
  ContractValidationResult, 
  TokenParams, 
  ValidationParams, 
  Permit2ApprovalResult,
  Permit2Params,
  Permit2Domain,
  Permit2Types
} from './types';
import { csrfOnRequest } from "../csrf";

async function getClient(chainId: string) {
  const id = Number(chainId);
  const transport = http(`/api/rpc/${id}`, {onFetchRequest: csrfOnRequest});

  return createPublicClient({
    chain: await resolveViemChain(chainId),
    transport,
  });
}

function formatAddress(address: string): `0x${string}` {
    return (address.startsWith('0x') ? address : `0x${address}`) as `0x${string}`;
  }

export function getPermit2Nonce(): bigint {
    return BigInt(Date.now());
  }

export function getPermit2Domain(chainId: string): Permit2Domain {
    return {
      name: "Permit2",
      chainId: parseInt(chainId),
      verifyingContract: PERMIT2_ADDRESS as `0x${string}`
    };
  }

export function getPermit2Types(): Permit2Types {
    return {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" }
      ]
    } as const;
  }

export function createPermit2Message({
    token,
    amount,
    spender,
    nonce,
    deadline
  }: {
    token: string;
    amount: bigint;
    spender: string;
    nonce: bigint;
    deadline: bigint;
  }) {
    return {
      permitted: {
      token: formatAddress(token),
        amount
      },
    spender: formatAddress(spender),
      nonce,
      deadline
    };
  }

export async function checkPermit2Approval({
    token,
    owner,
    amount,
    chainId
  }: Permit2Params): Promise<Permit2ApprovalResult> {
  const client = await getClient(chainId);
    
    const allowance = await client.readContract({
    address: formatAddress(token),
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [
      formatAddress(owner),
        PERMIT2_ADDRESS as `0x${string}`
      ]
    } as any) as bigint;
    
    return {
      isApproved: allowance >= amount,
      currentAllowance: allowance
    };
  }

export async function getTokenConfig({ 
    tokenAddress, 
    chainId, 
    depositRouterAddress 
  }: { 
    tokenAddress: string; 
    chainId: number; 
    depositRouterAddress: string; 
  }): Promise<{
    minAmount: string;
    isPermitted: boolean;
  }> {
  const client = await getClient(chainId.toString());
  const normalizedAddress = formatAddress(tokenAddress);
    
    const config = await client.readContract({
    address: formatAddress(depositRouterAddress),
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "tokenConfig",
      args: [normalizedAddress]
    } as any);
    
    return {
      minAmount: config[0].toString(),
      isPermitted: config[1]
    };
  }

export async function validateRouterContract({ 
    depositRouterAddress, 
    amount, 
    decimals, 
    chainId,
    tokenAddress
  }: ValidationParams): Promise<ContractValidationResult> {
    try {
    const client = await getClient(chainId);
    const normalizedTokenAddress = formatAddress(tokenAddress);
      const depositAmount = safeParseUnits(amount, parseInt(decimals) || 18);
      
      const config = await client.readContract({
      address: formatAddress(depositRouterAddress),
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "tokenConfig",
        args: [normalizedTokenAddress]
      } as any);
      const minAmount = config[0];
      const isPermitted = config[1];

      const canDeposit = await client.readContract({
      address: formatAddress(depositRouterAddress),
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "canDeposit",
        args: [normalizedTokenAddress, depositAmount]
      } as any);

      const tokenType = normalizedTokenAddress === NATIVE_TOKEN_ADDRESS ? "ETH" : "ERC20";
      
      if (!canDeposit) {
        if (!isPermitted) {
          return {
            isValid: false,
            error: `This token is not permitted for deposits. Please contact support if you believe this is an error.`,
            isAllowed: false,
            minAmount: minAmount.toString(),
            depositAmount: depositAmount.toString()
          };
        }
        if (depositAmount < minAmount) {
          return {
            isValid: false,
            error: `Deposit amount ${amount} ${tokenType} is below minimum required ${formatBalance(minAmount, undefined, parseInt(decimals) || 18)} ${tokenType}`,
            isAllowed: true,
            minAmount: minAmount.toString(),
            depositAmount: depositAmount.toString()
          };
        }
        return {
          isValid: false,
          error: `Deposit validation failed. Please check your input and try again.`,
          isAllowed: false,
          minAmount: minAmount.toString(),
          depositAmount: depositAmount.toString()
        };
      }

      return {
        isValid: true,
        isAllowed: true,
        minAmount: minAmount.toString(),
        depositAmount: depositAmount.toString()
      };
      
    } catch (error) {
      return {
        isValid: false,
        error: `Router contract validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

export async function waitForTransaction(
    txHash: `0x${string}`, 
    chainId: string, 
    confirmations = 1
  ): Promise<boolean> {
  const client = await getClient(chainId);
    
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      confirmations
    });
    
    return receipt.status === 'success';
  }

export async function simulateDeposit({
  depositRouter,
  isNative,
  tokenAddress,
  amount,
  userAddress,
    account,
  chainId,
  permitData
  }: {
  depositRouter: string;
  isNative: boolean;
  tokenAddress?: string;
  amount: bigint;
  userAddress: string;
    account: string;
    chainId: string;
  permitData?: { nonce: bigint; deadline: bigint; signature: string };
}): Promise<void> {
  const client = await getClient(chainId);
  const routerAddress = formatAddress(depositRouter);
  const accountAddress = formatAddress(account);

  if (isNative) {
    await client.simulateContract({
      address: routerAddress,
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "depositETH",
      args: [formatAddress(userAddress)],
      value: amount,
      account: accountAddress,
    });
  } else {
    if (!permitData || !tokenAddress) {
      throw new Error("Permit data and token address are required for ERC20 deposits");
    }
    await client.simulateContract({
      address: routerAddress,
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "deposit",
      args: [
        formatAddress(tokenAddress),
        amount,
        formatAddress(userAddress),
        permitData.nonce,
        permitData.deadline,
        permitData.signature as `0x${string}`
      ],
      account: accountAddress,
    });
  }
}

export async function checkUSDYAllowlist(
  receiverAddress: string,
  chainId: string
): Promise<boolean> {
  try {
    const client = await getClient(chainId);
    const chainIdNum = Number(chainId);
    
    let usdyAddress: string;
    if (chainIdNum === SUPPORTED_CHAINS.MAINNET) {
      usdyAddress = USDY_ETHEREUM_ADDRESS;
    } else if (chainIdNum === SUPPORTED_CHAINS.SEPOLIA) {
      usdyAddress = USDY_SEPOLIA_ADDRESS;
    } else {
      console.warn(`USDY not supported on chain ${chainId}`);
      return true;
    }
    
    const allowlistAddress = await client.readContract({
      address: formatAddress(usdyAddress),
      abi: USDY_CONTRACT_ABI,
      functionName: 'allowlist',
      args: [],
    } as any) as string;

    if (!allowlistAddress || allowlistAddress === '0x0000000000000000000000000000000000000000') {
      console.warn('USDY allowlist address not found or is zero address');
      return true;
    }
    
    const isAllowed = await client.readContract({
      address: formatAddress(allowlistAddress),
      abi: USDY_ALLOWLIST_ABI,
      functionName: 'isAllowed',
      args: [formatAddress(receiverAddress)],
    } as any);
    
    return isAllowed as boolean;
  } catch (error) {
    console.error('Error checking USDY allowlist:', error);
    return false;
  }
}

