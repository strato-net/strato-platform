import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  claimYieldVault,
  deployYieldVaultCapital,
  depositYieldVault,
  getYieldVaultHistory,
  getYieldVaultInfo,
  getYieldVaultUserInfo,
  reportYieldVaultStrategyLoss,
  listVaultDefs,
  processYieldVaultQueue,
  redeemAllYieldVault,
  redeemYieldVault,
  resolveVaultDef,
  returnYieldVaultCapital,
  setYieldVaultMinIdleBps,
  setYieldVaultStrategyApproval,
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

const isHexAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isBpsString = (value: unknown): value is string => {
  if (!isPositiveIntegerString(value)) return false;
  try {
    return BigInt(value) <= 10000n;
  } catch {
    return false;
  }
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

  static async getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const duration = typeof req.query.duration === "string" ? req.query.duration : "all";
      const end = typeof req.query.end === "string" ? req.query.end : undefined;
      if (end !== undefined && !Number.isFinite(Date.parse(end))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid end date" });
        return;
      }
      const history = await getYieldVaultHistory(req.accessToken, key, duration, end);
      res.status(RestStatus.OK).json(history);
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

  static async claim(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const result = await claimYieldVault(req.accessToken, key, req.address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setStrategyApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { strategy, approved } = req.body || {};
      if (!isHexAddress(strategy) || !isBoolean(approved)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid strategy approval payload" });
        return;
      }
      const result = await setYieldVaultStrategyApproval(
        req.accessToken,
        key,
        req.address as string,
        strategy,
        approved
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setMinIdleBps(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { minIdleBps } = req.body || {};
      if (!isBpsString(minIdleBps)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid min idle bps" });
        return;
      }
      const result = await setYieldVaultMinIdleBps(req.accessToken, key, req.address as string, minIdleBps);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async deployCapital(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { strategy, assets } = req.body || {};
      if (!isHexAddress(strategy) || !isPositiveIntegerString(assets)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid deploy payload" });
        return;
      }
      const result = await deployYieldVaultCapital(
        req.accessToken,
        key,
        req.address as string,
        strategy,
        assets
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async returnCapital(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { strategy, assets } = req.body || {};
      if (!isHexAddress(strategy) || !isPositiveIntegerString(assets)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid return payload" });
        return;
      }
      const result = await returnYieldVaultCapital(
        req.accessToken,
        key,
        req.address as string,
        strategy,
        assets
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async reportLoss(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { strategy, loss } = req.body || {};
      if (!isHexAddress(strategy) || !isPositiveIntegerString(loss)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid loss payload" });
        return;
      }
      const result = await reportYieldVaultStrategyLoss(
        req.accessToken,
        key,
        req.address as string,
        strategy,
        loss
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async processQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = requireVaultKey(req, res);
      if (!key) return;
      const { maxRequests, maxAssets } = req.body || {};
      if (!isPositiveIntegerString(maxRequests) || !isPositiveIntegerString(maxAssets)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid process queue payload" });
        return;
      }
      const result = await processYieldVaultQueue(
        req.accessToken,
        key,
        req.address as string,
        maxRequests,
        maxAssets
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default YieldVaultController;
