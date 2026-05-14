import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getSaleInfo,
  getUserPosition,
  quoteBuy,
  buy,
  getRecentPurchases,
  pauseSale,
  unpauseSale,
  addPaymentToken,
  removePaymentToken,
  setPricePerToken,
  setHardCap,
  setPerWalletCap,
  setSchedule,
  sweepProceeds,
  sweepUnsold,
} from "../services/fixedPriceSale.service";
import {
  validateBuyArgs,
  validateQuoteArgs,
  validatePaymentTokenArgs,
  validateSetPriceArgs,
  validateSetHardCapArgs,
  validateSetPerWalletCapArgs,
  validateSetScheduleArgs,
  validateSweepProceedsArgs,
  validateSweepUnsoldArgs,
} from "../validators/fixedPriceSale.validator";

class FixedPriceSaleController {
  static async getInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken } = req;
      const info = await getSaleInfo(accessToken);
      if (!info) {
        res.status(RestStatus.NOT_FOUND).json({ error: "Fixed price sale not configured" });
        return;
      }
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async getUserPosition(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const position = await getUserPosition(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(position);
    } catch (error) {
      next(error);
    }
  }

  static async quote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      const args = {
        paymentToken: query.paymentToken as string,
        saleAmount: query.saleAmount as string,
      };
      validateQuoteArgs(args);
      const result = await quoteBuy(accessToken, args.paymentToken, args.saleAmount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async buy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateBuyArgs(body);
      const result = await buy(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async recentPurchases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      const limit = parseInt(query.limit as string) || 20;
      const result = await getRecentPurchases(accessToken, limit);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ─── admin ─────────────────────────────────────────────────────────────────

  static async pause(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await pauseSale(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async unpause(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await unpauseSale(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async addPaymentToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validatePaymentTokenArgs(body);
      const result = await addPaymentToken(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async removePaymentToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validatePaymentTokenArgs(body);
      const result = await removePaymentToken(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setPrice(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSetPriceArgs(body);
      const result = await setPricePerToken(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setHardCap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSetHardCapArgs(body);
      const result = await setHardCap(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setPerWalletCap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSetPerWalletCapArgs(body);
      const result = await setPerWalletCap(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSetScheduleArgs(body);
      const result = await setSchedule(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async sweepProceeds(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSweepProceedsArgs(body);
      const result = await sweepProceeds(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async sweepUnsold(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSweepUnsoldArgs(body);
      const result = await sweepUnsold(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default FixedPriceSaleController;
