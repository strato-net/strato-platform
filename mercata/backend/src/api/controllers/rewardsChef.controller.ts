import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getPendingCataAll, getStakedBalanceForPool, claimAll, getPools, findPoolByLpToken } from "../services/rewardsChef.service";
import { rewardsChef } from "../../config/constants";

class RewardsChefController {
  static async getPendingRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
      const { accessToken, address: userAddress } = req;

      const result = await getPendingCataAll(
        accessToken,
        rewardsChef,
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
        rewardsChef,
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

      const pools = await getPools(accessToken, rewardsChef);

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

      const pool = await findPoolByLpToken(accessToken, rewardsChef, lpTokenAddress);

      if (!pool) {
        res.status(RestStatus.NOT_FOUND).json({ error: "Pool not found for the given LP token address" });
        return;
      }

      res.status(RestStatus.OK).json({ pool });
    } catch (error) {
      next(error);
    }
  }
}

export default RewardsChefController;
