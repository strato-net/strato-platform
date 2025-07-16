import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getTokens,
  getBalance,
  createToken,
  transferToken,
  approveToken,
  transferFromToken,
  setTokenStatus,
} from "../services/tokens.service";
import {
  validateAddressArgs,
  validateCreateTokensArgs,
  validateTransferItemArgs,
  validateApproveArgs,
  validateTransferFromArgs,
  validateQueryParams,
  validateSetStatusArgs,
} from "../validators/tokens.validator";

class TokensController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;
      validateAddressArgs(params);

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
      validateQueryParams(query);

      const tokens = await getTokens(
        accessToken,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  static async getActive(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      validateQueryParams(query);

      const tokens = await getTokens(
        accessToken,
        { ...query, status: "eq.2" } as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  static async getBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address } = req;
      validateQueryParams(query);

      const balances = await getBalance(
        accessToken,
        address,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(balances);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      const args = {
        ...body,
        images: JSON.parse(body.images || "[]"),
        files: JSON.parse(body.files || "[]"),
        fileNames: JSON.parse(body.fileNames || "[]"),
      };
      validateCreateTokensArgs(args);

      const result = await createToken(accessToken, args);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async transfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;
      validateTransferItemArgs(body);

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
      validateApproveArgs(body);

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
      validateTransferFromArgs(body);

      const result = await transferFromToken(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;
      validateSetStatusArgs(body);

      const result = await setTokenStatus(accessToken, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default TokensController;
