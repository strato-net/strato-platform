import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPool,
  depositLiquidity,
  withdrawLiquidity,
  borrow,
  repay,
  executeLiquidation as executeLiquidationService,
  setInterestRate as setInterestRateService,
  setCollateralRatio as setCollateralRatioService,
  setLiquidationBonus as setLiquidationBonusService,
  supplyCollateral,
  withdrawCollateral,
  collateralAndBalance,
  liquidityAndBalance,
  getLoan,
} from "../services/lending.service";
import {
  validateDepositLiquidityArgs,
  validateWithdrawLiquidityArgs,
  validateBorrowArgs,
  validateRepayArgs,
  validateSupplyCollateralArgs,
  validateWithdrawCollateralArgs,
  validateSetInterestRateArgs,
  validateSetCollateralRatioArgs,
  validateSetLiquidationBonusArgs,
} from "../validators/lending.validator";

class LendingController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, query } = req;
      const pool = await getPool(accessToken, userAddress as string, query as Record<string, string>);
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
      validateDepositLiquidityArgs(body);

      const result = await depositLiquidity(accessToken, body.amount);
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
      validateWithdrawLiquidityArgs(body);

      const result = await withdrawLiquidity(accessToken, body.amount);
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
      validateBorrowArgs(body);

      const result = await borrow(accessToken, body.amount);
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
      validateRepayArgs(body);

      const result = await repay(accessToken, body.amount);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }



  static async supplyCollateral(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateSupplyCollateralArgs(body);

      const result = await supplyCollateral(accessToken, body.asset, body.amount);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async withdrawCollateral(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateWithdrawCollateralArgs(body);

      const result = await withdrawCollateral(accessToken, body.asset, body.amount);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async getCollateralAndBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;
      if (!address) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User address is required" });
        return;
      }

      const result = await collateralAndBalance(accessToken, address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getLiquidityAndBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;
      if (!address) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User address is required" });
        return;
      }

      const result = await liquidityAndBalance(accessToken, address as string);
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
      if (!address) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User address is required" });
        return;
      }
      
      const result = await getLoan(accessToken, address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async executeLiquidation(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken } = req;
      const id = req.params.id;

      if (!id) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Loan ID is required" });
        return;
      }

      const result = await executeLiquidationService(accessToken, id);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      next(error);
    }
  }

  // ---------------- Admin Configuration Methods ----------------

  static async setInterestRate(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateSetInterestRateArgs(body);

      const result = await setInterestRateService(accessToken, body);
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
      const { accessToken, body } = req;
      validateSetCollateralRatioArgs(body);

      const result = await setCollateralRatioService(accessToken, body);
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
      const { accessToken, body } = req;
      validateSetLiquidationBonusArgs(body);

      const result = await setLiquidationBonusService(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }
}

export default LendingController;
