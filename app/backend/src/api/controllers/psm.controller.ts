import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getPsmInfo, psmMint, psmRedeem } from "../services/psm.service";

class PsmController {
  static async getInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const info = await getPsmInfo(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async mint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const { amount, againstToken, toSavings } = body;

      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid amount" });
        return;
      }
      if (!againstToken) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Missing againstToken" });
        return;
      }

      const result = await psmMint(accessToken, userAddress as string, {
        amount,
        againstToken,
        toSavings: Boolean(toSavings),
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async redeem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const { amount, redeemToken } = body;

      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid amount" });
        return;
      }
      if (!redeemToken) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Missing redeemToken" });
        return;
      }

      const result = await psmRedeem(accessToken, userAddress as string, { amount, redeemToken });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default PsmController;
