import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getSafetyModuleInfo,
  getPublicSafetyModuleInfo,
  stakeSafetyModule,
  startCooldownSafetyModule,
  redeemSafetyModule,
  redeemAllSafetyModule,
} from "../services/safety.service";

class SafetyController {
  static async getInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const info = await getSafetyModuleInfo(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async getPublicInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const info = await getPublicSafetyModuleInfo(accessToken);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async stake(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const { amount } = body;

      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid amount" });
        return;
      }

      const result = await stakeSafetyModule(accessToken, userAddress as string, { amount });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async startCooldown(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await startCooldownSafetyModule(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async redeem(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const { sharesAmount } = body;

      if (!sharesAmount || isNaN(Number(sharesAmount)) || Number(sharesAmount) <= 0) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid shares amount" });
        return;
      }

      const result = await redeemSafetyModule(accessToken, userAddress as string, { sharesAmount });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async redeemAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await redeemAllSafetyModule(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default SafetyController;
