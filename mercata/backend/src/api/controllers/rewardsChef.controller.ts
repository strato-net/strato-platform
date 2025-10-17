import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getPendingCataAll, getStakedBalanceForPool, claimAll, getPools, findPoolByLpToken, getRewardsChefState } from "../services/rewardsChef.service";
import * as config from "../../config/config";

class RewardsChefController {
  static async getPendingRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
      const { accessToken, address: userAddress } = req;

      const result = await getPendingCataAll(
        accessToken,
        config.rewardsChef,
        userAddress
      );

      res.status(RestStatus.OK).json(result);
  }

  static async claimRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;

      const result = await claimAll(accessToken, userAddress);

      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getStakedBalanceForPool(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const { poolId } = req.params;

      const poolIdNumber = parseInt(poolId, 10);
      if (isNaN(poolIdNumber)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid pool ID" });
        return;
      }

      const result = await getStakedBalanceForPool(
        accessToken,
        config.rewardsChef,
        poolIdNumber,
        userAddress
      );

      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getPools(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;

      const pools = await getPools(accessToken, config.rewardsChef);

      res.status(RestStatus.OK).json({ pools });
    } catch (error) {
      next(error);
    }
  }

  static async findPoolByLpToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { lpTokenAddress } = req.params;

      const pool = await findPoolByLpToken(accessToken, config.rewardsChef, lpTokenAddress);

      if (!pool) {
        res.status(RestStatus.NOT_FOUND).json({ error: "Pool not found for the given LP token address" });
        return;
      }

      res.status(RestStatus.OK).json({ pool });
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
      const { accessToken } = req;

      const state = await getRewardsChefState(accessToken, config.rewardsChef);

      if (!state) {
        res.status(RestStatus.NOT_FOUND).json({ error: "RewardsChef state not found" });
        return;
      }

      res.status(RestStatus.OK).json(state);
    } catch (error) {
      next(error);
    }
  }
}

export default RewardsChefController;
