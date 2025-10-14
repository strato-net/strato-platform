import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getPendingCataAll } from "../services/rewardsChef.service";
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
}

export default RewardsChefController;
