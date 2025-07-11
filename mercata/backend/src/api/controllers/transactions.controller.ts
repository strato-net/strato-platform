import { Request, Response, NextFunction } from "express";
import axios from "axios";

class TransactionsController {
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { address } = req.query;
      if (!address || typeof address !== "string") {
        return res.status(400).json({ error: "Missing or invalid address" });
      }
      // Use NODE_URL for Strato node API endpoint
      const stratoUrl = process.env.NODE_URL;
      if (!stratoUrl) {
        return res.status(500).json({ error: "NODE_URL environment variable not set" });
      }
      const apiUrl = `${stratoUrl}/strato-api/eth/v1.2/transaction/last/100`;
      console.log("[/transactions] Fetching from Strato node URL:", apiUrl);
      const response = await axios.get(apiUrl, {
        headers: {
          Authorization: `Bearer ${req.accessToken}`,
        },
      });
      console.log("[/transactions] Strato API response.data:", response.data);
      if (Array.isArray(response.data) && response.data.length > 0) {
        console.log("[/transactions] First tx object:", response.data[0]);
      }
      // Return all transactions (no filtering)
      const txs = (Array.isArray(response.data) ? response.data : []).map((tx: any) => ({
        timestamp: tx.timestamp || tx.time || tx.blockTimestamp || "",
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        type: tx.type || tx.transactionType || "Unknown",
      }));
      console.log("[/transactions] mapped txs:", txs);
      res.json(txs);
      return;
    } catch (error) {
      next(error);
    }
  }
}

export default TransactionsController;
