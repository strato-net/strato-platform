import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { fetchUserBalance } from "../services/balanceService";
import logger from "../utils/logger";

class BalanceController {
  static async getBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address } = req.params;
      const { tokenAddress } = req.body;

      if (!address) {
        logger.error('Address is missing in request');
        res.status(RestStatus.BAD_REQUEST).json({
          success: false,
          error: 'Address is required'
        });
        return;
      }

      if (!tokenAddress) {
        logger.error('Token address is missing in request');
        res.status(RestStatus.BAD_REQUEST).json({
          success: false,
          error: 'Token address is required'
        });
        return;
      }

      logger.info('Fetching balance for address:', address, 'and token:', tokenAddress);
      const balanceData = await fetchUserBalance(address, tokenAddress);
      
      logger.info('Successfully fetched balance:', balanceData);
      res.status(RestStatus.OK).json({
        success: true,
        data: {
          balance: balanceData.balance || '0'
        }
      });
    } catch (error: any) {
      logger.error('Error in getBalance:', error?.message);
      next(error);
    }
  }
}

export default BalanceController; 