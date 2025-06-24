import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPool,
  depositLiquidity,
  withdrawLiquidity,
  borrow,
  repay,
  getDepositableTokens,
  getWithdrawableTokens,
  getLoans,
  listLiquidatableLoans,
  listNearUnhealthyLoans,
  getLoanWithHealthFactor,
  executeLiquidation as executeLiquidationService,
  setInterestRate as setInterestRateService,
  setCollateralRatio as setCollateralRatioService,
  setLiquidationBonus as setLiquidationBonusService,
} from "../services/lending.service";
import {
  validateManageLiquidityArgs,
  validateGetLoanArgs,
  validateRepayLoanArgs,
  validateLoanIdParam,
  validateMarginQuery,
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

  static async depositLiquidity(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateManageLiquidityArgs(body);

      const result = await depositLiquidity(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async withdrawLiquidity(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateManageLiquidityArgs(body);

      const result = await withdrawLiquidity(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async borrow(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateGetLoanArgs(body);

      const result = await borrow(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async repay(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateRepayLoanArgs(body);

      const result = await repay(accessToken, body);
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

  // -------- Liquidation & loan extras ---------

  static async listLiquidatable(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken } = req;
      const loans = await listLiquidatableLoans(accessToken);
      res.status(RestStatus.OK).json(loans);
    } catch (error) {
      next(error);
    }
  }

  static async listNearUnhealthy(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, query } = req;
      // Validate and parse margin query (optional, default 0.2)
      validateMarginQuery(query);
      const marginRaw = typeof query.margin === "string" ? parseFloat(query.margin) : undefined;
      const margin = !isNaN(Number(marginRaw)) ? Number(marginRaw) : 0.2; // default 20%

      const loans = await listNearUnhealthyLoans(accessToken, margin);
      res.status(RestStatus.OK).json(loans);
    } catch (error) {
      next(error);
    }
  }

  static async getLiquidatable(req: Request, res: Response, next: NextFunction) {
    try {
      validateLoanIdParam(req.params);
      const { accessToken } = req;
      const id = req.params.id;

      const loan = await getLoanWithHealthFactor(accessToken, id);
      if (!loan) {
        res.status(RestStatus.NOT_FOUND).json({ error: "Loan not found" });
        return;
      }

      res.status(RestStatus.OK).json(loan);
    } catch (error) {
      next(error);
    }
  }

  static async executeLiquidation(req: Request, res: Response, next: NextFunction) {
    try {
      validateLoanIdParam(req.params);
      const { accessToken } = req;
      const id = req.params.id;

      const result = await executeLiquidationService(accessToken, id);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      next(error);
    }
  }

  static async getLoanById(req: Request, res: Response, next: NextFunction) {
    try {
      validateLoanIdParam(req.params);
      const { accessToken } = req;
      const id = req.params.id;

      const loan = await getLoanWithHealthFactor(accessToken, id);
      if (!loan) {
        res.status(RestStatus.NOT_FOUND).json({ error: "Loan not found" });
        return;
      }

      res.status(RestStatus.OK).json(loan);
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
      const { method, ...payload } = body as Record<string, any>;

      if (method === "depositLiquidity") {
        validateManageLiquidityArgs(payload);
        const result = await depositLiquidity(accessToken, payload);
        res.status(RestStatus.OK).json(result);
        return next();
      }
      if (method === "withdrawLiquidity") {
        validateManageLiquidityArgs(payload);
        const result = await withdrawLiquidity(accessToken, payload);
        res.status(RestStatus.OK).json(result);
        return next();
      }

      // If method not supported
      res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid method" });
      return next();
    } catch (error) {
      return next(error);
    }
  }

  // ---------------- Admin Configuration Methods ----------------

  static async setInterestRate(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const payload = req.body;

      if (!payload.asset || payload.rate === undefined) {
        res.status(RestStatus.BAD_REQUEST).json({ 
          error: "Missing required parameters: asset and rate" 
        });
        return next();
      }

      const result = await setInterestRateService(accessToken, payload);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async setCollateralRatio(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const payload = req.body;

      if (!payload.asset || payload.ratio === undefined) {
        res.status(RestStatus.BAD_REQUEST).json({ 
          error: "Missing required parameters: asset and ratio" 
        });
        return next();
      }

      const result = await setCollateralRatioService(accessToken, payload);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async setLiquidationBonus(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const payload = req.body;

      if (!payload.asset || payload.bonus === undefined) {
        res.status(RestStatus.BAD_REQUEST).json({ 
          error: "Missing required parameters: asset and bonus" 
        });
        return next();
      }

      const result = await setLiquidationBonusService(accessToken, payload);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }
}

export default LendingController;
