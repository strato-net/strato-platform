/**
 * Protocol Fee Controller
 */

import { NextFunction, Request, Response } from "express";
import RestStatus from "http-status-codes";
import * as protocolFeeService from "../services/protocolFee.service";

class ProtocolFeeController {
  /**
   * Get aggregated protocol revenue across all protocols
   */
  static async getAggregatedRevenue(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;

      const revenue = await protocolFeeService.getAggregatedProtocolRevenue(
        accessToken!,
        userAddress as string
      );

      res.status(RestStatus.OK).json(revenue);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get protocol revenue for a specific protocol
   */
  static async getProtocolRevenue(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const { protocol } = req.params;
      const { period } = req.query;

      // Validate protocol
      if (!['cdp', 'lending', 'swap', 'gas'].includes(protocol)) {
        res.status(RestStatus.BAD_REQUEST).json({
          error: "Invalid protocol. Must be one of: cdp, lending, swap, gas"
        });
      }

      // If period is specified, get revenue for that period only
      if (period && ['daily', 'weekly', 'monthly', 'ytd', 'allTime'].includes(period as string)) {
        const periodRevenue = await protocolFeeService.getProtocolRevenueByPeriod(
          accessToken!,
          userAddress as string,
          period as any,
          protocol as any
        );
        res.status(RestStatus.OK).json(periodRevenue);
      }

      // Otherwise get all revenue data for the protocol
      let revenue;
      switch (protocol) {
        case 'cdp':
          revenue = await protocolFeeService.getCDPProtocolRevenue(
            accessToken!,
            userAddress as string
          );
          break;
        case 'lending':
          revenue = await protocolFeeService.getLendingProtocolRevenue(accessToken!);
          break;
        case 'swap':
          revenue = await protocolFeeService.getSwapProtocolRevenue(accessToken!);
          break;
        case 'gas':
          revenue = await protocolFeeService.getGasCostRevenue(accessToken!);
          break;
      }

      res.status(RestStatus.OK).json(revenue);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get protocol revenue by period (aggregated or specific protocol)
   */
  static async getRevenueByPeriod(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const { period } = req.params;
      const { protocol } = req.query;

      // Validate period
      if (!['daily', 'weekly', 'monthly', 'ytd', 'allTime'].includes(period)) {
        res.status(RestStatus.BAD_REQUEST).json({
          error: "Invalid period. Must be one of: daily, weekly, monthly, ytd, allTime"
        });
      }

      // Validate protocol if specified
      if (protocol && !['cdp', 'lending', 'swap', 'gas'].includes(protocol as string)) {
        res.status(RestStatus.BAD_REQUEST).json({
          error: "Invalid protocol. Must be one of: cdp, lending, swap, gas"
        });
      }

      const periodRevenue = await protocolFeeService.getProtocolRevenueByPeriod(
        accessToken!,
        userAddress as string,
        period as any,
        protocol as any
      );

      res.status(RestStatus.OK).json(periodRevenue);
    } catch (error) {
      next(error);
    }
  }
}

export default ProtocolFeeController;
