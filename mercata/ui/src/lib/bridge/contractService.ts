import { createPublicClient, http } from 'viem';
import { 
  resolveViemChain, 
  DEPOSIT_ROUTER_ABI, 
  ERC20_ABI, 
  NATIVE_TOKEN_ADDRESS, 
  PERMIT2_ADDRESS,
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

/**
 * Bridge Contract Service
 * Handles all blockchain interactions for the bridge functionality
 */
class BridgeContractService {
  private async getClient(chainId: string) {
    return createPublicClient({
      chain: await resolveViemChain(chainId),
      transport: http(),
    });
  }

  /**
   * Formats an address to ensure it starts with 0x
   */
  formatAddress(address: string): `0x${string}` {
    return (address.startsWith('0x') ? address : `0x${address}`) as `0x${string}`;
  }

  // ============================================
  // Permit2 Functions
  // ============================================

  /**
   * Generates a timestamp-based nonce for Permit2
   * Uses unordered nonces to avoid state tracking
   */
  getPermit2Nonce(): bigint {
    return BigInt(Date.now());
  }

  /**
   * Gets the EIP-712 domain for Permit2 signatures
   */
  getPermit2Domain(chainId: string): Permit2Domain {
    return {
      name: "Permit2",
      chainId: parseInt(chainId),
      verifyingContract: PERMIT2_ADDRESS as `0x${string}`
    };
  }

  /**
   * Gets the EIP-712 types for Permit2 signatures
   */
  getPermit2Types(): Permit2Types {
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

  /**
   * Creates a Permit2 message for signing
   */
  createPermit2Message({
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
        token: this.formatAddress(token),
        amount
      },
      spender: this.formatAddress(spender),
      nonce,
      deadline
    };
  }

  /**
   * Checks if a token has approved Permit2 for spending
   */
  async checkPermit2Approval({
    token,
    owner,
    amount,
    chainId
  }: Permit2Params): Promise<Permit2ApprovalResult> {
    const client = await this.getClient(chainId);
    
    const allowance = await client.readContract({
      address: this.formatAddress(token),
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [
        this.formatAddress(owner),
        PERMIT2_ADDRESS as `0x${string}`
      ]
    });
    
    return {
      isApproved: allowance >= amount,
      currentAllowance: allowance
    };
  }

  // ============================================
  // Token Functions
  // ============================================

  /**
   * Gets the balance of a token or native currency
   */
  async getTokenBalance({ 
    tokenAddress, 
    userAddress, 
    chainId, 
    decimals 
  }: TokenParams): Promise<string> {
    const client = await this.getClient(chainId);
    const normalizedAddress = this.formatAddress(tokenAddress);
    
    // Handle native token (ETH)
    if (normalizedAddress === NATIVE_TOKEN_ADDRESS) {
      const balance = await client.getBalance({ 
        address: this.formatAddress(userAddress) 
      });
      return formatBalance(balance);
    }
    
    // Handle ERC20 tokens
    const balance = await client.readContract({
      address: normalizedAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.formatAddress(userAddress)]
    });
    
    const tokenDecimals = decimals ? parseInt(decimals) : 18;
    return formatBalance(balance, undefined, tokenDecimals);
  }

  // ============================================
  // Validation Functions
  // ============================================

  /**
   * Validates if a deposit can be made through the router contract
   */
  async validateRouterContract({ 
    depositRouterAddress, 
    amount, 
    decimals, 
    chainId,
    tokenAddress 
  }: ValidationParams): Promise<ContractValidationResult> {
    try {
      const client = await this.getClient(chainId);
      const normalizedTokenAddress = this.formatAddress(tokenAddress);
      const depositAmount = safeParseUnits(amount, parseInt(decimals) || 18);
      
      // Get token configuration from router
      const [isAllowed, minAmount] = await client.readContract({
        address: this.formatAddress(depositRouterAddress),
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "getTokenConfig",
        args: [normalizedTokenAddress]
      });

      // Determine token type for error messages
      const tokenType = normalizedTokenAddress === NATIVE_TOKEN_ADDRESS ? "ETH" : "ERC20";
      
      // Check if token is allowed
      if (!isAllowed) {
        return {
          isValid: false,
          error: `${tokenType} deposits are not currently allowed on this router contract`,
          isAllowed,
          minAmount: minAmount.toString(),
          depositAmount: depositAmount.toString()
        };
      }
      
      // Check if amount meets minimum
      if (depositAmount < minAmount) {
        const formattedMin = formatBalance(minAmount, undefined, parseInt(decimals) || 18);
        return {
          isValid: false,
          error: `Deposit amount ${amount} ${tokenType} is below minimum required ${formattedMin} ${tokenType}`,
          isAllowed,
          minAmount: minAmount.toString(),
          depositAmount: depositAmount.toString()
        };
      }

      // All validations passed
      return {
        isValid: true,
        isAllowed,
        minAmount: minAmount.toString(),
        depositAmount: depositAmount.toString()
      };
      
    } catch (error: any) {
      return {
        isValid: false,
        error: `Router contract validation failed: ${error.message || 'Unknown error'}`
      };
    }
  }

  // ============================================
  // Transaction Helpers
  // ============================================

  /**
   * Waits for a transaction to be confirmed
   */
  async waitForTransaction(
    txHash: `0x${string}`, 
    chainId: string, 
    confirmations = 1
  ): Promise<boolean> {
    const client = await this.getClient(chainId);
    
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      confirmations
    });
    
    return receipt.status === 'success';
  }

  /**
   * Estimates gas for a transaction
   */
  async estimateGas({
    address,
    abi,
    functionName,
    args,
    value,
    account,
    chainId
  }: {
    address: string;
    abi: any;
    functionName: string;
    args?: any[];
    value?: bigint;
    account: string;
    chainId: string;
  }): Promise<bigint> {
    const client = await this.getClient(chainId);
    
    return await client.estimateContractGas({
      address: this.formatAddress(address),
      abi,
      functionName,
      args,
      value,
      account: this.formatAddress(account)
    });
  }

  /**
   * Gets the current block number
   */
  async getBlockNumber(chainId: string): Promise<bigint> {
    const client = await this.getClient(chainId);
    return await client.getBlockNumber();
  }

  /**
   * Checks if an address is a contract
   */
  async isContract(address: string, chainId: string): Promise<boolean> {
    const client = await this.getClient(chainId);
    const code = await client.getBytecode({ 
      address: this.formatAddress(address) 
    });
    return !!code && code !== '0x';
  }
}

// Export singleton instance
export const bridgeContractService = new BridgeContractService();