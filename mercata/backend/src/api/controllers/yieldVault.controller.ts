import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  depositYieldVault,
  getYieldVaultInfo,
  getYieldVaultUserInfo,
  listVaultDefs,
  redeemAllYieldVault,
  redeemYieldVault,
  resolveVaultDef,
} from "../services/yieldVault.service";

const isPositiveIntegerString = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  if (!/^\d+$/.test(value.trim())) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
};

const requireVaultKey = (req: Request, res: Response): string | null => {
  const key = req.params.key;
  if (!key || !resolveVaultDef(key)) {
    res.status(RestStatus.NOT_FOUND).json({ error: `Unknown yield vault: ${key}` });
    return null;
  }
  return key;
};

class YieldVaultController {
  static async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(RestStatus.OK).json(listVaultDefs());
    } catch (error) {
      next(error);
    }
  }

  static async getInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const info = await getYieldVaultInfo(req.accessToken, key);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async getUserInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const info = await getYieldVaultUserInfo(req.accessToken, key, req.address as string);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async deposit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { amount } = req.body || {};
      if (!isPositiveIntegerString(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid amount" });
        return;
      }
      const result = await depositYieldVault(req.accessToken, key, req.address as string, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async redeem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { sharesAmount } = req.body || {};
      if (!isPositiveIntegerString(sharesAmount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid shares amount" });
        return;
      }
      const result = await redeemYieldVault(req.accessToken, key, req.address as string, sharesAmount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async redeemAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const result = await redeemAllYieldVault(req.accessToken, key, req.address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default YieldVaultController;
