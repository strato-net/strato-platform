import { Request, Response, NextFunction } from "express";
import BigNumber from "bignumber.js";
import { Alchemy, Network } from 'alchemy-sdk';
import logger from "../utils/logger";
import { bridgeIn, stratoTokenBalance, bridgeOut, userWithdrawalStatus, userDepositStatus, getBridgeInTokens, getBridgeOutTokens } from "../services/bridgeService";
import { 
  config, 
  TESTNET_ETH_STRATO_TOKEN_MAPPING, 
  MAINNET_ETH_STRATO_TOKEN_MAPPING, 
  MAINNET_STRATO_TOKENS, 
  TESTNET_STRATO_TOKENS,
  TESTNET_ERC20_TOKEN_CONTRACTS,
  MAINNET_ERC20_TOKEN_CONTRACTS
} from "../config";

interface CustomRequest extends Request {
  user?: {
    userAddress: string;
  };
}

// Define the type for token addresses
const ETH_STRATO_TOKEN_MAPPING = process.env.SHOW_TESTNET === 'true' ? TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING;
const STRATO_TOKENS = process.env.SHOW_TESTNET === 'true' ? TESTNET_STRATO_TOKENS : MAINNET_STRATO_TOKENS;
const ERC20_TOKEN_CONTRACTS = (process.env.SHOW_TESTNET === 'true' ? TESTNET_ERC20_TOKEN_CONTRACTS : MAINNET_ERC20_TOKEN_CONTRACTS).map(addr => addr.toLowerCase());

// Initialize Alchemy SDK
const alchemySettings = {
  apiKey: config.alchemy.apiKey,
  network: Network[config.alchemy.network as keyof typeof Network],
};
const alchemy = new Alchemy(alchemySettings);

// Function to get token decimals
function getTokenDecimals(tokenAddress: string): number {
  const token = STRATO_TOKENS.find(t => t.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
  return token?.decimals || 18;
}

// Function to check if token is ERC-20
function isERC20Token(tokenAddress: string): boolean {
  const lowerCaseTokenAddress = tokenAddress.toLowerCase();
  const isERC20 = ERC20_TOKEN_CONTRACTS.includes(lowerCaseTokenAddress);
  return isERC20;
}

// Function to wait for transaction to be mined and confirmed
async function waitForTransactionMined(ethHash: string, maxWaitTime: number = 60000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000; // Check every 2 seconds
  
  console.log(`⏳ Waiting for transaction to be mined: ${ethHash}`);

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const receipt = await alchemy.core.getTransactionReceipt(ethHash);
      
      if (receipt) {
        // Check if transaction was successful (status === 1 means success)
        if (receipt.status === 1) {
          console.log(`✅ Transaction is mined and successful!`);
          return true;
        } else {
          console.log(`❌ Transaction failed on blockchain (status: ${receipt.status})`);
          return false;
        }
      }
    } catch (error: any) {
      console.log(`⚠️ Error checking transaction status: ${error.message}`);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.log(`⏰ Timeout reached - transaction not mined within ${maxWaitTime}ms`);
  return false;
}

// Function to fetch transaction details from Alchemy API using SDK
async function fetchTransactionDetails(ethHash: string) {
  try {
    // Wait for transaction to be mined
    const isMined = await waitForTransactionMined(ethHash);
    if (!isMined) {
      throw new Error('Transaction was not mined within timeout period or failed on blockchain');
    }
    
    const transaction = await alchemy.core.getTransaction(ethHash);
    
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    return transaction;
  } catch (error: any) {
    logger.error("Error fetching transaction details from Alchemy:", error.message);
    throw error;
  }
}

// Function to decode ERC-20 transfer data
function decodeERC20Transfer(input: string) {
  try {
    // ERC-20 transfer function signature: transfer(address,uint256)
    // Method ID: 0xa9059cbb
    const transferMethodId = '0xa9059cbb';
    
    if (!input.startsWith(transferMethodId)) {
      return null;
    }

    // Remove method ID (4 bytes = 8 hex characters)
    const data = input.slice(10); // Remove '0xa9059cbb'
    
    // Extract recipient address (32 bytes = 64 hex characters)
    const recipientHex = data.slice(0, 64);
    const recipient = '0x' + recipientHex.slice(24); // Remove padding
    
    // Extract amount (32 bytes = 64 hex characters)
    const amountHex = data.slice(64, 128);
    const amount = new BigNumber('0x' + amountHex);
    
    return {
      recipient: recipient.toLowerCase(),
      amount: amount.toString()
    };
  } catch (error) {
    logger.error("Error decoding ERC-20 transfer:", error);
    return null;
  }
}

// Function to validate transaction details
function validateTransactionDetails(
  transaction: any,
  expectedAmount: string,
  expectedTokenAddress: string,
  expectedToAddress: string
) {
  const errors: string[] = [];

  // Check if this is a native ETH transfer or ERC-20 transfer
  const isERC20 = isERC20Token(expectedTokenAddress);
  
  if (!isERC20) {
    // For native ETH transfers - validate to address
    if (transaction.to?.toLowerCase() !== expectedToAddress.toLowerCase()) {
      const error = `Invalid to address. Expected: ${expectedToAddress}, Got: ${transaction.to}`;
      errors.push(error);
    }

    // For native ETH transfers - validate amount
    const actualValue = transaction.value ? new BigNumber(transaction.value.toString()) : new BigNumber(0);
    // Convert expected amount to wei (18 decimals)
    const expectedValue = new BigNumber(expectedAmount).multipliedBy(10 ** 18);
    
    if (!actualValue.eq(expectedValue)) {
      const error = `Invalid amount. Expected: ${expectedValue.toString()} wei, Got: ${actualValue.toString()}`;
      errors.push(error);
    }
  } else {
    // For ERC-20 transfers - validate token contract address
    if (transaction.to?.toLowerCase() !== expectedTokenAddress.toLowerCase()) {
      const error = `Invalid token contract address. Expected: ${expectedTokenAddress}, Got: ${transaction.to}`;
      errors.push(error);
    }

    // For ERC-20 transfers, decode the input data to get recipient and amount
    if (transaction.data === '0x' || !transaction.data) {
      const error = 'Invalid token transfer - no input data for ERC-20 transfer';
      errors.push(error);
      return errors;
    }

    const decodedTransfer = decodeERC20Transfer(transaction.data);
    if (!decodedTransfer) {
      const error = 'Invalid ERC-20 transfer data';
      errors.push(error);
      return errors;
    }

    // Validate recipient from decoded data
    if (decodedTransfer.recipient !== expectedToAddress.toLowerCase()) {
      const error = `Invalid recipient in ERC-20 transfer. Expected: ${expectedToAddress}, Got: ${decodedTransfer.recipient}`;
      errors.push(error);
    }

    // Validate amount - use proper token decimals
    const actualAmount = new BigNumber(decodedTransfer.amount);
    const stratoTokenAddress = ETH_STRATO_TOKEN_MAPPING[expectedTokenAddress as keyof typeof ETH_STRATO_TOKEN_MAPPING] || expectedTokenAddress;
    const tokenDecimals = getTokenDecimals(stratoTokenAddress);
    const expectedValue = new BigNumber(expectedAmount).multipliedBy(10 ** tokenDecimals);
    
    if (!actualAmount.eq(expectedValue)) {
      const error = `Invalid amount in ERC-20 transfer. Expected: ${expectedValue.toString()}, Got: ${actualAmount.toString()}`;
      errors.push(error);
    }
  }

  return errors;
}

class BridgeController {
  static async bridgeIn(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { fromAddress, amount, tokenAddress, ethHash } = req.body;

      // Validate required fields
      if (!ethHash) {
        res.status(400).json({ 
          success: false, 
          message: 'Missing ethHash parameter' 
        });
        return;
      }

      // Fetch transaction details from Alchemy API
      let transactionDetails;
      try {
        transactionDetails = await fetchTransactionDetails(ethHash);
      } catch (error: any) {
        res.status(400).json({ 
          success: false, 
          message: `Failed to fetch transaction details: ${error.message}` 
        });
        return;
      }

      // Validate transaction details
      const expectedToAddress = config.safe.address || '';
      
      const validationErrors = validateTransactionDetails(
        transactionDetails,
        amount,
        tokenAddress,
        expectedToAddress
      );

      if (validationErrors.length > 0) {
        res.status(400).json({ 
          success: false, 
          message: 'Invalid amount or tokenAddress',
          errors: validationErrors
        });
        return;
      }

      const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }

      const toAddress = config.safe.address || '';
  
      const stratoTokenAddress = ETH_STRATO_TOKEN_MAPPING[tokenAddress as keyof typeof ETH_STRATO_TOKEN_MAPPING] || tokenAddress;
      
      // Convert to 18 decimal places regardless of token's native decimals
      const amountInWei = new BigNumber(amount).multipliedBy(10 ** 18).toString();
    
      const bridgeInResponse = await bridgeIn(
        ethHash,
        stratoTokenAddress,
        fromAddress,
        amountInWei,
        toAddress,
        userAddress
      );
      
      res.json({
        success: true,
        bridgeInResponse,
      });
    } catch (error: any) {
      logger.error("Error in bridgeIn:", error?.message);
      next(error);
    }
  }


  static async bridgeOut(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const {  amount, tokenAddress, toAddress } = req.body;

      const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }

      const fromAddress = config.safe.address || '';
      
      // Convert to 18 decimal places regardless of token's native decimals
      const bridgeOutResponse = await bridgeOut(
        tokenAddress,
        fromAddress,
        new BigNumber(amount).multipliedBy(10 ** 18).toString(),
        toAddress,
        userAddress
      );

      res.json({
        success: true,
        bridgeOutResponse,
      });
    } catch (error: any) {
      logger.error("Error in bridgeOut:", error);
      next(error);
    }
  }

  static async stratoTokenBalance(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {

      const { tokenAddress } = req.body;
      const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }

      const balanceData = await stratoTokenBalance(userAddress, tokenAddress);

      const balance = new BigNumber(balanceData.balance).div(10**18);

      res.json({
        success: true,
        data: { balance },
      });
    } catch (error: any) {
      logger.error("Error in stratoToBalance:", error.message);
      next(error);
    }
  }

  static async getBridgeInTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const bridgeInTokens = await getBridgeInTokens();

      res.json({
        success: true,
        data: bridgeInTokens,
      });
    } catch (error: any) {
      logger.error("Error in fetching bridge in networks:", error?.message);
      next(error);
    }
  }

  static async getBridgeOutTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const bridgeOutTokens = await getBridgeOutTokens();
      res.json({
        success: true,
        data: bridgeOutTokens,
      });
    } catch (error: any) {
      logger.error("Error in fetching bridge out networks:", error?.message);
      next(error);
    }
  }

  static async userDepositStatus(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { status } = req.params;
      const { limit, orderBy, orderDirection, pageNo } = req.query;
      const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }

      const depositStatus = await userDepositStatus(
        status,
        limit ? parseInt(limit as string) : undefined,
        orderBy as string,
        orderDirection as string,
        pageNo as string,
        userAddress
      );

      res.json({
        success: true,
        data: depositStatus,
      });
    } catch (error: any) {
      logger.error("Error in fetching deposit status:", error?.message);
      next(error);
    }
  }

  static async userWithdrawalStatus(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { status } = req.params;
      const { limit, orderBy, orderDirection, pageNo } = req.query;
      const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }
      const withdrawalStatus = await userWithdrawalStatus(status, limit ? parseInt(limit as string) : undefined, orderBy as string, orderDirection as string, pageNo as string, userAddress);

      res.json({
        success: true,
        data: withdrawalStatus,
      });
    } catch (error: any) {
      logger.error("Error in fetching deposit status:", error?.message);
      next(error);
    }
  }

  static async getBridgeConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const config = {
        showTestnet: process.env.SHOW_TESTNET === 'true',
        safeAddress: process.env.SAFE_ADDRESS
      };

      res.json({
        success: true,
        data: config,
      });
    } catch (error: any) {
      logger.error("Error in fetching bridge config:", error?.message);
      next(error);
    }
  }
}

export default BridgeController;
