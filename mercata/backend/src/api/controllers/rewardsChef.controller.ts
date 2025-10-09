import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  calculatePendingCata,
  calculateTotalPendingCata,
  getPools,
  getRewardsChefState
} from "../services/rewardsChef.service";
import { rewardsChef as rewardsChefAddress } from "../../config/constants";
import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

const { RewardsChef } = constants;

class RewardsChefController {
  /**
   * GET /api/rewards/pending
   * Calculate pending CATA rewards for a user in a specific pool
   *
   * Query params:
   * - poolId: Pool ID (required)
   * - userAddress: User address (optional, defaults to authenticated user)
   */
  static async getPendingRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: authenticatedUserAddress } = req;
      const { poolId, userAddress } = req.query;

      if (!poolId) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "poolId is required" });
        return;
      }

      const targetUserAddress = (userAddress as string) || authenticatedUserAddress;
      const poolIdNum = parseInt(poolId as string, 10);

      if (isNaN(poolIdNum)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "poolId must be a valid number" });
        return;
      }

      // Fetch cataPerSecond and totalAllocPoint from the contract
      const contractStateResponse = await cirrus.get(accessToken, `/${RewardsChef}`, {
        params: {
          address: `eq.${rewardsChefAddress}`,
          select: "cataPerSecond::text,totalAllocPoint::text"
        }
      });

      const contractState = contractStateResponse.data?.[0];
      if (!contractState) {
        res.status(RestStatus.NOT_FOUND).json({ error: "RewardsChef contract not found" });
        return;
      }

      const pendingCata = await calculatePendingCata(
        accessToken,
        rewardsChefAddress,
        poolIdNum,
        targetUserAddress,
        contractState.cataPerSecond,
        contractState.totalAllocPoint
      );

      // Format with proper decimals (wei to CATA with 18 decimals)
      const pendingCataBigInt = BigInt(pendingCata);
      const pendingCataFormatted = (Number(pendingCataBigInt) / 1e18).toFixed(2);

      res.status(RestStatus.OK).json({
        poolId: poolIdNum,
        userAddress: targetUserAddress,
        pendingCata,
        pendingCataFormatted
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rewards/pools
   * Get all RewardsChef pools
   */
  static async getPools(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;

      const pools = await getPools(accessToken, rewardsChefAddress);

      res.status(RestStatus.OK).json({ pools });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/rewards/pending/total
   * Calculate total pending CATA rewards across all pools for a user
   *
   * Query params:
   * - userAddress: User address (optional, defaults to authenticated user)
   */
  static async getTotalPendingRewards(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: authenticatedUserAddress } = req;
      const { userAddress } = req.query;

      const targetUserAddress = (userAddress as string) || authenticatedUserAddress;

      const totalPending = await calculateTotalPendingCata(
        accessToken,
        rewardsChefAddress,
        targetUserAddress
      );

      // Format with proper decimals (wei to CATA with 18 decimals)
      const totalPendingNum = Number(BigInt(totalPending)) / 1e18;
      const formatted = totalPendingNum.toFixed(2);

      res.status(RestStatus.OK).json({
        userAddress: targetUserAddress,
        totalPendingCata: totalPending,
        totalPendingCataFormatted: formatted
      });
    } catch (error) {
      next(error);
    }
  }
}

export default RewardsChefController;
