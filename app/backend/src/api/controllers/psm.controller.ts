import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPsmInfo,
  psmMint,
  psmRequestBurn,
  psmCompleteBurn,
  psmCancelBurn,
} from "../services/psm.service";

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
      const { amount, againstToken } = body;

      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid amount" });
        return;
      }
      if (!againstToken) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Missing againstToken" });
        return;
      }

      const result = await psmMint(accessToken, userAddress as string, { amount, againstToken });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async requestBurn(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      const result = await psmRequestBurn(accessToken, userAddress as string, { amount, redeemToken });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async completeBurn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const { id } = body;

      if (!id) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Missing burn request id" });
        return;
      }

      const result = await psmCompleteBurn(accessToken, userAddress as string, { id });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async cancelBurn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const { id } = body;

      if (!id) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Missing burn request id" });
        return;
      }

      const result = await psmCancelBurn(accessToken, userAddress as string, { id });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default PsmController;
