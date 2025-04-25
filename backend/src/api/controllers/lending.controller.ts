import Joi from "@hapi/joi";
import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPools,
  createPool,
  manageLiquidity,
  getLoan,
  repayLoan,
} from "../services/lending.service";

class LendingController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;
      LendingController.validateGetArgs(params);
      const pools = await getPools(accessToken, {
        address: "eq." + params.address,
      });
      res.status(RestStatus.OK).json(pools);
    } catch (error) {
      next(error);
    }
  }

  static async getAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const pools = await getPools(
        accessToken,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(pools);
    } catch (error) {
      next(error);
    }
  }

  static async create(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      LendingController.validateCreateArgs(body);

      const result = await createPool(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  static async manageLiquidity(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      LendingController.validateManageLiquidityArgs(body);

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
      LendingController.validateGetLoanArgs(body);

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
      LendingController.validateRepayLoanArgs(body);

      const result = await repayLoan(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------
  static validateGetArgs(args: any) {
    const schema = Joi.object({
      address: Joi.string().required(),
    });
    const { error } = schema.validate(args);
    if (error) {
      throw new Error("Address Argument Validation Error: " + error.message);
    }
  }

  static validateQueryArgs(args: any) {
    const schema = Joi.object({
      address: Joi.string().optional(),
      owner: Joi.string().optional(),
      creator: Joi.string().optional(),
      order: Joi.string().optional(),
      limit: Joi.string().optional(),
      offset: Joi.string().optional(),
    });
    const { error } = schema.validate(args);
    if (error) {
      throw new Error("Query Argument Validation Error: " + error.message);
    }
  }

  static validateCreateArgs(args: any) {
    const schema = Joi.object().pattern(Joi.string(), Joi.string().required());
    const { error } = schema.validate(args);
    if (error) {
      throw new Error(
        "Create Pool Argument Validation Error: " + error.message
      );
    }
  }

  static validateManageLiquidityArgs(args: any) {
    const schema = Joi.object({
      method: Joi.string()
        .valid("depositLiquidity", "withdrawLiquidity")
        .required(),
      address: Joi.string().required(),
      asset: Joi.string().required(),
      amount: Joi.string().required(),
    });
    const { error } = schema.validate(args);
    if (error) {
      throw new Error(
        "Manage Liquidity Argument Validation Error: " + error.message
      );
    }
  }

  static validateGetLoanArgs(args: any) {
    const schema = Joi.object({
      address: Joi.string().required(),
      asset: Joi.string().required(),
      amount: Joi.string().required(),
      collateralAsset: Joi.string().required(),
      collateralAmount: Joi.string().required(),
    });
    const { error } = schema.validate(args);
    if (error) {
      throw new Error("Get Loan Argument Validation Error: " + error.message);
    }
  }

  static validateRepayLoanArgs(args: any) {
    const schema = Joi.object({
      address: Joi.string().required(),
      loanId: Joi.string().required(),
      asset: Joi.string().required(),
      amount: Joi.string().required(),
    });
    const { error } = schema.validate(args);
    if (error) {
      throw new Error("Repay Loan Argument Validation Error: " + error.message);
    }
  }
}

export default LendingController;
