import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getPendingCataAll } from "../services/rewardsChef.service";
import { rewardsChef } from "../../config/constants";
import { claimAll } from "../services/rewardsChef.service";

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
}

export default RewardsChefController;
