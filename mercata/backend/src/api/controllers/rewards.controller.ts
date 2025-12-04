import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { fetchUserActivities, fetchRewardsOverview, fetchAllActivities, fetchLeaderboard } from "../services/rewards.service";
import { strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { constants, StratoPaths } from "../../config/constants";
import * as config from "../../config/config";

const { Rewards } = constants;

class RewardsController {
  /**
   * Get global Rewards contract overview data
   */
  static async getOverview(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const forceRefresh = req.query.refresh === "true";
      const overview = await fetchRewardsOverview(accessToken, forceRefresh);
      res.status(RestStatus.OK).json(overview);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all activities in the system (without user-specific data)
   */
  static async getAllActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const forceRefresh = req.query.refresh === "true";
      const activities = await fetchAllActivities(accessToken, forceRefresh);
      res.status(RestStatus.OK).json(activities);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all activities with user-specific data for the specified user
   */
  static async getUserActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { userAddress } = req.params;
      const forceRefresh = req.query.refresh === "true";

      if (!userAddress) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User address is required" });
        return;
      }

      const activities = await fetchUserActivities(accessToken, userAddress, forceRefresh);
      res.status(RestStatus.OK).json(activities);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Claim all rewards for the authenticated user
   */
  static async claimAllRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;

      if (!config.rewards) {
        res.status(RestStatus.INTERNAL_SERVER_ERROR).json({ error: "Rewards contract not configured" });
        return;
      }

      const builtTx = await buildFunctionTx({
        contractName: extractContractName(Rewards),
        contractAddress: config.rewards,
        method: "claimAllRewards",
        args: {}
      }, userAddress, accessToken);

      const result = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
      );

      res.status(RestStatus.OK).json({
        success: result.status === "Success",
        txHash: result.hash
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Claim rewards for a specific activity
   */
  static async claimActivityRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const { activityId } = req.params;
      const activityIdNumber = parseInt(activityId, 10);

      if (isNaN(activityIdNumber)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid activity ID" });
        return;
      }

      if (!config.rewards) {
        res.status(RestStatus.INTERNAL_SERVER_ERROR).json({ error: "Rewards contract not configured" });
        return;
      }

      const builtTx = await buildFunctionTx({
        contractName: extractContractName(Rewards),
        contractAddress: config.rewards,
        method: "claimRewards",
        args: {
          activityIdsToSettle: [BigInt(activityIdNumber)]
        }
      }, userAddress, accessToken);

      const result = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
      );

      res.status(RestStatus.OK).json({
        success: result.status === "Success",
        txHash: result.hash
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get leaderboard data
   */
  static async getLeaderboard(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const forceRefresh = req.query.refresh === "true";
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 10));
      const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);
      const sortBy = (req.query.sortBy as "rewards" | "emissionRate") || "rewards";

      const leaderboard = await fetchLeaderboard(accessToken, forceRefresh, limit, offset, sortBy);
      res.status(RestStatus.OK).json(leaderboard);
    } catch (error) {
      next(error);
    }
  }

}

export default RewardsController;

