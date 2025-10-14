import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { pendingCataAll } from "../helpers/rewards/pending.helpers";
import { rewardsChef } from "../../config/constants";

class RewardsChefController {
  static async getPendingRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
      const { accessToken, address: userAddress } = req;

      const pendingCata = await pendingCataAll(
        accessToken,
        rewardsChef,
        userAddress
      );

      // Format with proper decimals (wei to CATA with 18 decimals)
      const pendingCataFormatted = (Number(pendingCata) / 1e18).toFixed(2);

      res.status(RestStatus.OK).json({
        pendingCata,
        pendingCataFormatted
      });
  }
}

export default RewardsChefController;
