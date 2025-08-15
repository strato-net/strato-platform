import { parseUnits, formatUnits } from 'ethers';
import { createPublicClient, http } from 'viem';
import { resolveViemChain, DEPOSIT_ROUTER_ABI } from './constants';

// Types
export interface ContractValidationResult {
  isValid: boolean;
  error?: string;
  isAllowed?: boolean;
  minAmount?: string;
  depositAmount?: string;
}

interface TokenParams {
  tokenAddress: string;
  userAddress: string;
  chainId: string;
}

interface ValidationParams {
  depositRouterAddress: string;
  amount: string;
  decimals: string;
  chainId: string;
}

// Constants
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const ETH_DECIMALS = 18;

// Service Implementation
class BridgeContractService {
  private getClient = async (chainId: string) => createPublicClient({
    chain: await resolveViemChain(chainId),
    transport: http(),
  });

  formatAddress = (address: string): `0x${string}` => 
    (address.startsWith('0x') ? address : `0x${address}`) as `0x${string}`;

  getTokenBalance = async ({ tokenAddress, userAddress, chainId }: TokenParams): Promise<string> => {
    const normalizedAddress = this.formatAddress(tokenAddress);
    
    if (normalizedAddress !== ETH_ADDRESS) {
      throw new Error("Only ETH deposits are supported");
    }
    
    const client = await this.getClient(chainId);
    const balance = await client.getBalance({ 
      address: this.formatAddress(userAddress) 
    });
    
    return formatUnits(balance, ETH_DECIMALS);
  };

  validateRouterContract = async ({ 
    depositRouterAddress, 
    amount, 
    decimals, 
    chainId 
  }: ValidationParams): Promise<ContractValidationResult> => {
    try {
      const client = await this.getClient(chainId);
      const [isAllowed, minAmount] = await client.readContract({
        address: this.formatAddress(depositRouterAddress),
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "getTokenConfig",
        args: [ETH_ADDRESS]
      });

      const depositAmount = parseUnits(amount, parseInt(decimals));
      
      if (!isAllowed) {
        return {
          isValid: false,
          error: "ETH deposits are not currently allowed on this router contract",
          isAllowed,
          minAmount: minAmount.toString(),
          depositAmount: depositAmount.toString()
        };
      }
      
      if (depositAmount < minAmount) {
        return {
          isValid: false,
          error: `Deposit amount ${amount} ETH is below minimum required ${formatUnits(minAmount, ETH_DECIMALS)} ETH`,
          isAllowed,
          minAmount: minAmount.toString(),
          depositAmount: depositAmount.toString()
        };
      }

      return {
        isValid: true,
        isAllowed,
        minAmount: minAmount.toString(),
        depositAmount: depositAmount.toString()
      };
    } catch (error: any) {
      return {
        isValid: false,
        error: `Router contract state check failed: ${error.message}`
      };
    }
  };
}

export const bridgeContractService = new BridgeContractService();