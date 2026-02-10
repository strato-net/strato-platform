import { Request, Response, NextFunction } from "express";
import {
  getConfigs,
  getConfigById,
  getCardsFromCirrus,
  upsertConfig,
  deleteConfig,
  submitApproval,
  getCardBalance,
  submitAddCard,
  submitUpdateCard,
  submitRemoveCard,
} from "../services/creditCard.service";
import { validateUpsertConfig, validateAddCardBody, validateUpdateCardBody } from "../validators/creditCard.validators";
import type { CreditCardConfig } from "@mercata/shared-types";

class CreditCardController {
  /** GET /credit-card — cards from Cirrus (no RPC). */
  static async getCards(
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
      const cards = await getCardsFromCirrus(accessToken, address);
      res.json(cards);
    } catch (error: any) {
      next(error);
    }
  }

  static async getConfigs(
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
      const configs = getConfigs(address);
      res.json(configs);
    } catch (error: any) {
      next(error);
    }
  }

  static async getConfigBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const address = req.address as string;
      const id = req.params.id;
      if (!address || !id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const config = getConfigById(address, id);
      if (!config) {
        res.status(404).json({ error: "Card not found" });
        return;
      }
      const balance = await getCardBalance(config);
      res.json({ balance: balance ?? null });
    } catch (error: any) {
      next(error);
    }
  }

  static async getBalanceByParams(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const destinationChainId = req.query.destinationChainId as string;
      const externalToken = req.query.externalToken as string;
      const cardWalletAddress = req.query.cardWalletAddress as string;
      if (!destinationChainId || !externalToken || !cardWalletAddress) {
        res.status(400).json({ error: "destinationChainId, externalToken, cardWalletAddress required" });
        return;
      }
      const balance = await getCardBalance({
        destinationChainId,
        externalToken,
        cardWalletAddress,
      } as Parameters<typeof getCardBalance>[0]);
      res.json({ balance: balance ?? null });
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
      const config = upsertConfig(address, req.body as Omit<CreditCardConfig, "userAddress"> & { id?: string });
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
      const id = req.params.id;
      if (!address || !id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const deleted = deleteConfig(address, id);
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

  /** POST /credit-card/add-card — submit addCard tx to STRATO (backend posts to strato/v2.3/transaction). */
  static async addCard(
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
      validateAddCardBody(req.body);
      const result = await submitAddCard(accessToken, address, req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      next(error);
    }
  }

  /** POST /credit-card/update-card — submit updateCard tx to STRATO. */
  static async updateCard(
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
      validateUpdateCardBody(req.body);
      const result = await submitUpdateCard(accessToken, address, req.body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      next(error);
    }
  }

  /** POST /credit-card/remove-card — submit removeCard tx to STRATO. */
  static async removeCard(
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
      const index = Number((req.body as { index?: number })?.index);
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({ error: "index must be a non-negative integer" });
        return;
      }
      const result = await submitRemoveCard(accessToken, address, index);
      res.json({ success: true, data: result });
    } catch (error: any) {
      next(error);
    }
  }
}

export default CreditCardController;
