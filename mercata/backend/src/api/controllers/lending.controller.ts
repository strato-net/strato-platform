import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPool,
  depositLiquidity,
  withdrawLiquidity,
  borrow,
  repay,
  executeLiquidation as executeLiquidationService,
  configureAsset as configureAssetService,
  supplyCollateral,
  withdrawCollateral,
  collateralAndBalance,
  liquidityAndBalance,
  getLoan,
  listLiquidatableLoans,
  listNearUnhealthyLoans,
  repayAll,
  sweepReserves as sweepReservesService,
  setDebtCeilings as setDebtCeilingsService,
  borrowMax,
  withdrawCollateralMax,
} from "../services/lending.service";
import {
  validateDepositLiquidityArgs,
  validateWithdrawLiquidityArgs,
  validateBorrowArgs,
  validateRepayArgs,
  validateSupplyCollateralArgs,
  validateWithdrawCollateralArgs,
  validateConfigureAssetArgs,
  validateLiquidationArgs,
  validateSweepReservesArgs,
  validateSetDebtCeilingsArgs,
} from "../validators/lending.validator";
import { validateUserAddress } from "../validators/common.validators";

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

  static async withdrawLiquidityAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { withdrawLiquidityAll } = await import("../services/lending.service");
      const result = await withdrawLiquidityAll(accessToken);
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

  static async borrowMax(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const result = await borrowMax(accessToken);
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

  static async withdrawCollateralMax(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateWithdrawCollateralArgs(body);
      const result = await withdrawCollateralMax(accessToken, body.asset);
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
      validateUserAddress(address);

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
      validateUserAddress(address);

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
      validateUserAddress(address);
      
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
      validateLiquidationArgs({id, ...req.body});

      const result = await executeLiquidationService(accessToken, id, req.body || {});
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      next(error);
    }
  }

  static async repayAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, address } = req;
      const result = await repayAll(accessToken, address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---------------- Admin Configuration Methods ----------------


  static async configureAsset(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateConfigureAssetArgs(body);

      const result = await configureAssetService(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async sweepReserves(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateSweepReservesArgs(body);

      const result = await sweepReservesService(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async setDebtCeilings(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateSetDebtCeilingsArgs(body);

      const result = await setDebtCeilingsService(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async listLiquidatable(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const result = await listLiquidatableLoans(accessToken);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async listNearUnhealthy(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const marginParam = query.margin ? Number(query.margin as string) : 0.2;
      const result = await listNearUnhealthyLoans(accessToken, marginParam);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default LendingController;
