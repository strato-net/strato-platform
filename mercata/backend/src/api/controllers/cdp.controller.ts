import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getVaults,
  getVault,
  deposit,
  withdraw,
  getMaxWithdraw,
  withdrawMax,
  mint,
  getMaxMint,
  mintMax,
  repay,
  repayAll,
  liquidate,
  getLiquidatable,
  getMaxLiquidatable,
  getAssetConfig,
  getSupportedAssets,
  getAssetDebtInfo,
  setCollateralConfig,
  setAssetPaused,
  setGlobalPaused,
  getGlobalPaused,
  getAllCollateralConfigs,
  getBadDebt,
} from "../services/cdp.service";
import {
  validateDepositArgs,
  validateWithdrawArgs,
  validateWithdrawMaxArgs,
  validateMintArgs,
  validateMintMaxArgs,
  validateRepayArgs,
  validateRepayAllArgs,
  validateLiquidateArgs,
} from "../validators/cdp.validator";

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
      validateDepositArgs(body);
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
      validateWithdrawArgs(body);
      const result = await withdraw(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getMaxWithdraw(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateWithdrawMaxArgs(body);
      const result = await getMaxWithdraw(accessToken, userAddress as string, body);
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
      validateWithdrawMaxArgs(body);
      const result = await withdrawMax(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getMaxMint(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      validateMintMaxArgs(body);
      const result = await getMaxMint(accessToken, userAddress as string, body);
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
      validateMintArgs(body);
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
      validateMintMaxArgs(body);
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
      validateRepayArgs(body);
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
      validateRepayAllArgs(body);
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
      validateLiquidateArgs(body);
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

  static async getMaxLiquidatable(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await getMaxLiquidatable(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
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

  static async getAssetDebtInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await getAssetDebtInfo(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ----- Admin Methods (Owner Only) -----

  static async setCollateralConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await setCollateralConfig(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setAssetPaused(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await setAssetPaused(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setGlobalPaused(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const result = await setGlobalPaused(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getGlobalPaused(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await getGlobalPaused(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getAllCollateralConfigs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await getAllCollateralConfigs(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getBadDebt(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result = await getBadDebt(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default CDPController;
