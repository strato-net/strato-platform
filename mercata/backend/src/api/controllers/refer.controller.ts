import { Request, Response, NextFunction } from "express";
import { depositToEscrow, DepositParams, getEscrowDeposit, EscrowDepositQuery, redeemEscrow, RedeemParams, getUserReferrals, cancelDeposit, CancelDepositParams, getReferralHistory } from "../services/refer.service";
import { TransactionResponse } from "@mercata/shared-types";
import { constants } from "../../config/constants";
import { referralUrl } from "../../config/config";

class ReferController {
  static async deposit(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      
        // Validate required fields
        const { tokens, amounts, ephemeralAddress, expiry } = body;
        
        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
          res.status(400).json({ error: "tokens array is required and must not be empty" });
          return;
        }
        
        if (!amounts || !Array.isArray(amounts) || amounts.length === 0) {
          res.status(400).json({ error: "amounts array is required and must not be empty" });
          return;
        }
        
        if (tokens.length !== amounts.length) {
          res.status(400).json({ error: "tokens and amounts arrays must have the same length" });
          return;
        }
        
        if (!ephemeralAddress) {
          res.status(400).json({ error: "ephemeralAddress is required" });
          return;
        }

        if (expiry === undefined || typeof expiry !== "number" || expiry <= 0) {
          res.status(400).json({ error: "expiry is required and must be a positive number of seconds" });
          return;
        }

        const params: DepositParams = {
          tokens,
          amounts,
          ephemeralAddress,
          expiry,
        };

      const result: TransactionResponse = await depositToEscrow(
        accessToken,
        userAddress as string,
        params
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async getDeposit(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { ephemeralAddress, tokenAddress } = req.query;

      if (!ephemeralAddress || typeof ephemeralAddress !== "string") {
        res.status(400).json({ error: "ephemeralAddress is required" });
        return;
      }

      const query: EscrowDepositQuery = {
        ephemeralAddress,
        ...(tokenAddress && typeof tokenAddress === "string" && { tokenAddress }),
      };

      const result = await getEscrowDeposit(accessToken, query);

      if (!result) {
        res.status(404).json({ error: "Deposit not found" });
        return;
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
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
      
      // Validate required fields
      const { r, s, v, recipient } = body;
      
      if (!r || typeof r !== "string") {
        res.status(400).json({ error: "r is required" });
        return;
      }
      
      if (!s || typeof s !== "string") {
        res.status(400).json({ error: "s is required" });
        return;
      }
      
      if (typeof v !== "number") {
        res.status(400).json({ error: "v is required and must be a number" });
        return;
      }
      
      if (!recipient || typeof recipient !== "string") {
        res.status(400).json({ error: "recipientAddress is required" });
        return;
      }

      const params: RedeemParams = {
        r,
        s,
        v,
        recipient,
      };

      // Get redemption server URL from environment variable
      const redemptionServerUrl = process.env.REDEMPTION_SERVER_URL || referralUrl;
      
      if (!redemptionServerUrl) {
        res.status(500).json({ error: "Redemption server URL not configured. Please set REDEMPTION_SERVER_URL environment variable." });
        return;
      }

      const result = await redeemEscrow(accessToken, params, redemptionServerUrl);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async getReferrals(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;

      if (!userAddress || typeof userAddress !== "string") {
        res.status(400).json({ error: "User address is required" });
        return;
      }

      const result = await getUserReferrals(accessToken, userAddress as string);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async cancel(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      
      const { ephemeralAddress } = body;

      if (!ephemeralAddress || typeof ephemeralAddress !== "string") {
        res.status(400).json({ error: "ephemeralAddress is required" });
        return;
      }

      const params: CancelDepositParams = {
        ephemeralAddress,
      };

      const result: TransactionResponse = await cancelDeposit(
        accessToken,
        userAddress as string,
        params
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async getHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;

      if (!userAddress || typeof userAddress !== "string") {
        res.status(400).json({ error: "User address is required" });
        return;
      }

      const result = await getReferralHistory(accessToken, userAddress as string);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }
}

export default ReferController;

