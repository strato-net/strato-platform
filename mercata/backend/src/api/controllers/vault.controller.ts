import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getVaultInfo,
  getUserPosition,
  getUserBalances,
  getWithdrawPreview,
  deposit,
  withdraw,
  pause,
  unpause,
  setMinReserve,
  setBotExecutor,
  addSupportedAsset,
  removeSupportedAsset,
  getTransactions,
} from "../services/vault.service";
import {
  validateDepositArgs,
  validateWithdrawArgs,
  validateSetMinReserveArgs,
  validateSetBotExecutorArgs,
  validateAssetArgs,
} from "../validators/vault.validator";

class VaultController {
  /**
   * Get vault global state (info)
   */
  static async getInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const vaultInfo = await getVaultInfo(accessToken);
      res.status(RestStatus.OK).json(vaultInfo);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's position in the vault
   */
  static async getUserPosition(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const position = await getUserPosition(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(position);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's token balances for supported vault assets
   */
  static async getBalances(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const balances = await getUserBalances(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(balances);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get vault transactions (deposits and withdrawals)
   */
  static async getTransactions(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const limit = parseInt(query.limit as string) || 20;
      const result = await getTransactions(accessToken, limit);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Deposit tokens into the vault
   */
  static async deposit(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateDepositArgs(body);
      const result = await deposit(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Preview withdrawal basket
   */
  static async withdrawPreview(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const amountUsd = query.amountUsd as string;
      if (!amountUsd) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "amountUsd is required" });
        return;
      }
      const result = await getWithdrawPreview(accessToken, amountUsd);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Withdraw from the vault
   */
  static async withdraw(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateWithdrawArgs(body);
      const result = await withdraw(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ADMIN METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Pause the vault (admin only)
   */
  static async pause(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await pause(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unpause the vault (admin only)
   */
  static async unpause(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await unpause(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Set minimum reserve for an asset (admin only)
   */
  static async setMinReserve(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSetMinReserveArgs(body);
      const result = await setMinReserve(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Set bot executor address (admin only)
   */
  static async setBotExecutor(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateSetBotExecutorArgs(body);
      const result = await setBotExecutor(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add a supported asset to the vault (admin only)
   */
  static async addAsset(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateAssetArgs(body);
      const result = await addSupportedAsset(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove a supported asset from the vault (admin only)
   */
  static async removeAsset(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateAssetArgs(body);
      const result = await removeSupportedAsset(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default VaultController;
