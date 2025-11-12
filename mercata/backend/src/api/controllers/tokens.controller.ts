import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getTokens,
  getBalance,
  getTokenBalance,
  getTokenCollateral,
  getTokenValueData,
  createToken,
  transferToken,
  approveToken,
  transferFromToken,
  setTokenStatus,
  getVoucherBalance,
  getTransferableTokens,
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

      // Add default pagination parameters if not provided
      const paramsWithDefaults = {
        ...query,
        limit: query.limit || "10",
        offset: query.offset || "0"
      };

      const result = await getTokens(
        accessToken,
        paramsWithDefaults as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(result);
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

  static async getTransferable(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const tokens = await getTransferableTokens(accessToken, userAddress);
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
      const { accessToken, query, address: userAddress } = req;
      validateQueryParams(query);

      const balances = await getBalance(
        accessToken,
        userAddress,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(balances);
    } catch (error) {
      next(error);
    }
  }

  static async getTokenBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address: userAddress } = req;
      validateQueryParams(query);

      const balances = await getTokenBalance(
        accessToken,
        userAddress,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(balances);
    } catch (error) {
      next(error);
    }
  }

  static async getTokenCollateral(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address: userAddress } = req;
      validateQueryParams(query);

      const collaterals = await getTokenCollateral(
        accessToken,
        userAddress,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(collaterals);
    } catch (error) {
      next(error);
    }
  }

  static async getTokenValueData(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params, address: userAddress } = req;
      const { tokenAddress } = params;

      if (!tokenAddress) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Token address is required" });
        return;
      }

      const valueData = await getTokenValueData(
        accessToken,
        userAddress,
        tokenAddress
      );
      res.status(RestStatus.OK).json(valueData);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body, address: userAddress } = req;

      const args = {
        ...body,
        images: JSON.parse(body.images || "[]"),
        files: JSON.parse(body.files || "[]"),
        fileNames: JSON.parse(body.fileNames || "[]"),
      };
      validateCreateTokensArgs(args);

      const result = await createToken(accessToken, userAddress as string, args);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async transfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateTransferItemArgs(body);

      const result = await transferToken(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateApproveArgs(body);

      const result = await approveToken(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async transferFrom(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateTransferFromArgs(body);

      const result = await transferFromToken(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async setStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateSetStatusArgs(body);

      const result = await setTokenStatus(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getVoucherBalance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;

      const balance = await getVoucherBalance(accessToken, userAddress);
      res.status(RestStatus.OK).json({ balance });
    } catch (error) {
      next(error);
    }
  }
}

export default TokensController;