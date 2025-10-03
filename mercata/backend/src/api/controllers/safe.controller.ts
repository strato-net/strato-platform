import { Request, Response, NextFunction } from "express";
import { getSafeLiquidity } from "../services/safe.service";
import { StatusCodes } from "http-status-codes";

class SafeController {
  /**
   * GET /api/safe/liquidity/:chainId/:tokenAddress
   * Fetches the Safe wallet balance for a specific token on an external chain
   */
  static async getLiquidity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { chainId, tokenAddress } = req.params;

      // Validate parameters
      if (!chainId || !tokenAddress) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: {
            message: "Missing required parameters: chainId and tokenAddress",
            status: StatusCodes.BAD_REQUEST,
            type: "ValidationError",
          },
        });
        return;
      }

      const chainIdNum = parseInt(chainId, 10);
      if (isNaN(chainIdNum)) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: {
            message: "Invalid chainId: must be a number",
            status: StatusCodes.BAD_REQUEST,
            type: "ValidationError",
          },
        });
        return;
      }

      // Fetch Safe liquidity
      const liquidityData = await getSafeLiquidity(chainIdNum, tokenAddress);

      res.status(StatusCodes.OK).json(liquidityData);
    } catch (error: any) {
      console.error("Error fetching Safe liquidity:", error);

      // Check if it's a configuration error
      if (error.message?.includes("not configured")) {
        res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
          error: {
            message: error.message,
            status: StatusCodes.SERVICE_UNAVAILABLE,
            type: "ConfigurationError",
          },
        });
        return;
      }

      // Check if it's an invalid address error
      if (error.message?.includes("invalid address")) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: {
            message: "Invalid token address format",
            status: StatusCodes.BAD_REQUEST,
            type: "ValidationError",
          },
        });
        return;
      }

      // Generic error handler
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: {
          message: error.message || "Failed to fetch Safe liquidity",
          status: StatusCodes.INTERNAL_SERVER_ERROR,
          type: "InternalError",
        },
      });
    }
  }
}

export default SafeController;

