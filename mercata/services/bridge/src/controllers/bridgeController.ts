import { Request, Response, NextFunction } from "express";
import BigNumber from "bignumber.js";
import logger from "../utils/logger";
import { getUserAddressFromToken } from "../utils";
import { bridgeIn, stratoTokenBalance, bridgeOut, userWithdrawalStatus, userDepositStatus, getBridgeInTokens, getBridgeOutTokens } from "../services/bridgeService";
import { config, TESTNET_ETH_STRATO_TOKEN_MAPPING, MAINNET_ETH_STRATO_TOKEN_MAPPING, MAINNET_STRATO_TOKENS, TESTNET_STRATO_TOKENS } from "../config";

interface CustomRequest extends Request {
  user?: {
    userAddress: string;
  };
}


// Define the type for token addresses
const ETH_STRATO_TOKEN_MAPPING = process.env.SHOW_TESTNET === 'true' ? TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING;
const STRATO_TOKENS = process.env.SHOW_TESTNET === 'true' ? TESTNET_STRATO_TOKENS : MAINNET_STRATO_TOKENS;

class BridgeController {
  static async bridgeIn(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { fromAddress, amount, tokenAddress, ethHash } = req.body;
  
      const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }

      const toAddress = config.safe.address || '';
  
      const stratoTokenAddress = ETH_STRATO_TOKEN_MAPPING[tokenAddress as keyof typeof ETH_STRATO_TOKEN_MAPPING] || tokenAddress;
      const decimals = STRATO_TOKENS.find((tokenObj) => tokenObj.tokenAddress === stratoTokenAddress)?.decimals || 18;
    
      const bridgeInResponse = await bridgeIn(
        ethHash,
        stratoTokenAddress,
        fromAddress,
        new BigNumber(amount).multipliedBy(10 ** decimals).toString(),
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
      console.log("bridgeOut called.....",req.body);
      const {  amount, tokenAddress, toAddress } = req.body;

        const { userAddress } = req.user || {};
      if (!userAddress) {
        res.status(401).json({ success: false, message: 'Unauthorized: Missing user address' });
        return;
      }

      const decimals = STRATO_TOKENS.find((tokenObj: { tokenAddress: any; }) => tokenObj.tokenAddress === tokenAddress)?.decimals || 18;

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

      const decimals = STRATO_TOKENS.find((tokenObj: { tokenAddress: any; }) => tokenObj.tokenAddress === tokenAddress)?.decimals || 18;
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
