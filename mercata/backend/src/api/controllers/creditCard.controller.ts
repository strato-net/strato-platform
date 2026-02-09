import { Request, Response, NextFunction } from "express";
import {
  getConfig,
  upsertConfig,
  deleteConfig,
  submitApproval,
} from "../services/creditCard.service";
import { validateUpsertConfig } from "../validators/creditCard.validators";
import type { CreditCardConfig } from "@mercata/shared-types";

class CreditCardController {
  static async getConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const address = req.address as string;
      if (!address) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const config = getConfig(address);
      res.json(config ?? null);
    } catch (error: any) {
      next(error);
    }
  }

  static async upsertConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const address = req.address as string;
      if (!address) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      validateUpsertConfig(req.body);
      const config = upsertConfig(address, req.body as Omit<CreditCardConfig, "userAddress">);
      res.json(config);
    } catch (error: any) {
      next(error);
    }
  }

  static async deleteConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const address = req.address as string;
      if (!address) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const deleted = deleteConfig(address);
      res.json({ deleted });
    } catch (error: any) {
      next(error);
    }
  }

  static async approve(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const address = req.address as string;
      const accessToken = req.accessToken as string;
      if (!address || !accessToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const amount = (req.body as { amount?: string })?.amount;
      if (!amount || typeof amount !== "string") {
        res.status(400).json({ error: "amount (string) is required" });
        return;
      }
      const result = await submitApproval(accessToken, address, amount);
      res.json({ success: true, data: result });
    } catch (error: any) {
      next(error);
    }
  }
}

export default CreditCardController;
