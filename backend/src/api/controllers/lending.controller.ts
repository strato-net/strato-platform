import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPool,
  manageLiquidity,
  getLoan,
  repayLoan,
  getDepositableTokens,
  getWithdrawableTokens,
  getLoans,
  setPrice,
} from "../services/lending.service";
import {
  validateManageLiquidityArgs,
  validateGetLoanArgs,
  validateRepayLoanArgs,
} from "../validators/lending.validator";

class LendingController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const pool = await getPool(accessToken, query as Record<string, string>);
      res.status(RestStatus.OK).json(pool);
    } catch (error) {
      next(error);
    }
  }

  static async manageLiquidity(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateManageLiquidityArgs(body);

      const result = await manageLiquidity(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async getLoan(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateGetLoanArgs(body);

      const result = await getLoan(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async repayLoan(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateRepayLoanArgs(body);

      const result = await repayLoan(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async getDepositableTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;
      const result = await getDepositableTokens(accessToken, address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getWithdrawableTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;
      const result = await getWithdrawableTokens(
        accessToken,
        address as string
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getLoans(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;
      const result = await getLoans(accessToken, address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      const result = await setPrice(accessToken, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default LendingController;
