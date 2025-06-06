import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";
import { getUserAddressFromToken } from "../utils";
import { bridgeIn, stratoTokenBalance, bridgeOut, userWithdrawalStatus, userDepositStatus } from "../services/bridgeService";
import { config } from "../config";

class BridgeController {
  static async bridgeIn(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {

      const { accessToken, fromAddress, amount, tokenAddress, ethHash } = req.body;

      const userAddress = await getUserAddressFromToken(accessToken);

      const toAddress = config.safe.address || '';

      const bridgeInResponse = await bridgeIn(ethHash, tokenAddress, fromAddress, amount, toAddress, userAddress);

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
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, amount, tokenAddress, toAddress } = req.body;

      const userAddress = await getUserAddressFromToken(accessToken);

      const fromAddress = config.safe.address || '';
      const bridgeOutResponse = await bridgeOut(
        tokenAddress,
        fromAddress,
        amount,
        toAddress,
        userAddress
      );

      res.json({
        success: true,
        bridgeOutResponse,
      });
    } catch (error: any) {
      logger.error("Error in bridgeOut:", error?.message);
      next(error);
    }
  }

  static async stratoTokenBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { tokenAddress, accessToken } = req.body;

      // Get user address from token
      const userAddress = await getUserAddressFromToken(accessToken);
      console.log("userAddress", userAddress);
      

      const balanceData = await stratoTokenBalance(userAddress, tokenAddress);

      res.json({
        success: true,
        data: balanceData,
      });
    } catch (error: any) {
      logger.error("Error in stratoToBalance:", error?.message);
      next(error);
    }
  }


  static async userDepositStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const depositStatus = await userDepositStatus();

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
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const withdrawalStatus = await userWithdrawalStatus();

      res.json({
        success: true,
        data: withdrawalStatus,
      });
    } catch (error: any) {
      logger.error("Error in fetching deposit status:", error?.message);
      next(error);
    }
  }
}

export default BridgeController;
