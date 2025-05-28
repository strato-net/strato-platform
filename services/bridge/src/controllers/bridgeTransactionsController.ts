import { Request, Response } from 'express';
import { getAllBridgeTransactions } from '../services/bridgeTransactionsService';

export async function getAllBridgeTransactionsHandler(req: Request, res: Response) {
  try {
    const { type } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    
    if (!type || !['withdrawalinitiated', 'depositrecorded'].includes(type.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Invalid transaction type. Must be either 'withdrawalinitiated' or 'depositrecorded'"
      });
    }

    const transactions = await getAllBridgeTransactions(type, limit, offset);
    let data = transactions;
    let total = 0;
    if (transactions && typeof transactions === 'object' && 'data' in transactions && Array.isArray((transactions as any).data)) {
      data = (transactions as any).data;
      total = (transactions as any).total ?? (transactions as any).data.length;
    } else if (Array.isArray(transactions)) {
      data = transactions;
      total = transactions.length;
    }
    res.status(200).json({
      success: true,
      data,
      total
    });
  } catch (error: any) {
    console.error("Error in getAllBridgeTransactionsHandler:", error?.message);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to fetch bridge transactions"
    });
  }
} 