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
   * Gets token configuration from the DepositRouter contract
   */
  async getTokenConfig({ 
    tokenAddress, 
    chainId, 
    depositRouterAddress 
  }: { 
    tokenAddress: string; 
    chainId: number; 
    depositRouterAddress: string; 
  }): Promise<{
    minAmount: string;
    permissions: number;
  }> {
    const client = await this.getClient(chainId.toString());
    const normalizedAddress = this.formatAddress(tokenAddress);
    
    const [minAmount, permissions] = await client.readContract({
      address: this.formatAddress(depositRouterAddress),
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "tokenConfig",
      args: [normalizedAddress]
    });
    
    return {
      minAmount: minAmount.toString(),
      permissions: Number(permissions)
    };
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
    tokenAddress,
    mint = false
  }: ValidationParams & { mint?: boolean }): Promise<ContractValidationResult> {
    try {
      const client = await this.getClient(chainId);
      const normalizedTokenAddress = this.formatAddress(tokenAddress);
      const depositAmount = safeParseUnits(amount, parseInt(decimals) || 18);
      
      // Get token configuration from router
      const [minAmount, permissions] = await client.readContract({
        address: this.formatAddress(depositRouterAddress),
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "tokenConfig",
        args: [normalizedTokenAddress]
      });

      // Check if deposit is allowed using canDeposit
      const canDeposit = await client.readContract({
        address: this.formatAddress(depositRouterAddress),
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "canDeposit",
        args: [normalizedTokenAddress, depositAmount, mint]
      });

      // Determine token type for error messages
      const tokenType = normalizedTokenAddress === NATIVE_TOKEN_ADDRESS ? "ETH" : "ERC20";
      const operationType = mint ? "mint" : "wrap";
      
      // Check if operation is permitted
      if (!canDeposit) {
        const permissionRequired = mint ? 2 : 1; // PERMISSION_MINT = 2, PERMISSION_WRAP = 1
        const hasPermission = (permissions & permissionRequired) !== 0;
        
        if (!hasPermission) {
          return {
            isValid: false,
            error: `${tokenType} ${operationType} operations are not currently allowed on this router contract`,
            isAllowed: false,
            minAmount: minAmount.toString(),
            depositAmount: depositAmount.toString()
          };
        }
        
        return {
          isValid: false,
          error: `Deposit amount ${amount} ${tokenType} is below minimum required ${formatBalance(minAmount, undefined, parseInt(decimals) || 18)} ${tokenType}`,
          isAllowed: true,
          minAmount: minAmount.toString(),
          depositAmount: depositAmount.toString()
        };
      }

      // All validations passed
      return {
        isValid: true,
        isAllowed: true,
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

  // ============================================
  // High-Level Transaction Methods
  // ============================================

  /**
   * Executes a complete deposit transaction (for both BridgeIn and MintWidget)
   */
  async executeDepositTransaction({
    web3Context,
    tokenInfo,
    amount,
    stratoAddress,
    depositRouter,
    chainId,
    mintUSDST = false,
  }: {
    web3Context: {
      address: `0x${string}`;
      signTypedDataAsync: (args: any) => Promise<`0x${string}`>;
      writeContractAsync: (args: any) => Promise<`0x${string}`>;
    };
    tokenInfo: {
      externalToken: string;
      externalDecimals: string;
    };
    amount: string;
    stratoAddress: string;
    depositRouter: string;
    chainId: string;
    mintUSDST?: boolean;
  }): Promise<`0x${string}`> {
    const depositAmount = safeParseUnits(amount, parseInt(tokenInfo.externalDecimals || "18"));
    
    // Validate router contract
    const validation = await this.validateRouterContract({
      depositRouterAddress: depositRouter,
      amount,
      decimals: tokenInfo.externalDecimals,
      chainId,
      tokenAddress: tokenInfo.externalToken,
      mint: mintUSDST,
    });
    
    if (!validation.isValid) {
      throw new Error(validation.error || "Validation failed");
    }

    // Check and ensure Permit2 approval
    const approval = await this.checkPermit2Approval({
      token: tokenInfo.externalToken,
      owner: web3Context.address,
      amount: depositAmount,
      chainId,
    });

    if (!approval.isApproved) {
      // Approve Permit2
      const approveTx = await web3Context.writeContractAsync({
        address: tokenInfo.externalToken as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [PERMIT2_ADDRESS as `0x${string}`, BigInt(2) ** BigInt(256) - BigInt(1)],
        chain: await resolveViemChain(chainId),
        account: web3Context.address,
      });

      await this.waitForTransaction(approveTx, chainId);
    }

    // Build permit signature
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900); // 15 minutes
    const nonce = this.getPermit2Nonce();
    const permitMessage = this.createPermit2Message({
      token: tokenInfo.externalToken,
      amount: depositAmount,
      spender: depositRouter,
      nonce,
      deadline,
    });

    const signature = await web3Context.signTypedDataAsync({
      domain: this.getPermit2Domain(chainId),
      types: this.getPermit2Types(),
      primaryType: "PermitTransferFrom",
      message: permitMessage,
      account: web3Context.address,
    });

    // Simulate and send transaction
    const client = await this.getClient(chainId);
    await client.simulateContract({
      address: depositRouter as `0x${string}`,
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "deposit",
      args: [
        this.formatAddress(tokenInfo.externalToken),
        depositAmount,
        this.formatAddress(stratoAddress),
        nonce,
        deadline,
        signature,
        mintUSDST,
      ],
      account: web3Context.address,
    });

    const txHash = await web3Context.writeContractAsync({
      address: depositRouter as `0x${string}`,
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "deposit",
      args: [
        this.formatAddress(tokenInfo.externalToken),
        depositAmount,
        this.formatAddress(stratoAddress),
        nonce,
        deadline,
        signature,
        mintUSDST,
      ],
      chain: await resolveViemChain(chainId),
      account: web3Context.address,
    });

    return txHash;
  }

  /**
   * Executes a complete ETH deposit transaction
   */
  async executeETHDepositTransaction({
    web3Context,
    amount,
    stratoAddress,
    depositRouter,
    chainId,
  }: {
    web3Context: {
      address: `0x${string}`;
      writeContractAsync: (args: any) => Promise<`0x${string}`>;
    };
    amount: string;
    stratoAddress: string;
    depositRouter: string;
    chainId: string;
  }): Promise<`0x${string}`> {
    const depositAmount = safeParseUnits(amount, 18);

    // Simulate and send ETH deposit
    const client = await this.getClient(chainId);
    await client.simulateContract({
      address: depositRouter as `0x${string}`,
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "depositETH",
      args: [this.formatAddress(stratoAddress)],
      value: depositAmount,
      account: web3Context.address,
    });

    const txHash = await web3Context.writeContractAsync({
      address: depositRouter as `0x${string}`,
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "depositETH",
      args: [this.formatAddress(stratoAddress)],
      chain: await resolveViemChain(chainId),
      account: web3Context.address,
      value: depositAmount,
    });

    return txHash;
  }
}

// Export singleton instance
export const bridgeContractService = new BridgeContractService();