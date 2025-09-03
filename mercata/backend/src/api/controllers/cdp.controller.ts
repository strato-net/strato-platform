import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getVaults,
  getVault,
  deposit,
  withdraw,
  withdrawMax,
  mint,
  mintMax,
  repay,
  repayAll,
  liquidate,
  getLiquidatable,
  getAssetConfig,
  getSupportedAssets,
} from "../services/cdp.service";

class CDPController {
  static async getVaults(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const vaults = await getVaults(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(vaults);
    } catch (error) {
      next(error);
    }
  }

  static async getVault(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, params } = req;
      const { asset } = params;
      const vault = await getVault(accessToken, userAddress as string, asset);
      res.status(RestStatus.OK).json(vault);
    } catch (error) {
      next(error);
    }
  }

  static async deposit(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await deposit(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async withdraw(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await withdraw(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async withdrawMax(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await withdrawMax(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async mint(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await mint(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async mintMax(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await mintMax(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async repay(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await repay(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async repayAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await repayAll(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async liquidate(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await liquidate(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getLiquidatable(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const liquidatable = await getLiquidatable(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(liquidatable);
    } catch (error) {
      next(error);
    }
  }

  static async getAssetConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, params } = req;
      const { asset } = params;
      const config = await getAssetConfig(accessToken, userAddress as string, asset);
      res.status(RestStatus.OK).json(config);
    } catch (error) {
      next(error);
    }
  }

  static async getSupportedAssets(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const assets = await getSupportedAssets(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(assets);
    } catch (error) {
      next(error);
    }
  }
}

export default CDPController;
