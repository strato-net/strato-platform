import { Request, Response, NextFunction } from "express";
import { getTransactions } from "../services/transactions.service";

class TransactionsController {
  static async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { address } = req.query;
      if (!address || typeof address !== "string") {
        res.status(400).json({ error: "Missing or invalid address" });
        return;
      }
      // Delegate to service
      const txs = await getTransactions(req.accessToken, address);
      res.json(txs);
      return;
    } catch (error) {
      next(error);
      return;
    }
  }
}

export default TransactionsController;
