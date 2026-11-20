import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { constants } from "../../config/constants";
import {
  convert,
  fundConverterReserve,
  getConverterAccount,
  getConverterAdminStats,
  getConverterDailyVolume,
  getConverterHistory,
  getConverterMonthlyVolume,
  getConverterState,
  pauseConverter,
  setConverterRate,
  unpauseConverter,
  withdrawConverterReserve,
} from "../services/rewardsConverter.service";

const isPositiveIntegerString = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n;

const isAddress = (value: unknown): value is string =>
  typeof value === "string" && /^(0x)?[a-fA-F0-9]{40}$/.test(value);

const isMonth = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const badRequest = (res: Response, error: string): void => {
  res.status(RestStatus.BAD_REQUEST).json({ error });
};

class RewardsConverterController {
  /** Answers for every route but the state when this network has no converter. */
  static requireConfigured(_req: Request, res: Response, next: NextFunction): void {
    if (constants.rewardsConverter) return next();
    res.status(RestStatus.NOT_FOUND).json({ error: "Rewards converter is not configured on this network" });
  }

  static async getState(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(RestStatus.OK).json(await getConverterState(req.accessToken));
    } catch (error) {
      next(error);
    }
  }

  static async getAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(RestStatus.OK).json(await getConverterAccount(req.accessToken, req.address as string));
    } catch (error) {
      next(error);
    }
  }

  static async getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 10);
      if (!Number.isInteger(page) || page < 1) return badRequest(res, "Invalid page");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return badRequest(res, "Invalid limit");

      res.status(RestStatus.OK).json(
        await getConverterHistory(req.accessToken, req.address as string, page, limit)
      );
    } catch (error) {
      next(error);
    }
  }

  static async convert(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { amount } = req.body;
      if (!isPositiveIntegerString(amount)) return badRequest(res, "Invalid amount");

      res.status(RestStatus.OK).json(await convert(req.accessToken, req.address as string, amount));
    } catch (error) {
      next(error);
    }
  }

  static async getAdminStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(RestStatus.OK).json(await getConverterAdminStats(req.accessToken));
    } catch (error) {
      next(error);
    }
  }

  static async getDailyVolume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { month } = req.query;
      if (!isMonth(month)) return badRequest(res, "Invalid month, expected YYYY-MM");

      res.status(RestStatus.OK).json(await getConverterDailyVolume(req.accessToken, month));
    } catch (error) {
      next(error);
    }
  }

  static async getMonthlyVolume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(RestStatus.OK).json(await getConverterMonthlyVolume(req.accessToken));
    } catch (error) {
      next(error);
    }
  }

  static async setRate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rate } = req.body;
      if (!isPositiveIntegerString(rate)) return badRequest(res, "Invalid rate");

      res.status(RestStatus.OK).json(await setConverterRate(req.accessToken, req.address as string, rate));
    } catch (error) {
      next(error);
    }
  }

  static async pause(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(RestStatus.OK).json(await pauseConverter(req.accessToken, req.address as string));
    } catch (error) {
      next(error);
    }
  }

  static async unpause(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.status(RestStatus.OK).json(await unpauseConverter(req.accessToken, req.address as string));
    } catch (error) {
      next(error);
    }
  }

  static async withdrawReserve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { to, amount } = req.body;
      if (!isAddress(to)) return badRequest(res, "Invalid recipient address");
      if (!isPositiveIntegerString(amount)) return badRequest(res, "Invalid amount");

      res.status(RestStatus.OK).json(
        await withdrawConverterReserve(req.accessToken, req.address as string, to, amount)
      );
    } catch (error) {
      next(error);
    }
  }

  static async fundReserve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { amount } = req.body;
      if (!isPositiveIntegerString(amount)) return badRequest(res, "Invalid amount");

      res.status(RestStatus.OK).json(
        await fundConverterReserve(req.accessToken, req.address as string, amount)
      );
    } catch (error) {
      next(error);
    }
  }
}

export default RewardsConverterController;
