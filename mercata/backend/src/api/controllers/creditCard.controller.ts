import { Request, Response, NextFunction } from "express";
import {
  getConfigs,
  getConfigById,
  getCardsFromCirrus,
  getConfigsForWatcher,
  executeTopUp as executeTopUpService,
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
      const accessToken = req.accessToken as string;
      if (!address || !accessToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const configs = await getConfigs(accessToken, address);
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
      const accessToken = req.accessToken as string;
      const id = req.params.id;
      if (!address || !accessToken || !id) {
        res.status(400).json({ error: "Missing id or unauthorized" });
        return;
      }
      const config = await getConfigById(accessToken, address, id);
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
      const accessToken = req.accessToken as string;
      if (!address || !accessToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      validateUpsertConfig(req.body);
      const body = req.body as Omit<CreditCardConfig, "userAddress"> & { id?: string };
      if (body.id != null && body.id !== "") {
        const index = parseInt(String(body.id), 10);
        if (!Number.isInteger(index) || index < 0) {
          res.status(400).json({ error: "Invalid id for update" });
          return;
        }
        const result = await submitUpdateCard(accessToken, address, {
          index,
          nickname: body.nickname ?? "",
          providerId: body.providerId ?? "",
          destinationChainId: body.destinationChainId,
          externalToken: body.externalToken,
          cardWalletAddress: body.cardWalletAddress,
          thresholdAmount: body.thresholdAmount,
          cooldownMinutes: body.cooldownMinutes,
          topUpAmount: body.topUpAmount,
        });
        res.json({ success: true, data: result });
      } else {
        const result = await submitAddCard(accessToken, address, {
          nickname: body.nickname ?? "",
          providerId: body.providerId ?? "",
          destinationChainId: body.destinationChainId,
          externalToken: body.externalToken,
          cardWalletAddress: body.cardWalletAddress,
          thresholdAmount: body.thresholdAmount,
          cooldownMinutes: body.cooldownMinutes,
          topUpAmount: body.topUpAmount,
        });
        res.json({ success: true, data: result });
      }
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
      const accessToken = req.accessToken as string;
      const id = req.params.id;
      if (!address || !accessToken || !id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const index = parseInt(id, 10);
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      await submitRemoveCard(accessToken, address, index);
      res.json({ deleted: true });
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

  /** GET /credit-card/watcher-config — operator only: all card configs from Cirrus for the top-up watcher. */
  static async getWatcherConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const accessToken = req.accessToken as string;
      if (!accessToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const configs = await getConfigsForWatcher(accessToken);
      res.json(configs);
    } catch (error: any) {
      next(error);
    }
  }

  /** POST /credit-card/execute-top-up — operator only: run a single top-up (contract updates lastTopUpTimestamp on chain). */
  static async executeTopUp(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const accessToken = req.accessToken as string;
      const body = req.body as import("@mercata/shared-types").CreditCardTopUpExecuteParams;
      if (!body?.userAddress || !body?.stratoTokenAmount || !body?.externalChainId || !body?.externalRecipient || !body?.externalToken) {
        res.status(400).json({
          error: "userAddress, stratoTokenAmount, externalChainId, externalRecipient, externalToken required",
        });
        return;
      }
      const result = await executeTopUpService(accessToken, body);
      res.json({ success: true, data: result });
    } catch (error: any) {
      next(error);
    }
  }
}

export default CreditCardController;
