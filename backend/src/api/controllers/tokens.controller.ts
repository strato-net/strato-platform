import Joi from "@hapi/joi";
import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getTokens,
  getBalance,
  getState,
  createToken,
  transferToken,
  approveToken,
  transferFromToken,
} from "../services/tokens.service";

class TokensController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;

      TokensController.validateAddressArgs(params);

      const token = await getTokens(accessToken, {
        address: "eq." + params.address,
      });
      res.status(RestStatus.OK).json(token);
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

      const tokens = await getTokens(
        accessToken,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  static async getState(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;
      const allowances = await getState(
        accessToken,
        params.address as string,
      );
      res.status(RestStatus.OK).json(allowances);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      TokensController.validateCreateTokensArgs(body);

      const result = await createToken(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async transfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      TokensController.validateTransferItemArgs(body);

      const result = await transferToken(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;
      const result = await approveToken(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async transferFrom(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      const result = await transferFromToken(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------
  static validateAddressArgs(args: any) {
    const addressSchema = Joi.object({
      address: Joi.string().required(),
    });

    const validation = addressSchema.validate(args);

    if (validation.error) {
      throw new Error("Address Argument Validation Error");
    }
  }

  static validateCreateTokensArgs(args: any) {
    const createTokensSchema = Joi.object({
      name: Joi.string().required(),
      symbol: Joi.string().required(),
      initialSupply: Joi.number().integer().min(0).required(),
      decimals: Joi.number().integer().min(0).max(18).required(),
    });

    const validation = createTokensSchema.validate(args);

    if (validation.error) {
      throw new Error(
        "Create Inventory Argument Validation Error: " +
          validation.error.message
      );
    }
  }

  static validateTransferItemArgs(args: any) {
    const transferItemSchema = Joi.object({
      address: Joi.string().required(),
      to: Joi.string().required(),
      value: Joi.string().pattern(/^\d+$/).required(),
    });

    const validation = transferItemSchema.validate(args);

    if (validation.error) {
      throw new Error("Transfer Item Argument Validation Error");
    }
  }
}

export default TokensController;
