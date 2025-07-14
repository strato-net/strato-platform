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
  console.log(`🔍 ERC-20 check: ${tokenAddress} -> ${lowerCaseTokenAddress} -> ${isERC20 ? 'ERC-20' : 'Native ETH'}`);
  return isERC20;
}

// Function to wait for transaction to be mined and confirmed
async function waitForTransactionMined(ethHash: string, maxWaitTime: number = 60000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000; // Check every 2 seconds
  
  console.log(`⏳ Waiting for transaction to be mined: ${ethHash}`);
  console.log(`⏰ Max wait time: ${maxWaitTime}ms`);

  while (Date.now() - startTime < maxWaitTime) {
    try {
      console.log(`🔍 Checking transaction status... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      const receipt = await alchemy.core.getTransactionReceipt(ethHash);
      
      if (receipt) {
        console.log(`📊 Transaction receipt found:`, {
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          confirmations: receipt.confirmations
        });

        // Check if transaction was successful (status === 1 means success)
        if (receipt.status === 1) {
          console.log(`✅ Transaction is mined and successful!`);
          return true;
        } else {
          console.log(`❌ Transaction failed on blockchain (status: ${receipt.status})`);
          return false;
        }
      } else {
        console.log(`⏳ Transaction not mined yet, waiting...`);
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
    console.log(`🔍 Fetching transaction details for hash: ${ethHash}`);
    
    // Wait for transaction to be mined
    const isMined = await waitForTransactionMined(ethHash);
    if (!isMined) {
      throw new Error('Transaction was not mined within timeout period or failed on blockchain');
    }
    
    const transaction = await alchemy.core.getTransaction(ethHash);
    
    if (!transaction) {
      console.log(`❌ Transaction not found for hash: ${ethHash}`);
      throw new Error('Transaction not found');
    }

    console.log(`✅ Transaction found:`, {
      hash: transaction.hash,
      to: transaction.to,
      from: transaction.from,
      value: transaction.value?.toString(),
      data: transaction.data // Use 'data' instead of 'input'
    });

    return transaction;
  } catch (error: any) {
    console.error(`❌ Error fetching transaction details from Alchemy:`, error.message);
    logger.error("Error fetching transaction details from Alchemy:", error.message);
    throw error;
  }
}

// Function to decode ERC-20 transfer data
function decodeERC20Transfer(input: string) {
  try {
    console.log(`🔍 Decoding ERC-20 transfer input: ${input}`);
    
    // ERC-20 transfer function signature: transfer(address,uint256)
    // Method ID: 0xa9059cbb
    const transferMethodId = '0xa9059cbb';
    
    if (!input.startsWith(transferMethodId)) {
      console.log(`❌ Input does not start with transfer method ID: ${transferMethodId}`);
      return null;
    }

    // Remove method ID (4 bytes = 8 hex characters)
    const data = input.slice(10); // Remove '0xa9059cbb'
    console.log(`📝 Data after removing method ID: ${data}`);
    
    // Extract recipient address (32 bytes = 64 hex characters)
    const recipientHex = data.slice(0, 64);
    const recipient = '0x' + recipientHex.slice(24); // Remove padding
    console.log(`👤 Recipient address: ${recipient}`);
    
    // Extract amount (32 bytes = 64 hex characters)
    const amountHex = data.slice(64, 128);
    const amount = new BigNumber('0x' + amountHex);
    console.log(`💰 Amount: ${amount.toString()}`);
    
    const result = {
      recipient: recipient.toLowerCase(),
      amount: amount.toString()
    };
    
    console.log(`✅ ERC-20 transfer decoded:`, result);
    return result;
  } catch (error) {
    console.error(`❌ Error decoding ERC-20 transfer:`, error);
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
  console.log(`🔍 Starting transaction validation:`, {
    expectedAmount,
    expectedTokenAddress,
    expectedToAddress,
    transactionTo: transaction.to,
    transactionValue: transaction.value?.toString(),
    transactionData: transaction.data
  });

  const errors: string[] = [];

  // Check if this is a native ETH transfer or ERC-20 transfer
  const isERC20 = isERC20Token(expectedTokenAddress);
  console.log(`🪙 Token type check: ${isERC20 ? 'ERC-20' : 'Native ETH'}`);
  
  if (!isERC20) {
    // For native ETH transfers - validate to address
    console.log(`📍 Validating to address for native ETH: Expected ${expectedToAddress}, Got ${transaction.to}`);
    if (transaction.to?.toLowerCase() !== expectedToAddress.toLowerCase()) {
      const error = `Invalid to address. Expected: ${expectedToAddress}, Got: ${transaction.to}`;
      console.log(`❌ ${error}`);
      errors.push(error);
    } else {
      console.log(`✅ To address validation passed for native ETH`);
    }

    // For native ETH transfers - validate amount
    console.log(`💰 Validating native ETH transfer`);
    const actualValue = transaction.value ? new BigNumber(transaction.value.toString()) : new BigNumber(0);
    // Convert expected amount to wei (18 decimals)
    const expectedValue = new BigNumber(expectedAmount).multipliedBy(10 ** 18);
    
    console.log(`📊 Amount comparison:`, {
      actualValue: actualValue.toString(),
      expectedValue: expectedValue.toString(),
      expectedAmount,
      decimals: 18
    });
    
    if (!actualValue.eq(expectedValue)) {
      const error = `Invalid amount. Expected: ${expectedValue.toString()} wei, Got: ${actualValue.toString()}`;
      console.log(`❌ ${error}`);
      errors.push(error);
    } else {
      console.log(`✅ Amount validation passed for native ETH`);
    }
  } else {
    // For ERC-20 transfers - validate token contract address
    console.log(`📍 Validating token contract address: Expected ${expectedTokenAddress}, Got ${transaction.to}`);
    if (transaction.to?.toLowerCase() !== expectedTokenAddress.toLowerCase()) {
      const error = `Invalid token contract address. Expected: ${expectedTokenAddress}, Got: ${transaction.to}`;
      console.log(`❌ ${error}`);
      errors.push(error);
    } else {
      console.log(`✅ Token contract address validation passed`);
    }

    // For ERC-20 transfers, decode the input data to get recipient and amount
    console.log(`🪙 Validating ERC-20 transfer data`);
    if (transaction.data === '0x' || !transaction.data) {
      const error = 'Invalid token transfer - no input data for ERC-20 transfer';
      console.log(`❌ ${error}`);
      errors.push(error);
      return errors;
    }

    const decodedTransfer = decodeERC20Transfer(transaction.data);
    if (!decodedTransfer) {
      const error = 'Invalid ERC-20 transfer data';
      console.log(`❌ ${error}`);
      errors.push(error);
      return errors;
    }

    // Validate recipient from decoded data
    console.log(`👤 Validating ERC-20 recipient: Expected ${expectedToAddress}, Got ${decodedTransfer.recipient}`);
    if (decodedTransfer.recipient !== expectedToAddress.toLowerCase()) {
      const error = `Invalid recipient in ERC-20 transfer. Expected: ${expectedToAddress}, Got: ${decodedTransfer.recipient}`;
      console.log(`❌ ${error}`);
      errors.push(error);
    } else {
      console.log(`✅ ERC-20 recipient validation passed`);
    }

    // Validate amount - use proper token decimals
    console.log(`💰 Validating ERC-20 amount`);
    const actualAmount = new BigNumber(decodedTransfer.amount);
    const stratoTokenAddress = ETH_STRATO_TOKEN_MAPPING[expectedTokenAddress as keyof typeof ETH_STRATO_TOKEN_MAPPING] || expectedTokenAddress;
    const tokenDecimals = getTokenDecimals(stratoTokenAddress);
    const expectedValue = new BigNumber(expectedAmount).multipliedBy(10 ** tokenDecimals);
    
    console.log(`📊 ERC-20 amount comparison:`, {
      actualAmount: actualAmount.toString(),
      expectedValue: expectedValue.toString(),
      expectedAmount,
      tokenDecimals
    });
    
    if (!actualAmount.eq(expectedValue)) {
      const error = `Invalid amount in ERC-20 transfer. Expected: ${expectedValue.toString()}, Got: ${actualAmount.toString()}`;
      console.log(`❌ ${error}`);
      errors.push(error);
    } else {
      console.log(`✅ ERC-20 amount validation passed`);
    }
  }

  console.log(`🏁 Validation complete. Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log(`❌ Validation errors:`, errors);
  } else {
    console.log(`✅ All validations passed`);
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
      console.log(`🚀 BridgeIn request received:`, req.body);
      const { fromAddress, amount, tokenAddress, ethHash } = req.body;

      // Validate required fields
      console.log(`🔍 Validating required fields...`);
      if (!ethHash) {
        console.log(`❌ Missing ethHash parameter`);
        res.status(400).json({ 
          success: false, 
          message: 'Missing ethHash parameter' 
        });
        return;
      }
      console.log(`✅ Required fields validation passed`);

      // Fetch transaction details from Alchemy API
      console.log(`🔍 Fetching transaction details from Alchemy...`);
      let transactionDetails;
      try {
        transactionDetails = await fetchTransactionDetails(ethHash);
        console.log(`✅ Transaction details fetched successfully`);
      } catch (error: any) {
        console.log(`❌ Failed to fetch transaction details: ${error.message}`);
        res.status(400).json({ 
          success: false, 
          message: `Failed to fetch transaction details: ${error.message}` 
        });
        return;
      }

      // Validate transaction details
      console.log(`🔍 Starting transaction validation...`);
      const expectedToAddress = config.safe.address || '';
      console.log(`📍 Expected to address: ${expectedToAddress}`);
      
      const validationErrors = validateTransactionDetails(
        transactionDetails,
        amount,
        tokenAddress,
        expectedToAddress
      );

      if (validationErrors.length > 0) {
        console.log(`❌ Validation failed with ${validationErrors.length} errors`);
        res.status(400).json({ 
          success: false, 
          message: 'Invalid amount or tokenAddress',
          errors: validationErrors
        });
        return;
      }
      console.log(`✅ Transaction validation passed`);

      const { userAddress } = req.user || {};
      if (!userAddress) {
        console.log(`❌ Missing user address`);
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }
      console.log(`👤 User address: ${userAddress}`);

      const toAddress = config.safe.address || '';
      console.log(`📍 To address: ${toAddress}`);
  
      const stratoTokenAddress = ETH_STRATO_TOKEN_MAPPING[tokenAddress as keyof typeof ETH_STRATO_TOKEN_MAPPING] || tokenAddress;
      console.log(`🪙 Token mapping: ${tokenAddress} -> ${stratoTokenAddress}`);
      
      const decimals = getTokenDecimals(stratoTokenAddress);
      console.log(`🔢 Token decimals: ${decimals}`);
      
      const amountInWei = new BigNumber(amount).multipliedBy(10 ** decimals).toString();
      console.log(`💰 Amount conversion: ${amount} -> ${amountInWei} (with ${decimals} decimals)`);
    
      console.log(`🚀 Calling bridgeIn service with:`, {
        ethHash,
        stratoTokenAddress,
        fromAddress,
        amountInWei,
        toAddress,
        userAddress
      });
      
      const bridgeInResponse = await bridgeIn(
        ethHash,
        stratoTokenAddress,
        fromAddress,
        amountInWei,
        toAddress,
        userAddress
      );
      
      console.log(`✅ BridgeIn service call successful:`, bridgeInResponse);
  
      res.json({
        success: true,
        bridgeInResponse,
      });
    } catch (error: any) {
      console.error(`❌ Error in bridgeIn:`, error?.message);
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
      console.log("bridgeOut called.....",req.body);
      const {  amount, tokenAddress, toAddress } = req.body;

        const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }

      const decimals = getTokenDecimals(tokenAddress);

      const fromAddress = config.safe.address || '';
      
      const bridgeOutResponse = await bridgeOut(
        tokenAddress,
        fromAddress,
        new BigNumber(amount).multipliedBy(10 ** decimals).toString(),
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

      console.log("tokenAddress",tokenAddress);
      console.log("userAddress",userAddress);

    
      const balanceData = await stratoTokenBalance(userAddress, tokenAddress);

      const decimals = getTokenDecimals(tokenAddress);
      console.log("decimals",decimals);
      console.log("balanceData.balance",balanceData.balance);
      const balance = new BigNumber(balanceData.balance).div(10**decimals);
      console.log("balanceData",balanceData);

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
